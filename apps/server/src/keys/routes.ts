import {lockFamily,assertActiveActor,fail} from '../families/access.js';
import type { FastifyInstance } from 'fastify';
import { ApproveDeviceRequest } from '@family-messenger/protocol';
import type { DatabasePool } from '../db/pool.js';
import { requireSession } from '../auth/session.js';
import { requireCsrf } from '../auth/csrf.js';
import { approveDevice, getCurrentKeyEnvelope, listDeviceKeyEnvelopes, listPendingDevices } from './repository.js';
import { appendAuditEvent } from '../audit/repository.js';

async function activeRole(pool:DatabasePool,familyId:string,memberId:string){
  const r=await pool.query<{role:'admin'|'member'}>(`SELECT role FROM family_memberships WHERE family_id=$1 AND member_id=$2 AND status='active'`,[familyId,memberId]);
  return r.rows[0]?.role??null;
}

export async function registerKeyRoutes(app:FastifyInstance,pool:DatabasePool){
  app.get('/v1/devices/pending',async(request,reply)=>{
    const p=await requireSession(request,pool);
    if(p.deviceStatus!=='active')return reply.code(403).send({error:'device_not_active'});
    const role=await activeRole(pool,p.familyId,p.memberId);
    if(!role)return reply.code(401).send({error:'authentication_required'});
    const tx=await pool.connect();
    try{return {items:await listPendingDevices(tx,p.familyId,role==='admin'?undefined:p.memberId)};}
    finally{tx.release();}
  });

  app.post<{Params:{deviceId:string}}>('/v1/devices/:deviceId/approve',async(request,reply)=>{
    const p=await requireSession(request,pool);requireCsrf(request,p);
    if(p.deviceStatus!=='active')return reply.code(403).send({error:'device_not_active'});
    const input=ApproveDeviceRequest.parse(request.body);const tx=await pool.connect();
    try{
      await tx.query('BEGIN');
      await lockFamily(tx,p.familyId);
      const actor=await assertActiveActor(tx,p);
      const target=(await tx.query<{member_id:string}>(`
        SELECT member_id FROM devices WHERE id=$1 AND family_id=$2
      `,[request.params.deviceId,p.familyId])).rows[0];
      if(!target)fail('device_not_found',404);
      const ownDevice=target.member_id===p.memberId;
      if(!ownDevice&&actor.role!=='admin')fail('administrator_required',403);
      if(!ownDevice&&(input.provisionedKeys?.length??0)>0)fail('history_provisioning_forbidden',403);
      const approved=await approveDevice(tx,{
        familyId:p.familyId,
        deviceId:request.params.deviceId,
        actorDeviceId:p.deviceId,
        chatId:input.chatId,
        keyVersion:input.keyVersion,
        sealedKeyEnvelope:input.sealedKeyEnvelope,
        allowHistorical:ownDevice,
        ...(input.provisionedKeys!==undefined?{provisionedKeys:input.provisionedKeys}:{})
      });
      await appendAuditEvent(tx,{
        familyId:p.familyId,actorDeviceId:p.deviceId,eventType:'device.approved',
        details:{
          deviceId:request.params.deviceId,chatId:input.chatId,keyVersion:input.keyVersion,
          provisionedKeyCount:approved.provisionedKeyCount
        }
      });
      await tx.query('COMMIT');return reply.code(204).send();
    }catch(error){await tx.query('ROLLBACK');throw error;}finally{tx.release();}
  });

  app.get('/v1/keys/device/envelopes',async(request,reply)=>{
    const p=await requireSession(request,pool);
    if(p.deviceStatus==='pending_key')return reply.code(404).send({error:'key_envelope_not_ready'});
    if(p.deviceStatus!=='active')return reply.code(403).send({error:'device_not_active'});
    const tx=await pool.connect();
    try{return {items:await listDeviceKeyEnvelopes(tx,{familyId:p.familyId,memberId:p.memberId,deviceId:p.deviceId})};}
    finally{tx.release();}
  });

  app.get<{Params:{chatId:string}}>('/v1/keys/chat/:chatId/current',async(request,reply)=>{
    const p=await requireSession(request,pool); if(p.deviceStatus!=='active') return reply.code(403).send({error:'device_revoked'});
    const tx=await pool.connect(); try{const envelope=await getCurrentKeyEnvelope(tx,{chatId:request.params.chatId,deviceId:p.deviceId,familyId:p.familyId});if(!envelope) return reply.code(404).send({error:'key_envelope_not_ready'});return envelope;}finally{tx.release();}
  });
}
