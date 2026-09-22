import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { DatabasePool } from '../db/pool.js';
import { AuthIdentifyRequest, AuthChallengeRequest, AuthCompleteRequest } from '@family-messenger/protocol';
import { fromBase64, utf8, verifyDetached } from '@family-messenger/crypto';
import { createSession, setSessionCookie } from './session.js';

export function authChallengeBytes(input:{challengeId:string;deviceId:string;challenge:string}){
  return utf8(`family-messenger:auth:v1|${input.challengeId}|${input.deviceId}|${input.challenge}`);
}

export async function registerDeviceAuthRoutes(app:FastifyInstance,pool:DatabasePool,production:boolean){
  app.post('/v1/auth/identify',async(request,reply)=>{
    const input=AuthIdentifyRequest.parse(request.body);
    const r=await pool.query<{id:string;status:string}>(`
      SELECT id,status
      FROM devices
      WHERE signing_public_key=$1
      LIMIT 1
    `,[input.signingPublicKey]);
    const row=r.rows[0];
    if(!row||row.status==='revoked')return reply.code(404).send({error:'device_not_found'});
    return {deviceId:row.id};
  });
  app.post('/v1/auth/challenge',async(request,reply)=>{
    const input=AuthChallengeRequest.parse(request.body);
    const device=await pool.query<{status:string}>(`SELECT status FROM devices WHERE id=$1`,[input.deviceId]);
    if(!device.rows[0]||device.rows[0].status==='revoked') return reply.code(404).send({error:'device_not_found'});
    const challenge=randomBytes(32).toString('base64');
    const r=await pool.query<{id:string}>(`INSERT INTO auth_challenges(device_id,challenge,expires_at) VALUES($1,$2,now()+interval '2 minutes') RETURNING id`,[input.deviceId,challenge]);
    return {challengeId:r.rows[0]!.id,challenge,expiresInSeconds:120};
  });

  app.post('/v1/auth/complete',async(request,reply)=>{
    const input=AuthCompleteRequest.parse(request.body);
    const tx=await pool.connect();
    try{
      await tx.query('BEGIN');
      const r=await tx.query<{challenge:string;expires_at:Date;used_at:Date|null;signing_public_key:string;member_id:string;family_id:string;status:string}>(`
        SELECT a.challenge,a.expires_at,a.used_at,d.signing_public_key,d.member_id,d.family_id,d.status
        FROM auth_challenges a JOIN devices d ON d.id=a.device_id
        WHERE a.id=$1 AND a.device_id=$2 FOR UPDATE`,[input.challengeId,input.deviceId]);
      const row=r.rows[0];
      if(!row||row.used_at||row.expires_at.getTime()<=Date.now()||row.status==='revoked'){
        await tx.query('ROLLBACK'); return reply.code(401).send({error:'challenge_invalid'});
      }
      const ok=await verifyDetached(fromBase64(input.signature),authChallengeBytes({challengeId:input.challengeId,deviceId:input.deviceId,challenge:row.challenge}),fromBase64(row.signing_public_key));
      if(!ok){ await tx.query('ROLLBACK'); return reply.code(401).send({error:'signature_invalid'}); }
      await tx.query(`UPDATE auth_challenges SET used_at=now() WHERE id=$1`,[input.challengeId]);
      const session=await createSession(tx,{deviceId:input.deviceId,memberId:row.member_id,familyId:row.family_id});
      await tx.query('COMMIT');
      setSessionCookie(reply,session.token,production);
      return {csrfToken:session.csrfToken,memberId:row.member_id,familyId:row.family_id,deviceId:input.deviceId};
    }catch(error){ await tx.query('ROLLBACK'); throw error; }finally{ tx.release(); }
  });
}
