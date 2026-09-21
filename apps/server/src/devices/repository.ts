import type {PoolClient} from 'pg';
import type {SessionPrincipal} from '../auth/session.js';
import {appendAuditEvent} from '../audit/repository.js';
import {assertActiveActor,fail,lockFamily} from '../families/access.js';
import {requireRotationsForRevokedDevices} from '../key-rotation/repository.js';

export async function revokeDeviceRows(tx:PoolClient,p:SessionPrincipal,deviceIds:string[],source:string){
 const changed=await tx.query<{id:string;member_id:string}>(`UPDATE devices SET status='revoked',revoked_at=now() WHERE family_id=$1 AND id=ANY($2::uuid[]) AND status<>'revoked' RETURNING id,member_id`,[p.familyId,deviceIds]);
 const changedIds=changed.rows.map(r=>r.id);
 await tx.query(`UPDATE device_enrollments SET revoked_at=now() WHERE created_by_device_id=ANY($1::uuid[]) AND consumed_at IS NULL AND revoked_at IS NULL`,[deviceIds]);
 await tx.query('DELETE FROM sessions WHERE device_id=ANY($1::uuid[])',[deviceIds]);
 await tx.query('DELETE FROM auth_challenges WHERE device_id=ANY($1::uuid[])',[deviceIds]);
 await requireRotationsForRevokedDevices(tx,p,changedIds);
 for(const row of changed.rows)await appendAuditEvent(tx,{familyId:p.familyId,actorDeviceId:p.deviceId,eventType:'device.revoked',details:{deviceId:row.id,memberId:row.member_id,source}});
 return changedIds;
}
export async function revokeDevice(tx:PoolClient,p:SessionPrincipal,deviceId:string){
 const primary=await lockFamily(tx,p.familyId),actor=await assertActiveActor(tx,p);
 const target=(await tx.query<{member_id:string;role:string}>(`SELECT d.member_id,fm.role FROM devices d JOIN family_memberships fm ON fm.family_id=d.family_id AND fm.member_id=d.member_id WHERE d.id=$1 AND d.family_id=$2 FOR UPDATE OF d,fm`,[deviceId,p.familyId])).rows[0];
 if(!target)fail('device_not_found',404);
 if(deviceId===p.deviceId)fail('cannot_revoke_current_device',409);
 if(target.member_id!==p.memberId){
  if(actor.role!=='admin')fail('administrator_required',403);
  if(target.member_id===primary||(p.memberId!==primary&&target.role==='admin'))fail('device_protected',403);
 }
 return revokeDeviceRows(tx,p,[deviceId],'device_revoke');
}

export async function listVisibleDevices(tx:PoolClient,p:SessionPrincipal){
 const actor=await assertActiveActor(tx,p);
 const rows=await tx.query<{
  id:string;member_id:string;member_display_name:string;device_name:string;
  status:'pending_key'|'active'|'revoked';created_at:Date;revoked_at:Date|null;role:'admin'|'member';
 }>(`
  SELECT d.id,d.member_id,m.display_name AS member_display_name,d.device_name,d.status,d.created_at,d.revoked_at,fm.role
  FROM devices d
  JOIN members m ON m.id=d.member_id
  JOIN family_memberships fm ON fm.family_id=d.family_id AND fm.member_id=d.member_id
  WHERE d.family_id=$1
    AND ($2::boolean OR d.member_id=$3)
  ORDER BY (d.member_id=$3) DESC,m.display_name,d.created_at,d.id
 `,[p.familyId,actor.role==='admin',p.memberId]);
 return rows.rows.map(row=>({
  deviceId:row.id,
  memberId:row.member_id,
  memberDisplayName:row.member_display_name,
  memberRole:row.role,
  deviceName:row.device_name,
  status:row.status,
  current:row.id===p.deviceId,
  createdAt:row.created_at.toISOString(),
  revokedAt:row.revoked_at?.toISOString()??null
 }));
}
