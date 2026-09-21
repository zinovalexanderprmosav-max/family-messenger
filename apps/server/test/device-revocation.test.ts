import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {Pool} from 'pg';
import type {FastifyInstance} from 'fastify';
import {buildApp} from '../src/app.js';
import {hashOpaqueToken} from '../src/auth/session.js';

const pool=new Pool({connectionString:process.env.DATABASE_URL});
let app:FastifyInstance;
beforeAll(async()=>{app=await buildApp({pool});});
afterAll(async()=>{await app.close();await pool.end();});
beforeEach(async()=>{await pool.query('TRUNCATE families,members CASCADE');});
async function seed(){
 const family=(await pool.query(`INSERT INTO families(display_name) VALUES('Test') RETURNING id`)).rows[0].id as string;
 const actors:Record<string,{id:string;device:string;token:string;csrf:string}>={};
 for(const [name,role] of [['primary','admin'],['secondary','admin'],['member','member'],['other','member']]){
  const id=randomUUID(),device=randomUUID(),token=randomUUID(),csrf=randomUUID();
  await pool.query(`INSERT INTO members(id,display_name) VALUES($1,$2)`,[id,name]);
  await pool.query(`INSERT INTO family_memberships(family_id,member_id,role) VALUES($1,$2,$3)`,[family,id,role]);
  await pool.query(`INSERT INTO devices(id,family_id,member_id,device_name,encryption_public_key,signing_public_key,status) VALUES($1,$2,$3,'phone',$4,$5,'active')`,[device,family,id,randomUUID(),randomUUID()]);
  await pool.query(`INSERT INTO sessions(token_hash,device_id,member_id,family_id,csrf_token,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 day')`,[hashOpaqueToken(token),device,id,family,csrf]);
  actors[name!]={id,device,token,csrf};
 }
 await pool.query('UPDATE families SET primary_admin_member_id=$1 WHERE id=$2',[actors.primary!.id,family]);
 return {family,...actors} as {family:string;primary:typeof actors[string];secondary:typeof actors[string];member:typeof actors[string];other:typeof actors[string]};
}
function revoke(device:string,actor:{token:string;csrf:string}){return app.inject({method:'POST',url:`/v1/family/devices/${device}/revoke`,headers:{cookie:`fm_session=${actor.token}`,'x-csrf-token':actor.csrf}});}
describe('device revocation',()=>{
 it.each([['primary','secondary'],['primary','member'],['secondary','member']] as const)('%s revokes %s and invalidates sessions/challenges',async(actor,target)=>{
  const f=await seed(),d=f[target].device;
  await pool.query(`INSERT INTO auth_challenges(device_id,challenge,expires_at) VALUES($1,'challenge',now()+interval '1 day')`,[d]);
  expect((await revoke(d,f[actor])).statusCode).toBe(204);
  expect((await pool.query('SELECT status,revoked_at FROM devices WHERE id=$1',[d])).rows[0]).toMatchObject({status:'revoked',revoked_at:expect.any(Date)});
  expect((await pool.query('SELECT * FROM sessions WHERE device_id=$1',[d])).rowCount).toBe(0);
  expect((await pool.query('SELECT * FROM auth_challenges WHERE device_id=$1',[d])).rowCount).toBe(0);
  expect((await app.inject({method:'POST',url:'/v1/auth/challenge',payload:{deviceId:d}})).statusCode).toBe(404);
  expect((await revoke(d,f[actor])).statusCode).toBe(204);
  expect((await pool.query(`SELECT * FROM audit_events WHERE event_type='device.revoked'`)).rowCount).toBe(1);
 });
 it('allows revoking another own device',async()=>{
  const f=await seed();
  await pool.query('UPDATE devices SET member_id=$1 WHERE id=$2',[f.member.id,f.other.device]);
  expect((await revoke(f.other.device,f.member)).statusCode).toBe(204);
 });
 it.each([['primary','primary',409,'cannot_revoke_current_device'],['secondary','primary',403,'device_protected'],['member','other',403,'administrator_required']] as const)('protects target for %s → %s',async(actor,target,status,error)=>{
  const f=await seed(),r=await revoke(f[target].device,f[actor]);expect(r.statusCode).toBe(status);expect(r.json()).toEqual({error});
 });
 it('does not reveal devices in another family',async()=>{const f=await seed(),other=await seed();const r=await revoke(other.member.device,f.primary);expect(r.statusCode).toBe(404);expect(r.json()).toEqual({error:'device_not_found'});});
 it('rejects CSRF, pending devices and removed memberships',async()=>{
  const f=await seed();expect((await revoke(f.member.device,{...f.primary,csrf:'wrong'})).statusCode).toBe(403);
  await pool.query(`UPDATE devices SET status='pending_key' WHERE id=$1`,[f.primary.device]);
  expect((await revoke(f.member.device,f.primary)).json()).toEqual({error:'device_not_active'});
  await pool.query(`UPDATE devices SET status='active' WHERE id=$1`,[f.primary.device]);
  await pool.query(`UPDATE family_memberships SET status='removed' WHERE member_id=$1`,[f.primary.id]);
  expect((await revoke(f.member.device,f.primary)).statusCode).toBe(401);
 });
 it('concurrent revocations create one logical audit event',async()=>{
  const f=await seed();const rs=await Promise.all([revoke(f.member.device,f.primary),revoke(f.member.device,f.secondary)]);expect(rs.map(r=>r.statusCode)).toEqual([204,204]);
  expect((await pool.query(`SELECT * FROM audit_events WHERE event_type='device.revoked'`)).rowCount).toBe(1);
 });
 it('closes already-open target sockets while leaving other devices connected',async()=>{
  const f=await seed();const socket=await app.injectWS('/v1/ws',{headers:{cookie:`fm_session=${f.member.token}`}});
  const other=await app.injectWS('/v1/ws',{headers:{cookie:`fm_session=${f.other.token}`}});
  // A round-trip ping ensures authentication/registration has finished.
  await new Promise<void>(resolve=>{socket.once('pong',()=>resolve());socket.ping();});
  const closed=new Promise<number>(resolve=>socket.once('close',code=>resolve(code)));
  try{expect((await revoke(f.member.device,f.primary)).statusCode).toBe(204);expect(await closed).toBe(1008);expect(other.readyState).toBe(1);}finally{socket.terminate();other.terminate();}
 });
});
