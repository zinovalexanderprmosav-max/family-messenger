import type { FastifyInstance } from 'fastify';
import { ApproveDeviceRequest,CompleteKeyRotationRequest } from '@family-messenger/protocol';
import type { DatabasePool } from '../db/pool.js';
import { requireSession } from '../auth/session.js';
import { requireCsrf } from '../auth/csrf.js';
import { requireAdministrator } from '../auth/permissions.js';
import { approveDevice,getCurrentKeyEnvelope,listPendingDevices } from './repository.js';
import { completeKeyRotation,listPendingRotations } from './rotation.js';
import { appendAuditEvent } from '../audit/repository.js';

export async function registerKeyRoutes(app:FastifyInstance,pool:DatabasePool){
  app.get('/v1/devices/pending',async(request,reply)=>{
    const p=await requireSession(request,pool);
    if(p.deviceStatus!=='active') return reply.code(403).send({error:'device_not_active'});
    requireAdministrator(p);
    const tx=await pool.connect();
    try{return {items:await listPendingDevices(tx,p.familyId)};}finally{tx.release();}
  });

  app.post<{Params:{deviceId:string}}>('/v1/devices/:deviceId/approve',async(request,reply)=>{
    const p=await requireSession(request,pool);
    requireCsrf(request,p);
    if(p.deviceStatus!=='active') return reply.code(403).send({error:'device_not_active'});
    requireAdministrator(p);
    const input=ApproveDeviceRequest.parse(request.body);
    const tx=await pool.connect();
    try{
      await tx.query('BEGIN');
      await approveDevice(tx,{familyId:p.familyId,deviceId:request.params.deviceId,...input});
      await appendAuditEvent(tx,{familyId:p.familyId,actorDeviceId:p.deviceId,eventType:'device.approved',details:{deviceId:request.params.deviceId,chatId:input.chatId,keyVersion:input.keyVersion}});
      await tx.query('COMMIT');
      return reply.code(204).send();
    }catch(error){await tx.query('ROLLBACK');throw error;}finally{tx.release();}
  });

  app.get<{Params:{chatId:string}}>('/v1/keys/chat/:chatId/current',async(request,reply)=>{
    const p=await requireSession(request,pool);
    const tx=await pool.connect();
    try{
      const envelope=await getCurrentKeyEnvelope(tx,{chatId:request.params.chatId,deviceId:p.deviceId,familyId:p.familyId});
      if(!envelope) return reply.code(404).send({error:'key_envelope_not_ready'});
      return envelope;
    }finally{tx.release();}
  });

  app.get('/v1/key-rotations',async(request,reply)=>{
    const p=await requireSession(request,pool);
    if(p.deviceStatus!=='active') return reply.code(403).send({error:'device_not_active'});
    const tx=await pool.connect();
    try{return {items:await listPendingRotations(tx,{familyId:p.familyId,memberId:p.memberId})};}finally{tx.release();}
  });

  app.post<{Params:{chatId:string}}>('/v1/chats/:chatId/key-rotation',async(request,reply)=>{
    const p=await requireSession(request,pool);
    requireCsrf(request,p);
    if(p.deviceStatus!=='active') return reply.code(403).send({error:'device_not_active'});
    const input=CompleteKeyRotationRequest.parse(request.body);
    const tx=await pool.connect();
    try{
      await tx.query('BEGIN');
      const result=await completeKeyRotation(tx,{familyId:p.familyId,actorMemberId:p.memberId,chatId:request.params.chatId,toKeyVersion:input.toKeyVersion,envelopes:input.envelopes});
      await appendAuditEvent(tx,{familyId:p.familyId,actorDeviceId:p.deviceId,eventType:'keys.rotated',details:{chatId:request.params.chatId,keyVersion:input.toKeyVersion}});
      await tx.query('COMMIT');
      return reply.code(201).send(result);
    }catch(error){await tx.query('ROLLBACK');throw error;}finally{tx.release();}
  });
}
