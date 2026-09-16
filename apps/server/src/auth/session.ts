import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import type { DatabasePool } from '../db/pool.js';

export type SessionPrincipal = {
  deviceId:string; memberId:string; familyId:string; deviceStatus:'pending_key'|'active'|'revoked'; csrfToken:string;
};

export function hashOpaqueToken(token:string){ return createHash('sha256').update(token,'utf8').digest('hex'); }
export function randomOpaqueToken(){ return randomBytes(32).toString('base64url'); }

export async function createSession(tx:PoolClient,input:{deviceId:string;memberId:string;familyId:string}){
  const token=randomOpaqueToken();
  const csrfToken=randomOpaqueToken();
  const expiresAt=new Date(Date.now()+30*24*60*60*1000);
  await tx.query(`INSERT INTO sessions(token_hash,device_id,member_id,family_id,csrf_token,expires_at) VALUES($1,$2,$3,$4,$5,$6)`,[hashOpaqueToken(token),input.deviceId,input.memberId,input.familyId,csrfToken,expiresAt]);
  return {token,csrfToken,expiresAt};
}

export function setSessionCookie(reply:FastifyReply,token:string,production:boolean){
  reply.setCookie('fm_session',token,{path:'/',httpOnly:true,sameSite:'strict',secure:production,maxAge:60*60*24*30});
}

export async function findSession(pool:DatabasePool,token:string):Promise<SessionPrincipal|null>{
  const r=await pool.query<{device_id:string;member_id:string;family_id:string;csrf_token:string;status:'pending_key'|'active'|'revoked'}>(`
    SELECT s.device_id,s.member_id,s.family_id,s.csrf_token,d.status
    FROM sessions s JOIN devices d ON d.id=s.device_id
    WHERE s.token_hash=$1 AND s.expires_at>now()`,[hashOpaqueToken(token)]);
  const row=r.rows[0];
  return row?{deviceId:row.device_id,memberId:row.member_id,familyId:row.family_id,csrfToken:row.csrf_token,deviceStatus:row.status}:null;
}

export async function requireSession(request:FastifyRequest,pool:DatabasePool):Promise<SessionPrincipal>{
  const token=request.cookies.fm_session;
  if(!token) throw Object.assign(new Error('authentication_required'),{statusCode:401});
  const principal=await findSession(pool,token);
  if(!principal) throw Object.assign(new Error('authentication_required'),{statusCode:401});
  return principal;
}

export function csrfMatches(provided:string|undefined,expected:string){
  if(!provided) return false;
  const a=Buffer.from(provided); const b=Buffer.from(expected);
  return a.length===b.length && timingSafeEqual(a,b);
}
