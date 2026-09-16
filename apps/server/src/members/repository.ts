import type { PoolClient } from 'pg';
import type { FamilyRole } from '../auth/permissions.js';
import { scheduleRotationsForMember } from '../keys/rotation-schedule.js';

export async function listContacts(tx:PoolClient,familyId:string,currentMemberId:string){
  const r=await tx.query<{member_id:string;display_name:string;role:FamilyRole}>(`
    SELECT m.id AS member_id,m.display_name,fm.role
    FROM family_memberships fm
    JOIN members m ON m.id=fm.member_id
    WHERE fm.family_id=$1 AND fm.status='active' AND fm.member_id<>$2
    ORDER BY CASE fm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,lower(m.display_name),m.id
  `,[familyId,currentMemberId]);
  return r.rows.map(row=>({memberId:row.member_id,displayName:row.display_name,role:row.role}));
}

export async function listMembers(tx:PoolClient,familyId:string){
  const r=await tx.query<{member_id:string;display_name:string;role:FamilyRole;status:'active'|'removed';device_count:string}>(`
    SELECT m.id AS member_id,m.display_name,fm.role,fm.status,count(d.id) FILTER (WHERE d.status<>'revoked')::text AS device_count
    FROM family_memberships fm
    JOIN members m ON m.id=fm.member_id
    LEFT JOIN devices d ON d.family_id=fm.family_id AND d.member_id=fm.member_id
    WHERE fm.family_id=$1
    GROUP BY m.id,m.display_name,fm.role,fm.status,fm.created_at
    ORDER BY CASE fm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,fm.created_at,m.id
  `,[familyId]);
  return r.rows.map(row=>({memberId:row.member_id,displayName:row.display_name,role:row.role,status:row.status,deviceCount:Number(row.device_count)}));
}

export async function findMembershipForUpdate(tx:PoolClient,familyId:string,memberId:string){
  const r=await tx.query<{role:FamilyRole;status:'active'|'removed'}>(`
    SELECT role,status FROM family_memberships
    WHERE family_id=$1 AND member_id=$2
    FOR UPDATE
  `,[familyId,memberId]);
  return r.rows[0]??null;
}

export async function removeMember(tx:PoolClient,input:{familyId:string;memberId:string}){
  await tx.query(`UPDATE family_memberships SET status='removed' WHERE family_id=$1 AND member_id=$2 AND status='active'`,[input.familyId,input.memberId]);
  const devices=await tx.query<{id:string}>(`SELECT id FROM devices WHERE family_id=$1 AND member_id=$2 AND status<>'revoked' FOR UPDATE`,[input.familyId,input.memberId]);
  if(devices.rows.length){
    const ids=devices.rows.map(row=>row.id);
    await tx.query(`DELETE FROM sessions WHERE device_id=ANY($1::uuid[])`,[ids]);
    await tx.query(`UPDATE devices SET status='revoked',revoked_at=COALESCE(revoked_at,now()) WHERE id=ANY($1::uuid[])`,[ids]);
  }
  await scheduleRotationsForMember(tx,input.memberId,'member_removed');
}

export async function demoteAdministrator(tx:PoolClient,familyId:string,memberId:string){
  const r=await tx.query(`UPDATE family_memberships SET role='member' WHERE family_id=$1 AND member_id=$2 AND role='admin' AND status='active'`,[familyId,memberId]);
  if(!r.rowCount) throw Object.assign(new Error('administrator_not_found'),{statusCode:404});
}
