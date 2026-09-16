import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { AcceptInvitationRequest, InvitationTokenRequest } from '@family-messenger/protocol';
import type { DatabasePool } from '../db/pool.js';
import { createInvitation, consumeInvitation, inspectInvitation } from './repository.js';
import { createSession, requireSession, setSessionCookie } from '../auth/session.js';
import { requireCsrf } from '../auth/csrf.js';
import { appendAuditEvent } from '../audit/repository.js';

const tokenHash=(token:string)=>createHash('sha256').update(token,'utf8').digest('hex');
function inviteError(reply: import('fastify').FastifyReply,error:unknown){
  if(!(error instanceof Error)) return false;
  if(error.message==='invitation_expired'||error.message==='invitation_revoked'||error.message==='invitation_consumed'){reply.code(410).send({error:error.message});return true;}
  if(error.message==='invitation_invalid'){reply.code(404).send({error:error.message});return true;}
  return false;
}

export async function registerInvitationRoutes(app:FastifyInstance,pool:DatabasePool,production:boolean){
  app.post('/v1/invitations',async(request,reply)=>{
    const principal=await requireSession(request,pool); requireCsrf(request,principal);
    if(principal.deviceStatus!=='active') return reply.code(403).send({error:'device_not_active'});
    const tx=await pool.connect();
    try{
      await tx.query('BEGIN');
      const admin=await tx.query(`SELECT 1 FROM family_memberships WHERE family_id=$1 AND member_id=$2 AND role='admin' AND status='active'`,[principal.familyId,principal.memberId]);
      if(!admin.rowCount){await tx.query('ROLLBACK');return reply.code(403).send({error:'administrator_required'});}
      const joinToken=randomBytes(32).toString('base64url'); const expiresAt=new Date(Date.now()+15*60*1000);
      const invitation=await createInvitation(tx,{familyId:principal.familyId,createdByDeviceId:principal.deviceId,tokenHash:tokenHash(joinToken),expiresAt});
      await appendAuditEvent(tx,{familyId:principal.familyId,actorDeviceId:principal.deviceId,eventType:'invitation.created',details:{invitationId:invitation.id,expiresAt:invitation.expiresAt}});
      await tx.query('COMMIT'); return reply.code(201).send({invitationId:invitation.id,joinToken,expiresAt:invitation.expiresAt});
    }catch(error){await tx.query('ROLLBACK');throw error;}finally{tx.release();}
  });

  app.post('/v1/invitations/inspect',async(request,reply)=>{
    const input=InvitationTokenRequest.parse(request.body); const tx=await pool.connect();
    try{return await inspectInvitation(tx,tokenHash(input.joinToken));}catch(error){if(inviteError(reply,error)) return;throw error;}finally{tx.release();}
  });

  app.post('/v1/invitations/accept',async(request,reply)=>{
    const input=AcceptInvitationRequest.parse(request.body); const tx=await pool.connect();
    try{
      await tx.query('BEGIN');
      const enrollment=await consumeInvitation(tx,tokenHash(input.joinToken),input);
      const session=await createSession(tx,{deviceId:enrollment.deviceId,memberId:enrollment.memberId,familyId:enrollment.familyId});
      await appendAuditEvent(tx,{familyId:enrollment.familyId,actorDeviceId:enrollment.deviceId,eventType:'invitation.accepted'});
      await tx.query('COMMIT'); setSessionCookie(reply,session.token,production);
      return reply.code(201).send({...enrollment,csrfToken:session.csrfToken});
    }catch(error){await tx.query('ROLLBACK');if(inviteError(reply,error)) return;throw error;}finally{tx.release();}
  });
}
