import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { AcceptDeviceLinkRequest, DeviceLinkTokenRequest } from '@family-messenger/protocol';
import type { DatabasePool } from '../db/pool.js';
import { appendAuditEvent } from '../audit/repository.js';
import { requireCsrf } from '../auth/csrf.js';
import { createSession, hashOpaqueToken, requireSession, setSessionCookie } from '../auth/session.js';
import { createDeviceLink, consumeDeviceLink, inspectDeviceLink } from './repository.js';

function deviceLinkError(reply:FastifyReply,error:unknown){
  if(!(error instanceof Error)) return false;
  if(error.message==='device_link_expired'||error.message==='device_link_revoked'||error.message==='device_link_consumed'){
    reply.code(410).send({error:error.message});return true;
  }
  if(error.message==='device_link_invalid'){
    reply.code(404).send({error:error.message});return true;
  }
  if(error.message==='device_limit_reached'){
    reply.code(409).send({error:error.message});return true;
  }
  return false;
}

export async function registerDeviceLinkRoutes(app:FastifyInstance,pool:DatabasePool,production:boolean){
  app.post('/v1/device-links',async(request,reply)=>{
    const principal=await requireSession(request,pool);requireCsrf(request,principal);
    if(principal.deviceStatus!=='active') return reply.code(403).send({error:'device_not_active'});
    const linkToken=randomBytes(32).toString('base64url');
    const expiresAt=new Date(Date.now()+15*60*1000);
    const tx=await pool.connect();
    try{
      await tx.query('BEGIN');
      const created=await createDeviceLink(tx,{familyId:principal.familyId,memberId:principal.memberId,createdByDeviceId:principal.deviceId,tokenHash:hashOpaqueToken(linkToken),expiresAt});
      await appendAuditEvent(tx,{familyId:principal.familyId,actorDeviceId:principal.deviceId,eventType:'device_link.created',details:{deviceLinkId:created.id,expiresAt:created.expiresAt}});
      await tx.query('COMMIT');
      return reply.code(201).send({deviceLinkId:created.id,linkToken,expiresAt:created.expiresAt});
    }catch(error){await tx.query('ROLLBACK');throw error;}finally{tx.release();}
  });

  app.post('/v1/device-links/inspect',async(request,reply)=>{
    const input=DeviceLinkTokenRequest.parse(request.body);
    const tx=await pool.connect();
    try{return await inspectDeviceLink(tx,hashOpaqueToken(input.linkToken));}
    catch(error){if(deviceLinkError(reply,error))return;throw error;}
    finally{tx.release();}
  });

  app.post('/v1/device-links/accept',async(request,reply)=>{
    const input=AcceptDeviceLinkRequest.parse(request.body);
    const tx=await pool.connect();
    try{
      await tx.query('BEGIN');
      const enrollment=await consumeDeviceLink(tx,hashOpaqueToken(input.linkToken),input);
      const session=await createSession(tx,{deviceId:enrollment.deviceId,memberId:enrollment.memberId,familyId:enrollment.familyId});
      await appendAuditEvent(tx,{familyId:enrollment.familyId,actorDeviceId:enrollment.deviceId,eventType:'device_link.accepted'});
      await tx.query('COMMIT');
      setSessionCookie(reply,session.token,production);
      return reply.code(201).send({...enrollment,csrfToken:session.csrfToken});
    }catch(error){
      await tx.query('ROLLBACK');
      if(deviceLinkError(reply,error))return;
      throw error;
    }finally{tx.release();}
  });
}
