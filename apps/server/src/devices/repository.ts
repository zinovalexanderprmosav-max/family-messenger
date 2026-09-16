import type { PoolClient } from 'pg';
import { canManageDevice,type FamilyRole } from '../auth/permissions.js';
import { scheduleRotationsForMember } from '../keys/rotation-schedule.js';

export type DeviceTarget={
  deviceId:string;
  memberId:string;
  memberDisplayName:string;
  memberRole:FamilyRole;
  deviceName:string;
  status:'pending_key'|'active'|'revoked';
  createdAt:Date;
  lastSeenAt:Date|null;
  encryptionPublicKey:string;
};

export async function listVisibleDevices(tx:PoolClient,input:{familyId:string;actorMemberId:string;actorRole:FamilyRole}){
  const memberFilter=input.actorRole==='member'?' AND d.member_id=$2':'';
  const params=input.actorRole==='member'?[input.familyId,input.actorMemberId]:[input.familyId];
  const r=await tx.query<{
    device_id:string;member_id:string;member_display_name:string;member_role:FamilyRole;device_name:string;status:'pending_key'|'active'|'revoked';created_at:Date;last_seen_at:Date|null;encryption_public_key:string;
  }>(`
    SELECT d.id AS device_id,d.member_id,m.display_name AS member_display_name,fm.role AS member_role,d.device_name,d.status,d.created_at,d.last_seen_at,d.encryption_public_key
    FROM devices d
    JOIN family_memberships fm ON fm.family_id=d.family_id AND fm.member_id=d.member_id
    JOIN members m ON m.id=d.member_id
    WHERE d.family_id=$1 AND fm.status='active'${memberFilter}
    ORDER BY CASE fm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,m.display_name,d.created_at,d.id
  `,params);
  return r.rows.map(row=>({
    deviceId:row.device_id,memberId:row.member_id,memberDisplayName:row.member_display_name,memberRole:row.member_role,
    deviceName:row.device_name,status:row.status,createdAt:row.created_at,lastSeenAt:row.last_seen_at,encryptionPublicKey:row.encryption_public_key,
    canManage:canManageDevice({actorRole:input.actorRole,actorMemberId:input.actorMemberId,targetRole:row.member_role,targetMemberId:row.member_id})
  }));
}

export async function findDeviceForUpdate(tx:PoolClient,familyId:string,deviceId:string):Promise<DeviceTarget|null>{
  const r=await tx.query<{
    device_id:string;member_id:string;member_display_name:string;member_role:FamilyRole;device_name:string;status:'pending_key'|'active'|'revoked';created_at:Date;last_seen_at:Date|null;encryption_public_key:string;
  }>(`
    SELECT d.id AS device_id,d.member_id,m.display_name AS member_display_name,fm.role AS member_role,d.device_name,d.status,d.created_at,d.last_seen_at,d.encryption_public_key
    FROM devices d
    JOIN family_memberships fm ON fm.family_id=d.family_id AND fm.member_id=d.member_id
    JOIN members m ON m.id=d.member_id
    WHERE d.family_id=$1 AND d.id=$2 AND fm.status='active'
    FOR UPDATE OF d,fm
  `,[familyId,deviceId]);
  const row=r.rows[0];
  return row?{deviceId:row.device_id,memberId:row.member_id,memberDisplayName:row.member_display_name,memberRole:row.member_role,deviceName:row.device_name,status:row.status,createdAt:row.created_at,lastSeenAt:row.last_seen_at,encryptionPublicKey:row.encryption_public_key}:null;
}

export async function renameDevice(tx:PoolClient,deviceId:string,deviceName:string){
  const r=await tx.query<{device_name:string}>(`UPDATE devices SET device_name=$2 WHERE id=$1 RETURNING device_name`,[deviceId,deviceName]);
  return r.rows[0]!.device_name;
}

export async function revokeDevice(tx:PoolClient,target:DeviceTarget){
  if(target.status==='revoked') return;
  if(target.memberRole==='owner'&&target.status==='active'){
    const count=await tx.query<{count:string}>(`
      SELECT count(*)::text count
      FROM devices d
      JOIN family_memberships fm ON fm.family_id=d.family_id AND fm.member_id=d.member_id
      WHERE d.family_id=(SELECT family_id FROM devices WHERE id=$1)
        AND d.member_id=$2 AND d.status='active' AND fm.role='owner' AND fm.status='active'
    `,[target.deviceId,target.memberId]);
    if(Number(count.rows[0]!.count)<=1) throw Object.assign(new Error('owner_last_device'),{statusCode:409});
  }
  await tx.query(`DELETE FROM sessions WHERE device_id=$1`,[target.deviceId]);
  await tx.query(`UPDATE devices SET status='revoked',revoked_at=COALESCE(revoked_at,now()) WHERE id=$1`,[target.deviceId]);
  await scheduleRotationsForMember(tx,target.memberId,'device_revoked');
}
