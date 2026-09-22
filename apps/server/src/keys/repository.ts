import type { PoolClient } from 'pg';

export type ProvisionedKey={chatId:string;keyVersion:number;sealedKeyEnvelope:string};

export async function listPendingDevices(tx:PoolClient,familyId:string,memberId?:string){
  const r=await tx.query<{id:string;member_id:string;device_name:string;display_name:string;encryption_public_key:string;created_at:Date}>(`
    SELECT d.id,d.member_id,d.device_name,m.display_name,d.encryption_public_key,d.created_at
    FROM devices d JOIN members m ON m.id=d.member_id
    WHERE d.family_id=$1 AND d.status='pending_key'
      AND ($2::uuid IS NULL OR d.member_id=$2)
    ORDER BY d.created_at
  `,[familyId,memberId??null]);
  return r.rows.map(row=>({deviceId:row.id,memberId:row.member_id,memberDisplayName:row.display_name,deviceName:row.device_name,encryptionPublicKey:row.encryption_public_key,createdAt:row.created_at.toISOString()}));
}

export async function approveDevice(tx:PoolClient,input:{
  familyId:string;deviceId:string;actorDeviceId:string;chatId:string;keyVersion:number;
  sealedKeyEnvelope:string;allowHistorical:boolean;provisionedKeys?:ProvisionedKey[];
}){
  const d=await tx.query<{status:string;family_id:string;member_id:string}>(`SELECT status,family_id,member_id FROM devices WHERE id=$1 FOR UPDATE`,[input.deviceId]);
  const device=d.rows[0];if(!device||device.family_id!==input.familyId)throw Object.assign(new Error('device_not_found'),{statusCode:404});
  if(device.status!=='pending_key')throw Object.assign(new Error('device_not_pending'),{statusCode:409});

  const kv=await tx.query<{current_key_version:number|null}>(`
    SELECT max(ckv.key_version)::int AS current_key_version
    FROM conversation_key_versions ckv
    JOIN chats c ON c.id=ckv.chat_id
    JOIN chat_members cm ON cm.chat_id=c.id AND cm.member_id=$3
    WHERE ckv.chat_id=$1 AND c.family_id=$2 AND c.kind='family'
  `,[input.chatId,input.familyId,device.member_id]);
  const current=kv.rows[0]?.current_key_version;
  if(current===null||current===undefined)throw Object.assign(new Error('key_version_not_found'),{statusCode:404});
  if(input.keyVersion!==current)throw Object.assign(new Error('key_version_stale'),{statusCode:409});

  const provided=input.provisionedKeys??[];
  if(!input.allowHistorical&&provided.length)throw Object.assign(new Error('history_provisioning_forbidden'),{statusCode:403});
  const seen=new Set<string>();
  for(const item of provided){
    const id=`${item.chatId}:${item.keyVersion}`;
    if(seen.has(id))throw Object.assign(new Error('key_provisioning_duplicate'),{statusCode:409});
    seen.add(id);
    if(item.chatId===input.chatId&&item.keyVersion===input.keyVersion){
      if(item.sealedKeyEnvelope!==input.sealedKeyEnvelope)throw Object.assign(new Error('key_provisioning_conflict'),{statusCode:409});
      continue;
    }
    const allowed=await tx.query(`
      SELECT 1
      FROM chats c
      JOIN chat_members cm ON cm.chat_id=c.id AND cm.member_id=$3
      JOIN conversation_key_versions ckv ON ckv.chat_id=c.id AND ckv.key_version=$4
      JOIN device_key_envelopes actor
        ON actor.chat_id=c.id AND actor.key_version=ckv.key_version AND actor.device_id=$5
      WHERE c.id=$1 AND c.family_id=$2
      LIMIT 1
    `,[item.chatId,input.familyId,device.member_id,item.keyVersion,input.actorDeviceId]);
    if(!allowed.rowCount)throw Object.assign(new Error('key_provisioning_not_authorized'),{statusCode:403});
  }

  await tx.query(`
    INSERT INTO device_key_envelopes(chat_id,key_version,device_id,sealed_key_envelope)
    VALUES($1,$2,$3,$4)
    ON CONFLICT(chat_id,key_version,device_id)
    DO UPDATE SET sealed_key_envelope=EXCLUDED.sealed_key_envelope
  `,[input.chatId,input.keyVersion,input.deviceId,input.sealedKeyEnvelope]);

  for(const item of provided){
    if(item.chatId===input.chatId&&item.keyVersion===input.keyVersion)continue;
    await tx.query(`
      INSERT INTO device_key_envelopes(chat_id,key_version,device_id,sealed_key_envelope)
      VALUES($1,$2,$3,$4)
      ON CONFLICT(chat_id,key_version,device_id)
      DO UPDATE SET sealed_key_envelope=EXCLUDED.sealed_key_envelope
    `,[item.chatId,item.keyVersion,input.deviceId,item.sealedKeyEnvelope]);
  }
  await tx.query(`UPDATE devices SET status='active' WHERE id=$1`,[input.deviceId]);
  return {memberId:device.member_id,provisionedKeyCount:provided.length};
}

export async function getCurrentKeyEnvelope(tx:PoolClient,input:{chatId:string;deviceId:string;familyId:string}){
  const r=await tx.query<{key_version:number;sealed_key_envelope:string}>(`SELECT e.key_version,e.sealed_key_envelope FROM device_key_envelopes e JOIN chats c ON c.id=e.chat_id WHERE e.chat_id=$1 AND e.device_id=$2 AND c.family_id=$3 ORDER BY e.key_version DESC LIMIT 1`,[input.chatId,input.deviceId,input.familyId]);
  const row=r.rows[0]; return row?{keyVersion:row.key_version,sealedKeyEnvelope:row.sealed_key_envelope}:null;
}

export async function listDeviceKeyEnvelopes(tx:PoolClient,input:{familyId:string;memberId:string;deviceId:string}){
  const r=await tx.query<{chat_id:string;key_version:number;sealed_key_envelope:string}>(`
    SELECT e.chat_id,e.key_version,e.sealed_key_envelope
    FROM device_key_envelopes e
    JOIN chats c ON c.id=e.chat_id AND c.family_id=$1
    JOIN chat_members cm ON cm.chat_id=c.id AND cm.member_id=$2
    WHERE e.device_id=$3
    ORDER BY e.chat_id,e.key_version
  `,[input.familyId,input.memberId,input.deviceId]);
  return r.rows.map(row=>({chatId:row.chat_id,keyVersion:row.key_version,sealedKeyEnvelope:row.sealed_key_envelope}));
}
