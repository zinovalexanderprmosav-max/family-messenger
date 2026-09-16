import type { FastifyInstance } from 'fastify';
import { RenameDeviceRequest } from '@family-messenger/protocol';
import type { DatabasePool } from '../db/pool.js';
import { requireSession } from '../auth/session.js';
import { requireCsrf } from '../auth/csrf.js';
import { canManageDevice } from '../auth/permissions.js';
import { appendAuditEvent } from '../audit/repository.js';
import { findDeviceForUpdate,listVisibleDevices,renameDevice,revokeDevice } from './repository.js';

export async function registerDeviceRoutes(app:FastifyInstance,pool:DatabasePool){
  app.get('/v1/devices',async(request)=>{
    const p=await requireSession(request,pool);
    const tx=await pool.connect();
    try{return {items:await listVisibleDevices(tx,{familyId:p.familyId,actorMemberId:p.memberId,actorRole:p.role})};}finally{tx.release();}
  });

  app.patch<{Params:{deviceId:string}}>('/v1/devices/:deviceId',async(request,reply)=>{
    const p=await requireSession(request,pool);
    requireCsrf(request,p);
    const input=RenameDeviceRequest.parse(request.body);
    const tx=await pool.connect();
    try{
      await tx.query('BEGIN');
      const target=await findDeviceForUpdate(tx,p.familyId,request.params.deviceId);
      if(!target){await tx.query('ROLLBACK');return reply.code(404).send({error:'device_not_found'});}
      if(!canManageDevice({actorRole:p.role,actorMemberId:p.memberId,targetRole:target.memberRole,targetMemberId:target.memberId})){
        await tx.query('ROLLBACK');return reply.code(403).send({error:'device_management_forbidden'});
      }
      const deviceName=await renameDevice(tx,target.deviceId,input.deviceName);
      await appendAuditEvent(tx,{familyId:p.familyId,actorDeviceId:p.deviceId,eventType:'device.renamed',details:{deviceId:target.deviceId}});
      await tx.query('COMMIT');
      return {deviceId:target.deviceId,deviceName};
    }catch(error){await tx.query('ROLLBACK');throw error;}finally{tx.release();}
  });

  app.delete<{Params:{deviceId:string}}>('/v1/devices/:deviceId',async(request,reply)=>{
    const p=await requireSession(request,pool);
    requireCsrf(request,p);
    const tx=await pool.connect();
    try{
      await tx.query('BEGIN');
      const target=await findDeviceForUpdate(tx,p.familyId,request.params.deviceId);
      if(!target){await tx.query('ROLLBACK');return reply.code(404).send({error:'device_not_found'});}
      if(!canManageDevice({actorRole:p.role,actorMemberId:p.memberId,targetRole:target.memberRole,targetMemberId:target.memberId})){
        await tx.query('ROLLBACK');return reply.code(403).send({error:'device_management_forbidden'});
      }
      await revokeDevice(tx,target);
      await appendAuditEvent(tx,{familyId:p.familyId,actorDeviceId:p.deviceId,eventType:'device.revoked',details:{deviceId:target.deviceId,memberId:target.memberId}});
      await tx.query('COMMIT');
      return reply.code(204).send();
    }catch(error){await tx.query('ROLLBACK');throw error;}finally{tx.release();}
  });
}
