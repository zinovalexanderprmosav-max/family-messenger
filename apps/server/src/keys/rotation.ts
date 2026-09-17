import type { PoolClient } from 'pg';

export type RotationReason='device_revoked'|'member_removed';
export type RotationRecipientDevice={deviceId:string;memberId:string;encryptionPublicKey:string};
export type PendingRotation={chatId:string;fromKeyVersion:number;toKeyVersion:number;reason:RotationReason;recipientDevices:RotationRecipientDevice[]};

async function activeRecipientDevices(tx:PoolClient,input:{familyId:string;chatId:string}){
  const r=await tx.query<{id:string;member_id:string;encryption_public_key:string}>(`
    SELECT d.id,d.member_id,d.encryption_public_key
    FROM chat_members cm
    JOIN chats c ON c.id=cm.chat_id
    JOIN family_memberships fm ON fm.family_id=c.family_id AND fm.member_id=cm.member_id
    JOIN devices d ON d.family_id=c.family_id AND d.member_id=cm.member_id
    WHERE cm.chat_id=$1 AND c.family_id=$2 AND fm.status='active' AND d.status='active'
    ORDER BY d.member_id,d.created_at,d.id
  `,[input.chatId,input.familyId]);
  return r.rows.map(row=>({deviceId:row.id,memberId:row.member_id,encryptionPublicKey:row.encryption_public_key}));
}

export async function listPendingRotations(tx:PoolClient,input:{familyId:string;memberId:string}):Promise<PendingRotation[]>{
  const r=await tx.query<{chat_id:string;from_key_version:number;to_key_version:number;reason:RotationReason}>(`
    SELECT r.chat_id,r.from_key_version,r.to_key_version,r.reason
    FROM chat_key_rotation_requests r
    JOIN chats c ON c.id=r.chat_id
    JOIN chat_members cm ON cm.chat_id=c.id AND cm.member_id=$2
    JOIN family_memberships fm ON fm.family_id=c.family_id AND fm.member_id=cm.member_id
    WHERE c.family_id=$1 AND r.state='pending' AND fm.status='active'
    ORDER BY r.created_at,r.chat_id
  `,[input.familyId,input.memberId]);
  const items:PendingRotation[]=[];
  for(const row of r.rows){
    items.push({
      chatId:row.chat_id,
      fromKeyVersion:row.from_key_version,
      toKeyVersion:row.to_key_version,
      reason:row.reason,
      recipientDevices:await activeRecipientDevices(tx,{familyId:input.familyId,chatId:row.chat_id})
    });
  }
  return items;
}

export async function getPendingRotationForChat(tx:PoolClient,input:{familyId:string;chatId:string}){
  const r=await tx.query<{to_key_version:number}>(`
    SELECT r.to_key_version
    FROM chat_key_rotation_requests r
    JOIN chats c ON c.id=r.chat_id
    WHERE r.chat_id=$1 AND c.family_id=$2 AND r.state='pending'
  `,[input.chatId,input.familyId]);
  return r.rows[0]?.to_key_version??null;
}

export async function completeKeyRotation(tx:PoolClient,input:{
  familyId:string;
  actorMemberId:string;
  chatId:string;
  toKeyVersion:number;
  envelopes:Array<{deviceId:string;sealedKeyEnvelope:string}>;
}){
  const chat=await tx.query(`SELECT id FROM chats WHERE id=$1 AND family_id=$2 FOR UPDATE`,[input.chatId,input.familyId]);
  if(!chat.rowCount) throw Object.assign(new Error('chat_not_found'),{statusCode:404});

  const participant=await tx.query(`
    SELECT 1 FROM chat_members cm
    JOIN family_memberships fm ON fm.family_id=$1 AND fm.member_id=cm.member_id
    WHERE cm.chat_id=$2 AND cm.member_id=$3 AND fm.status='active'
  `,[input.familyId,input.chatId,input.actorMemberId]);
  if(!participant.rowCount) throw Object.assign(new Error('chat_not_found'),{statusCode:404});

  const rotation=await tx.query<{from_key_version:number;to_key_version:number;state:'pending'|'completed'}>(`
    SELECT from_key_version,to_key_version,state
    FROM chat_key_rotation_requests
    WHERE chat_id=$1
    FOR UPDATE
  `,[input.chatId]);
  const request=rotation.rows[0];
  if(!request) throw Object.assign(new Error('key_rotation_not_found'),{statusCode:404});
  if(request.state!=='pending') throw Object.assign(new Error('key_rotation_already_completed'),{statusCode:409});
  if(input.toKeyVersion!==request.to_key_version) throw Object.assign(new Error('key_rotation_version_mismatch'),{statusCode:409});

  const current=await tx.query<{key_version:number}>(`SELECT max(key_version)::int key_version FROM conversation_key_versions WHERE chat_id=$1`,[input.chatId]);
  if(current.rows[0]?.key_version!==request.from_key_version) throw Object.assign(new Error('key_rotation_state_conflict'),{statusCode:409});

  const recipients=await activeRecipientDevices(tx,{familyId:input.familyId,chatId:input.chatId});
  const requiredIds=recipients.map(item=>item.deviceId).sort();
  const providedIds=input.envelopes.map(item=>item.deviceId).sort();
  const exactMatch=requiredIds.length===providedIds.length&&new Set(providedIds).size===providedIds.length&&requiredIds.every((id,index)=>id===providedIds[index]);
  if(!exactMatch) throw Object.assign(new Error('key_envelope_recipient_mismatch'),{statusCode:400});

  await tx.query(`INSERT INTO conversation_key_versions(chat_id,key_version) VALUES($1,$2)`,[input.chatId,input.toKeyVersion]);
  for(const envelope of input.envelopes){
    await tx.query(`INSERT INTO device_key_envelopes(chat_id,key_version,device_id,sealed_key_envelope) VALUES($1,$2,$3,$4)`,[input.chatId,input.toKeyVersion,envelope.deviceId,envelope.sealedKeyEnvelope]);
  }
  await tx.query(`UPDATE chat_key_rotation_requests SET state='completed',completed_at=now() WHERE chat_id=$1`,[input.chatId]);
  return {chatId:input.chatId,keyVersion:input.toKeyVersion};
}
