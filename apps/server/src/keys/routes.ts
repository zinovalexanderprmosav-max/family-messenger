import type { FastifyInstance } from 'fastify';
import { ApproveDeviceRequest } from '@family-messenger/protocol';
import type { DatabasePool } from '../db/pool.js';
import { requireSession } from '../auth/session.js';
import { requireCsrf } from '../auth/csrf.js';
import { approveDevice, getCurrentKeyEnvelope, listPendingDevices } from './repository.js';
import { appendAuditEvent } from '../audit/repository.js';

async function isAdmin(pool:DatabasePool,familyId:string,memberId:string){
  const r=await pool.query(`SELECT 1 FROM family_memberships WHERE family_id=$1 AND member_id=$2 AND role='admin' AND status='active'`,[familyId,memberId]); return Boolean(r.rowCount);
}

export async function registerKeyRoutes(app:FastifyInstance,pool:DatabasePool){
  app.get('/v1/devices/pending',async(request,reply)=>{
    const p=await requireSession(request,pool); if(p.deviceStatus!=='active'||!(await isAdmin(pool,p.familyId,p.memberId))) return reply.code(403).send({error:'administrator_required'});
    const tx=await pool.connect(); try{return {items:await listPendingDevices(tx,p.familyId)};}finally{tx.release();}
  });

  app.post<{Params:{deviceId:string}}>('/v1/devices/:deviceId/approve',async(request,reply)=>{
    const p=await requireSession(request,pool); requireCsrf(request,p); if(p.deviceStatus!=='active'||!(await isAdmin(pool,p.familyId,p.memberId))) return reply.code(403).send({error:'administrator_required'});
    const input=ApproveDeviceRequest.parse(request.body); const tx=await pool.connect();
    try{await tx.query('BEGIN');await approveDevice(tx,{familyId:p.familyId,deviceId:request.params.deviceId,...input});await appendAuditEvent(tx,{familyId:p.familyId,actorDeviceId:p.deviceId,eventType:'device.approved',details:{deviceId:request.params.deviceId,chatId:input.chatId,keyVersion:input.keyVersion}});await tx.query('COMMIT');return reply.code(204).send();}
    catch(error){await tx.query('ROLLBACK');throw error;}finally{tx.release();}
  });

  app.get<{Params:{chatId:string}}>('/v1/keys/chat/:chatId/current',async(request,reply)=>{
    const p=await requireSession(request,pool);
    const tx=await pool.connect(); try{const envelope=await getCurrentKeyEnvelope(tx,{chatId:request.params.chatId,deviceId:p.deviceId,familyId:p.familyId});if(!envelope) return reply.code(404).send({error:'key_envelope_not_ready'});return envelope;}finally{tx.release();}
  });
}
