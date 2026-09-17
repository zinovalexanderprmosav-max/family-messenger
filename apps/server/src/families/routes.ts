import type { FastifyInstance } from 'fastify';
import { BootstrapFamilyRequest } from '@family-messenger/protocol';
import type { DatabasePool } from '../db/pool.js';
import { appendAuditEvent } from '../audit/repository.js';
import { createFamilyBootstrap, demoteAdministrator, getFamilySummary, promoteAdministrator } from './repository.js';
import { createSession, requireSession, setSessionCookie, type SessionPrincipal } from '../auth/session.js';
import { requireCsrf } from '../auth/csrf.js';

async function assertPrimaryAdministrator(tx: import('pg').PoolClient, principal:SessionPrincipal){
  const result=await tx.query<{
    primary_admin_member_id:string|null;
    actor_role:string|null;
    actor_status:string|null;
    primary_role:string|null;
    primary_status:string|null;
  }>(`
    SELECT
      f.primary_admin_member_id,
      actor.role AS actor_role,
      actor.status AS actor_status,
      primary_membership.role AS primary_role,
      primary_membership.status AS primary_status
    FROM families f
    LEFT JOIN family_memberships actor
      ON actor.family_id=f.id AND actor.member_id=$2
    LEFT JOIN family_memberships primary_membership
      ON primary_membership.family_id=f.id
     AND primary_membership.member_id=f.primary_admin_member_id
    WHERE f.id=$1
  `,[principal.familyId,principal.memberId]);
  const row=result.rows[0];
  if(!row?.primary_admin_member_id||row.primary_role!=='admin'||row.primary_status!=='active'){
    throw Object.assign(new Error('primary_administrator_not_configured'),{statusCode:409});
  }
  if(row.primary_admin_member_id!==principal.memberId||row.actor_role!=='admin'||row.actor_status!=='active'){
    throw Object.assign(new Error('primary_administrator_required'),{statusCode:403});
  }
}

function sendFamilyAdminError(reply: import('fastify').FastifyReply,error:unknown){
  if(!(error instanceof Error)) return false;
  if(error.message==='primary_administrator_not_configured'||error.message==='primary_administrator_protected'||error.message==='administrator_limit_reached'){
    reply.code(409).send({error:error.message});return true;
  }
  if(error.message==='member_not_found'||error.message==='family_not_found'){
    reply.code(404).send({error:error.message});return true;
  }
  return false;
}

export async function registerFamilyRoutes(app:FastifyInstance,pool:DatabasePool,production:boolean){
  app.post('/v1/families/bootstrap',async(request,reply)=>{
    const input=BootstrapFamilyRequest.parse(request.body);
    const tx=await pool.connect();
    try{
      await tx.query('BEGIN');
      const created=await createFamilyBootstrap(tx,input);
      const session=await createSession(tx,{deviceId:created.deviceId,memberId:created.memberId,familyId:created.familyId});
      await appendAuditEvent(tx,{familyId:created.familyId,actorDeviceId:created.deviceId,eventType:'family.bootstrap'});
      await tx.query('COMMIT');
      setSessionCookie(reply,session.token,production);
      return reply.code(201).send({...created,csrfToken:session.csrfToken});
    }catch(error){await tx.query('ROLLBACK');throw error;}finally{tx.release();}
  });

  app.get('/v1/family',async(request,reply)=>{
    const principal=await requireSession(request,pool);
    if(principal.deviceStatus==='revoked') return reply.code(401).send({error:'authentication_required'});
    const tx=await pool.connect();
    try{return await getFamilySummary(tx,principal.familyId);}finally{tx.release();}
  });

  app.post<{Params:{memberId:string}}>('/v1/family/admins/:memberId/promote',async(request,reply)=>{
    const principal=await requireSession(request,pool); requireCsrf(request,principal);
    const tx=await pool.connect();
    try{
      await tx.query('BEGIN');
      await assertPrimaryAdministrator(tx,principal);
      if(request.params.memberId===principal.memberId) throw Object.assign(new Error('primary_administrator_protected'),{statusCode:409});
      await promoteAdministrator(tx,principal.familyId,request.params.memberId);
      await appendAuditEvent(tx,{familyId:principal.familyId,actorDeviceId:principal.deviceId,eventType:'family.admin.promoted',details:{memberId:request.params.memberId}});
      await tx.query('COMMIT'); return reply.code(204).send();
    }catch(error){
      await tx.query('ROLLBACK');
      if(sendFamilyAdminError(reply,error)) return;
      throw error;
    }finally{tx.release();}
  });

  app.post<{Params:{memberId:string}}>('/v1/family/admins/:memberId/demote',async(request,reply)=>{
    const principal=await requireSession(request,pool); requireCsrf(request,principal);
    const tx=await pool.connect();
    try{
      await tx.query('BEGIN');
      await assertPrimaryAdministrator(tx,principal);
      if(request.params.memberId===principal.memberId) throw Object.assign(new Error('primary_administrator_protected'),{statusCode:409});
      await demoteAdministrator(tx,principal.familyId,request.params.memberId);
      await appendAuditEvent(tx,{familyId:principal.familyId,actorDeviceId:principal.deviceId,eventType:'family.admin.demoted',details:{memberId:request.params.memberId}});
      await tx.query('COMMIT'); return reply.code(204).send();
    }catch(error){
      await tx.query('ROLLBACK');
      if(sendFamilyAdminError(reply,error)) return;
      throw error;
    }finally{tx.release();}
  });
}
