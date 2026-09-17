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
