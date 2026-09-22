import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {Pool} from 'pg';
import type {FastifyInstance} from 'fastify';
import {buildApp} from '../src/app.js';
import {seed} from './helpers/family.js';
const pool=new Pool({connectionString:process.env.DATABASE_URL});let app:FastifyInstance;
beforeAll(async()=>{app=await buildApp({pool});});afterAll(async()=>{await app.close();await pool.end();});
beforeEach(async()=>{await pool.query('TRUNCATE families,members CASCADE');});
function remove(id:string,actor:{token:string;csrf:string}){return app.inject({method:'POST',url:`/v1/family/members/${id}/remove`,headers:{cookie:`fm_session=${actor.token}`,'x-csrf-token':actor.csrf}});}
describe('soft member removal',()=>{
 it.each([['primary','member'],['primary','secondary'],['secondary','member']] as const)('%s removes %s without deleting history',async(actor,target)=>{
  const f=await seed(pool);const r=await remove(f[target].id,f[actor]);expect(r.statusCode).toBe(204);
  expect((await pool.query('SELECT status FROM family_memberships WHERE member_id=$1',[f[target].id])).rows[0]?.status).toBe('removed');
  expect((await pool.query('SELECT * FROM members WHERE id=$1',[f[target].id])).rowCount).toBe(1);
  expect((await pool.query('SELECT status FROM devices WHERE id=$1',[f[target].device])).rows[0]?.status).toBe('revoked');
  expect((await pool.query('SELECT * FROM sessions WHERE member_id=$1',[f[target].id])).rowCount).toBe(0);
  expect((await remove(f[target].id,f[actor])).statusCode).toBe(204);
  expect((await pool.query(`SELECT * FROM audit_events WHERE event_type='family.member.removed'`)).rowCount).toBe(1);
 });
 it.each([['primary','primary',409,'primary_administrator_protected'],['secondary','primary',409,'primary_administrator_protected'],['secondary','secondary',403,'member_protected'],['member','other',403,'administrator_required']] as const)('protects %s → %s',async(actor,target,status,error)=>{const f=await seed(pool),r=await remove(f[target].id,f[actor]);expect(r.statusCode).toBe(status);expect(r.json()).toEqual({error});});
 it('returns member_not_found for another family',async()=>{const f=await seed(pool),g=await seed(pool);expect((await remove(g.member.id,f.primary)).json()).toEqual({error:'member_not_found'});});
 it('preserves readable direct history and prevents writes or removed-member access',async()=>{
  const f=await seed(pool);const headers={cookie:`fm_session=${f.primary.token}`,'x-csrf-token':f.primary.csrf};
  const created=await app.inject({method:'POST',url:`/v1/members/${f.member.id}/direct-chat`,headers,payload:{envelopes:[{deviceId:f.primary.device,sealedKeyEnvelope:'p'},{deviceId:f.member.device,sealedKeyEnvelope:'m'}]}});
  expect(created.statusCode).toBe(201);const {chatId}=created.json();
  const body={messageId:randomUUID(),chatId,senderDeviceId:f.primary.device,keyVersion:1,nonce:'nonce',ciphertext:'ciphertext'};
  expect((await app.inject({method:'POST',url:`/v1/chats/${chatId}/messages`,headers,payload:body})).statusCode).toBe(201);
  expect((await remove(f.member.id,f.primary)).statusCode).toBe(204);
  const history=await app.inject({method:'GET',url:`/v1/chats/${chatId}/messages`,headers});expect(history.statusCode).toBe(200);expect(history.json().items).toHaveLength(1);
  expect((await app.inject({method:'POST',url:`/v1/chats/${chatId}/messages`,headers,payload:{...body,messageId:randomUUID()}})).json()).toEqual({error:'chat_read_only'});
  expect((await app.inject({method:'GET',url:`/v1/chats/${chatId}/messages`,headers:{cookie:`fm_session=${f.member.token}`}})).statusCode).toBe(401);
  expect((await app.inject({method:'GET',url:`/v1/members/${f.member.id}/direct-chat`,headers})).json()).toMatchObject({status:'ready',chatId,readOnly:true});
 });
});
