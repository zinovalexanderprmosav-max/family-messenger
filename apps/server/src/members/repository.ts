import type {PoolClient} from 'pg';
import type {SessionPrincipal} from '../auth/session.js';
import {assertActiveActor,lockFamily,fail} from '../families/access.js';
import {revokeDeviceRows} from '../devices/repository.js';
import {appendAuditEvent} from '../audit/repository.js';
export async function removeFamilyMember(tx:PoolClient,p:SessionPrincipal,memberId:string){
 const primary=await lockFamily(tx,p.familyId),actor=await assertActiveActor(tx,p);
 const target=(await tx.query<{role:string;status:string}>(`SELECT role,status FROM family_memberships WHERE family_id=$1 AND member_id=$2 FOR UPDATE`,[p.familyId,memberId])).rows[0];
 if(!target)fail('member_not_found',404);
 if(actor.role!=='admin')fail('administrator_required',403);
 if(memberId===primary)fail('primary_administrator_protected',409);
 if(memberId===p.memberId||(p.memberId!==primary&&target.role==='admin'))fail('member_protected',403);
 const devices=(await tx.query<{id:string}>('SELECT id FROM devices WHERE family_id=$1 AND member_id=$2 ORDER BY id FOR UPDATE',[p.familyId,memberId])).rows.map(r=>r.id);
 if(target.status==='removed')return devices;
 await tx.query(`UPDATE family_memberships SET status='removed' WHERE family_id=$1 AND member_id=$2`,[p.familyId,memberId]);
 await tx.query(`UPDATE chats SET write_disabled_at=now(),write_disabled_reason='member_removed' WHERE family_id=$1 AND kind='direct' AND write_disabled_at IS NULL AND EXISTS(SELECT 1 FROM chat_members WHERE chat_id=chats.id AND member_id=$2)`,[p.familyId,memberId]);
 await revokeDeviceRows(tx,p,devices,'member_removal');
 await appendAuditEvent(tx,{familyId:p.familyId,actorDeviceId:p.deviceId,eventType:'family.member.removed',details:{memberId}});
 return devices;
}
