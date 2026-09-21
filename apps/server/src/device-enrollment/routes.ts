import {createHash,randomBytes} from 'node:crypto';
import type {FastifyInstance,FastifyReply} from 'fastify';
import {AcceptDeviceEnrollmentRequest,DeviceEnrollmentTokenRequest} from '@family-messenger/protocol';
import type {DatabasePool} from '../db/pool.js';
import {appendAuditEvent} from '../audit/repository.js';
import {assertActiveActor,lockFamily} from '../families/access.js';
import {assertDeviceCapacity} from '../families/repository.js';
import {createSession,requireSession,setSessionCookie} from '../auth/session.js';
import {requireCsrf} from '../auth/csrf.js';
import {acceptDeviceEnrollment,createDeviceEnrollment,inspectDeviceEnrollment} from './repository.js';

const tokenHash=(token:string)=>createHash('sha256').update(token,'utf8').digest('hex');

function enrollmentError(reply:FastifyReply,error:unknown){
  if(!(error instanceof Error))return false;
  if(error.message==='device_enrollment_invalid'){reply.code(404).send({error:error.message});return true;}
  if(error.message==='device_enrollment_expired'||error.message==='device_enrollment_revoked'||error.message==='device_enrollment_consumed'){
    reply.code(410).send({error:error.message});return true;
  }
  return false;
}

export async function registerDeviceEnrollmentRoutes(app:FastifyInstance,pool:DatabasePool,production:boolean){
  app.post('/v1/device-enrollments',async(request,reply)=>{
    const principal=await requireSession(request,pool);requireCsrf(request,principal);
    if(principal.deviceStatus!=='active')return reply.code(403).send({error:'device_not_active'});
    const token=randomBytes(32).toString('base64url');
    const expiresAt=new Date(Date.now()+10*60*1000);
    const tx=await pool.connect();
    try{
      await tx.query('BEGIN');
      await lockFamily(tx,principal.familyId);
      await assertActiveActor(tx,principal);
      await assertDeviceCapacity(tx,principal.memberId);
      const enrollment=await createDeviceEnrollment(tx,{
        familyId:principal.familyId,memberId:principal.memberId,createdByDeviceId:principal.deviceId,
        tokenHash:tokenHash(token),expiresAt
      });
      await appendAuditEvent(tx,{
        familyId:principal.familyId,actorDeviceId:principal.deviceId,
        eventType:'device.enrollment.created',details:{enrollmentId:enrollment.id,memberId:principal.memberId}
      });
      await tx.query('COMMIT');
      return reply.code(201).send({enrollmentId:enrollment.id,enrollmentToken:token,expiresAt:enrollment.expiresAt});
    }catch(error){await tx.query('ROLLBACK');throw error;}finally{tx.release();}
  });

  app.post('/v1/device-enrollments/inspect',async(request,reply)=>{
    const input=DeviceEnrollmentTokenRequest.parse(request.body);
    const tx=await pool.connect();
    try{return await inspectDeviceEnrollment(tx,tokenHash(input.enrollmentToken));}
    catch(error){if(enrollmentError(reply,error))return;throw error;}
    finally{tx.release();}
  });

  app.post('/v1/device-enrollments/accept',async(request,reply)=>{
    const input=AcceptDeviceEnrollmentRequest.parse(request.body);
    const tx=await pool.connect();
    try{
      await tx.query('BEGIN');
      const enrollment=await acceptDeviceEnrollment(tx,tokenHash(input.enrollmentToken),input);
      const session=await createSession(tx,{
        deviceId:enrollment.deviceId,memberId:enrollment.memberId,familyId:enrollment.familyId
      });
      await appendAuditEvent(tx,{
        familyId:enrollment.familyId,actorDeviceId:enrollment.deviceId,
        eventType:'device.enrollment.accepted',details:{enrollmentId:enrollment.enrollmentId,memberId:enrollment.memberId}
      });
      await tx.query('COMMIT');
      setSessionCookie(reply,session.token,production);
      return reply.code(201).send({...enrollment,csrfToken:session.csrfToken});
    }catch(error){
      await tx.query('ROLLBACK');
      if(enrollmentError(reply,error))return;
      throw error;
    }finally{tx.release();}
  });
}
