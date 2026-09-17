import type { PoolClient } from 'pg';

export type DirectChatRecipientDevice={
  deviceId:string;
  memberId:string;
  encryptionPublicKey:string;
};

export type PreparedDirectChat={
  chatId:string;
  kind:'direct';
  keyInitialized:boolean;
  recipientDevices:DirectChatRecipientDevice[];
  created:boolean;
};

function canonicalPair(a:string,b:string){return a.localeCompare(b)<=0?[a,b] as const:[b,a] as const;}

export async function prepareDirectChat(tx:PoolClient,input:{familyId:string;actorMemberId:string;targetMemberId:string}):Promise<PreparedDirectChat>{
  if(input.actorMemberId===input.targetMemberId) throw Object.assign(new Error('direct_chat_self'),{statusCode:400});

  const family=await tx.query(`SELECT id FROM families WHERE id=$1 FOR UPDATE`,[input.familyId]);
  if(!family.rowCount) throw Object.assign(new Error('family_not_found'),{statusCode:404});

  const target=await tx.query(`SELECT 1 FROM family_memberships WHERE family_id=$1 AND member_id=$2 AND status='active'`,[input.familyId,input.targetMemberId]);
  if(!target.rowCount) throw Object.assign(new Error('member_not_found'),{statusCode:404});

  const [memberLow,memberHigh]=canonicalPair(input.actorMemberId,input.targetMemberId);
  const existing=await tx.query<{chat_id:string}>(`SELECT chat_id FROM direct_chat_pairs WHERE family_id=$1 AND member_low=$2 AND member_high=$3`,[input.familyId,memberLow,memberHigh]);
  let chatId=existing.rows[0]?.chat_id;
  let created=false;

  if(!chatId){
    const chat=await tx.query<{id:string}>(`INSERT INTO chats(family_id,kind) VALUES($1,'direct') RETURNING id`,[input.familyId]);
    chatId=chat.rows[0]!.id;
    await tx.query(`INSERT INTO direct_chat_pairs(chat_id,family_id,member_low,member_high) VALUES($1,$2,$3,$4)`,[chatId,input.familyId,memberLow,memberHigh]);
    await tx.query(`INSERT INTO chat_members(chat_id,member_id) VALUES($1,$2),($1,$3)`,[chatId,memberLow,memberHigh]);
    created=true;
  }

  const key=await tx.query(`SELECT 1 FROM conversation_key_versions WHERE chat_id=$1 ORDER BY key_version DESC LIMIT 1`,[chatId]);
  const devices=await tx.query<{id:string;member_id:string;encryption_public_key:string}>(`
    SELECT d.id,d.member_id,d.encryption_public_key
    FROM devices d
    JOIN family_memberships fm ON fm.family_id=d.family_id AND fm.member_id=d.member_id
    WHERE d.family_id=$1
      AND d.member_id IN ($2,$3)
      AND d.status='active'
      AND fm.status='active'
    ORDER BY d.member_id,d.created_at,d.id`,[input.familyId,memberLow,memberHigh]);

  return {
    chatId,
    kind:'direct',
    keyInitialized:Boolean(key.rowCount),
    recipientDevices:devices.rows.map(row=>({deviceId:row.id,memberId:row.member_id,encryptionPublicKey:row.encryption_public_key})),
    created
  };
}

export async function initializeDirectChatKeys(tx:PoolClient,input:{
  familyId:string;
  actorMemberId:string;
  chatId:string;
  keyVersion:1;
  envelopes:Array<{deviceId:string;sealedKeyEnvelope:string}>;
}){
  const chat=await tx.query<{id:string;kind:'direct'}>(`SELECT id,kind FROM chats WHERE id=$1 AND family_id=$2 AND kind='direct' FOR UPDATE`,[input.chatId,input.familyId]);
  if(!chat.rowCount) throw Object.assign(new Error('chat_not_found'),{statusCode:404});

  const participant=await tx.query(`
    SELECT 1
    FROM chat_members cm
    JOIN family_memberships fm ON fm.family_id=$1 AND fm.member_id=cm.member_id
    WHERE cm.chat_id=$2 AND cm.member_id=$3 AND fm.status='active'`,[input.familyId,input.chatId,input.actorMemberId]);
  if(!participant.rowCount) throw Object.assign(new Error('chat_not_found'),{statusCode:404});

  const initialized=await tx.query(`SELECT 1 FROM conversation_key_versions WHERE chat_id=$1 LIMIT 1`,[input.chatId]);
  if(initialized.rowCount) throw Object.assign(new Error('chat_keys_already_initialized'),{statusCode:409});

  const required=await tx.query<{id:string}>(`
    SELECT d.id
    FROM chat_members cm
    JOIN chats c ON c.id=cm.chat_id
    JOIN family_memberships fm ON fm.family_id=c.family_id AND fm.member_id=cm.member_id
    JOIN devices d ON d.family_id=c.family_id AND d.member_id=cm.member_id
    WHERE cm.chat_id=$1 AND c.family_id=$2 AND fm.status='active' AND d.status='active'
    ORDER BY d.id`,[input.chatId,input.familyId]);

  const requiredIds=required.rows.map(row=>row.id).sort();
  const providedIds=input.envelopes.map(item=>item.deviceId).sort();
  const uniqueProvided=new Set(providedIds);
  const exactMatch=requiredIds.length===providedIds.length&&uniqueProvided.size===providedIds.length&&requiredIds.every((id,index)=>id===providedIds[index]);
  if(!exactMatch) throw Object.assign(new Error('key_envelope_recipient_mismatch'),{statusCode:400});

  await tx.query(`INSERT INTO conversation_key_versions(chat_id,key_version) VALUES($1,$2)`,[input.chatId,input.keyVersion]);
  for(const envelope of input.envelopes){
    await tx.query(`INSERT INTO device_key_envelopes(chat_id,key_version,device_id,sealed_key_envelope) VALUES($1,$2,$3,$4)`,[input.chatId,input.keyVersion,envelope.deviceId,envelope.sealedKeyEnvelope]);
  }
  return {chatId:input.chatId,keyVersion:input.keyVersion};
}
