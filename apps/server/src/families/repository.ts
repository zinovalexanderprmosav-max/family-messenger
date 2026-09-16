import type { PoolClient } from 'pg';

export type BootstrapInput = {
  familyDisplayName:string; memberDisplayName:string; deviceName:string;
  encryptionPublicKey:string; signingPublicKey:string; initialFamilyChatKeyEnvelope:string;
};

export async function createFamilyBootstrap(tx:PoolClient,input:BootstrapInput) {
  const family = await tx.query<{id:string}>(`INSERT INTO families(display_name) VALUES($1) RETURNING id`,[input.familyDisplayName]);
  const familyId=family.rows[0]!.id;
  const member = await tx.query<{id:string}>(`INSERT INTO members(display_name) VALUES($1) RETURNING id`,[input.memberDisplayName]);
  const memberId=member.rows[0]!.id;
  await tx.query(`INSERT INTO family_memberships(family_id,member_id,role,status) VALUES($1,$2,'admin','active')`,[familyId,memberId]);
  const device = await tx.query<{id:string}>(`INSERT INTO devices(family_id,member_id,device_name,encryption_public_key,signing_public_key,status) VALUES($1,$2,$3,$4,$5,'active') RETURNING id`,[familyId,memberId,input.deviceName,input.encryptionPublicKey,input.signingPublicKey]);
  const deviceId=device.rows[0]!.id;
  const chat=await tx.query<{id:string}>(`INSERT INTO chats(family_id,kind) VALUES($1,'family') RETURNING id`,[familyId]);
  const familyChatId=chat.rows[0]!.id;
  await tx.query(`INSERT INTO chat_members(chat_id,member_id) VALUES($1,$2)`,[familyChatId,memberId]);
  await tx.query(`INSERT INTO conversation_key_versions(chat_id,key_version) VALUES($1,1)`,[familyChatId]);
  await tx.query(`INSERT INTO device_key_envelopes(chat_id,key_version,device_id,sealed_key_envelope) VALUES($1,1,$2,$3)`,[familyChatId,deviceId,input.initialFamilyChatKeyEnvelope]);
  return {familyId,memberId,deviceId,familyChatId,keyVersion:1 as const};
}

export async function getFamilySummary(tx:PoolClient,familyId:string) {
  const family=await tx.query<{id:string;display_name:string}>(`SELECT id,display_name FROM families WHERE id=$1`,[familyId]);
  if(!family.rows[0]) return null;
  const members=await tx.query<{id:string;display_name:string;role:'admin'|'member';status:string}>(`
    SELECT m.id,m.display_name,fm.role,fm.status FROM members m JOIN family_memberships fm ON fm.member_id=m.id WHERE fm.family_id=$1 ORDER BY fm.created_at`,[familyId]);
  const chat=await tx.query<{id:string}>(`SELECT id FROM chats WHERE family_id=$1 AND kind='family'`,[familyId]);
  return {id:family.rows[0].id,displayName:family.rows[0].display_name,familyChatId:chat.rows[0]?.id ?? null,members:members.rows.map(r=>({id:r.id,displayName:r.display_name,role:r.role,status:r.status}))};
}

export async function promoteAdministrator(tx:PoolClient,familyId:string,memberId:string) {
  const locked=await tx.query(`SELECT id FROM families WHERE id=$1 FOR UPDATE`,[familyId]);
  if(!locked.rowCount) throw new Error('family_not_found');
  const admins=await tx.query<{count:string}>(`SELECT count(*)::text count FROM family_memberships WHERE family_id=$1 AND role='admin' AND status='active'`,[familyId]);
  if(Number(admins.rows[0]!.count)>=2) throw new Error('administrator_limit_reached');
  const result=await tx.query(`UPDATE family_memberships SET role='admin' WHERE family_id=$1 AND member_id=$2 AND status='active'`,[familyId,memberId]);
  if(!result.rowCount) throw new Error('member_not_found');
}

export async function assertDeviceCapacity(tx:PoolClient,memberId:string) {
  await tx.query(`SELECT id FROM members WHERE id=$1 FOR UPDATE`,[memberId]);
  const count=await tx.query<{count:string}>(`SELECT count(*)::text count FROM devices WHERE member_id=$1 AND status <> 'revoked'`,[memberId]);
  if(Number(count.rows[0]!.count)>=3) throw new Error('device_limit_reached');
}
