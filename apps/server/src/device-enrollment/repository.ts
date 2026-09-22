import type {PoolClient} from 'pg';
import {assertDeviceCapacity} from '../families/repository.js';
import {lockFamily} from '../families/access.js';

export async function createDeviceEnrollment(tx:PoolClient,input:{
  familyId:string;memberId:string;createdByDeviceId:string;tokenHash:string;expiresAt:Date;
}){
  await tx.query(`
    UPDATE device_enrollments
    SET revoked_at=now()
    WHERE family_id=$1 AND member_id=$2
      AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>now()
  `,[input.familyId,input.memberId]);
  const r=await tx.query<{id:string;expires_at:Date}>(`
    INSERT INTO device_enrollments(family_id,member_id,created_by_device_id,token_hash,expires_at)
    VALUES($1,$2,$3,$4,$5)
    RETURNING id,expires_at
  `,[input.familyId,input.memberId,input.createdByDeviceId,input.tokenHash,input.expiresAt]);
  return {id:r.rows[0]!.id,expiresAt:r.rows[0]!.expires_at.toISOString()};
}

function validateEnrollment(row:{
  expires_at:Date;consumed_at:Date|null;revoked_at:Date|null;
  creator_status:string;membership_status:string;
}){
  if(row.revoked_at||row.creator_status!=='active'||row.membership_status!=='active')throw new Error('device_enrollment_revoked');
  if(row.consumed_at)throw new Error('device_enrollment_consumed');
  if(row.expires_at.getTime()<=Date.now())throw new Error('device_enrollment_expired');
}

export async function inspectDeviceEnrollment(tx:PoolClient,tokenHash:string){
  const r=await tx.query<{
    id:string;family_id:string;member_id:string;expires_at:Date;consumed_at:Date|null;revoked_at:Date|null;
    creator_status:string;membership_status:string;family_display_name:string;member_display_name:string;
  }>(`
    SELECT de.id,de.family_id,de.member_id,de.expires_at,de.consumed_at,de.revoked_at,
           d.status AS creator_status,fm.status AS membership_status,
           f.display_name AS family_display_name,m.display_name AS member_display_name
    FROM device_enrollments de
    JOIN devices d ON d.id=de.created_by_device_id
    JOIN family_memberships fm ON fm.family_id=de.family_id AND fm.member_id=de.member_id
    JOIN families f ON f.id=de.family_id
    JOIN members m ON m.id=de.member_id
    WHERE de.token_hash=$1
  `,[tokenHash]);
  const row=r.rows[0];if(!row)throw new Error('device_enrollment_invalid');
  validateEnrollment(row);
  return {
    enrollmentId:row.id,familyId:row.family_id,memberId:row.member_id,
    familyDisplayName:row.family_display_name,memberDisplayName:row.member_display_name,
    expiresAt:row.expires_at.toISOString()
  };
}

export async function acceptDeviceEnrollment(tx:PoolClient,tokenHash:string,input:{
  deviceName:string;encryptionPublicKey:string;signingPublicKey:string;
}){
  const family=(await tx.query<{family_id:string}>(`
    SELECT family_id FROM device_enrollments WHERE token_hash=$1
  `,[tokenHash])).rows[0];
  if(!family)throw new Error('device_enrollment_invalid');
  await lockFamily(tx,family.family_id);
  const r=await tx.query<{
    id:string;family_id:string;member_id:string;expires_at:Date;consumed_at:Date|null;revoked_at:Date|null;
    creator_status:string;membership_status:string;
  }>(`
    SELECT de.id,de.family_id,de.member_id,de.expires_at,de.consumed_at,de.revoked_at,
           d.status AS creator_status,fm.status AS membership_status
    FROM device_enrollments de
    JOIN devices d ON d.id=de.created_by_device_id
    JOIN family_memberships fm ON fm.family_id=de.family_id AND fm.member_id=de.member_id
    WHERE de.token_hash=$1
    FOR UPDATE OF de
  `,[tokenHash]);
  const row=r.rows[0];if(!row)throw new Error('device_enrollment_invalid');
  validateEnrollment(row);
  await assertDeviceCapacity(tx,row.member_id);
  const device=await tx.query<{id:string}>(`
    INSERT INTO devices(family_id,member_id,device_name,encryption_public_key,signing_public_key,status)
    VALUES($1,$2,$3,$4,$5,'pending_key')
    RETURNING id
  `,[row.family_id,row.member_id,input.deviceName,input.encryptionPublicKey,input.signingPublicKey]);
  await tx.query('UPDATE device_enrollments SET consumed_at=now() WHERE id=$1',[row.id]);
  const chat=await tx.query<{id:string}>(`
    SELECT id FROM chats WHERE family_id=$1 AND kind='family'
  `,[row.family_id]);
  if(!chat.rows[0])throw new Error('family_chat_not_found');
  return {
    enrollmentId:row.id,familyId:row.family_id,memberId:row.member_id,
    deviceId:device.rows[0]!.id,familyChatId:chat.rows[0].id,status:'pending_key' as const
  };
}
