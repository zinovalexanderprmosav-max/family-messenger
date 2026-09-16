import type { FastifyInstance } from 'fastify';
import type { DatabasePool } from '../db/pool.js';
import { requireSession } from '../auth/session.js';
import { requireCsrf } from '../auth/csrf.js';
import { canManageMember,requireAdministrator } from '../auth/permissions.js';
import { appendAuditEvent } from '../audit/repository.js';
import { findMembershipForUpdate,listContacts,listMembers,removeMember } from './repository.js';

export async function registerMemberRoutes(app:FastifyInstance,pool:DatabasePool){
  app.get('/v1/contacts',async(request)=>{
    const p=await requireSession(request,pool);
    const tx=await pool.connect();
    try{return {items:await listContacts(tx,p.familyId,p.memberId)};}finally{tx.release();}
  });

  app.get('/v1/members',async(request)=>{
    const p=await requireSession(request,pool);
    requireAdministrator(p);
    const tx=await pool.connect();
    try{return {items:await listMembers(tx,p.familyId)};}finally{tx.release();}
  });

  app.delete<{Params:{memberId:string}}>('/v1/members/:memberId',async(request,reply)=>{
    const p=await requireSession(request,pool);
    requireCsrf(request,p);
    const tx=await pool.connect();
    try{
      await tx.query('BEGIN');
      const target=await findMembershipForUpdate(tx,p.familyId,request.params.memberId);
      if(!target||target.status!=='active'){
        await tx.query('ROLLBACK');
        return reply.code(404).send({error:'member_not_found'});
      }
      if(!canManageMember({actorRole:p.role,actorMemberId:p.memberId,targetRole:target.role,targetMemberId:request.params.memberId})){
        await tx.query('ROLLBACK');
        return reply.code(403).send({error:'member_management_forbidden'});
      }
      await removeMember(tx,{familyId:p.familyId,memberId:request.params.memberId});
      await appendAuditEvent(tx,{familyId:p.familyId,actorDeviceId:p.deviceId,eventType:'family.member.removed',details:{memberId:request.params.memberId}});
      await tx.query('COMMIT');
      return reply.code(204).send();
    }catch(error){await tx.query('ROLLBACK');throw error;}finally{tx.release();}
  });
}
