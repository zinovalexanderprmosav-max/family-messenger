import type {PoolClient} from 'pg';
import type {SessionPrincipal} from '../auth/session.js';
export function fail(error:string,statusCode:number):never{throw Object.assign(new Error(error),{statusCode});}
// All security mutations acquire the family lock first. This also protects
// device-set additions and absent rotation rows from phantoms.
export async function lockFamily(tx:PoolClient,familyId:string){
 const r=await tx.query<{primary_admin_member_id:string|null}>('SELECT primary_admin_member_id FROM families WHERE id=$1 FOR UPDATE',[familyId]);
 if(!r.rows[0])fail('family_not_found',404);
 return r.rows[0].primary_admin_member_id;
}
export async function assertActiveActor(tx:PoolClient,p:SessionPrincipal){
 const r=await tx.query<{role:'admin'|'member';status:string;device_status:string}>(`SELECT fm.role,fm.status,d.status AS device_status FROM family_memberships fm JOIN devices d ON d.family_id=fm.family_id AND d.member_id=fm.member_id WHERE fm.family_id=$1 AND fm.member_id=$2 AND d.id=$3 FOR UPDATE OF fm,d`,[p.familyId,p.memberId,p.deviceId]);
 const row=r.rows[0];if(!row||row.status!=='active')fail('authentication_required',401);
 if(row.device_status!=='active')fail('device_not_active',403);
 return row;
}
