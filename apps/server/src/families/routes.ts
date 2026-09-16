import type { FastifyInstance } from 'fastify';
import { BootstrapFamilyRequest } from '@family-messenger/protocol';
import type { DatabasePool } from '../db/pool.js';
import { appendAuditEvent } from '../audit/repository.js';
import { createFamilyBootstrap, getFamilySummary, promoteAdministrator } from './repository.js';
import { createSession, requireSession, setSessionCookie } from '../auth/session.js';
import { requireCsrf } from '../auth/csrf.js';
import { requireOwner } from '../auth/permissions.js';

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

  app.get('/v1/family',async(request)=>{
    const principal=await requireSession(request,pool);
    const tx=await pool.connect();
    try{return await getFamilySummary(tx,principal.familyId);}finally{tx.release();}
  });

  app.post<{Params:{memberId:string}}>('/v1/family/admins/:memberId/promote',async(request,reply)=>{
    const principal=await requireSession(request,pool);
    requireCsrf(request,principal);
    requireOwner(principal);
    const tx=await pool.connect();
    try{
      await tx.query('BEGIN');
      await promoteAdministrator(tx,principal.familyId,request.params.memberId);
      await appendAuditEvent(tx,{familyId:principal.familyId,actorDeviceId:principal.deviceId,eventType:'family.admin.promoted',details:{memberId:request.params.memberId}});
      await tx.query('COMMIT');
      return reply.code(204).send();
    }catch(error){
      await tx.query('ROLLBACK');
      if(error instanceof Error&&error.message==='administrator_limit_reached') return reply.code(409).send({error:error.message});
      throw error;
    }finally{tx.release();}
  });
}
