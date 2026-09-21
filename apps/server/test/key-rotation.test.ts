import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {Pool} from 'pg';
import type {FastifyInstance} from 'fastify';
import {buildApp} from '../src/app.js';
import {seed} from './helpers/family.js';
const pool=new Pool({connectionString:process.env.DATABASE_URL});let app:FastifyInstance;
beforeAll(async()=>{app=await buildApp({pool});});afterAll(async()=>{await app.close();await pool.end();});
beforeEach(async()=>{await pool.query('TRUNCATE families,members CASCADE');});
async function setup(){
 const f=await seed(pool),chatId=randomUUID();
 await pool.query(`INSERT INTO chats(id,family_id,kind) VALUES($1,$2,'family')`,[chatId,f.family]);
 await pool.query(`INSERT INTO chat_members(chat_id,member_id) SELECT $1,member_id FROM family_memberships WHERE family_id=$2`,[chatId,f.family]);
 await pool.query(`INSERT INTO conversation_key_versions(chat_id,key_version) VALUES($1,1)`,[chatId]);
 await pool.query(`INSERT INTO device_key_envelopes(chat_id,key_version,device_id,sealed_key_envelope) SELECT $1,1,id,'old-envelope' FROM devices WHERE family_id=$2`,[chatId,f.family]);
 const headers={cookie:`fm_session=${f.primary.token}`,'x-csrf-token':f.primary.csrf};
 const revoke=()=>app.inject({method:'POST',url:`/v1/family/devices/${f.member.device}/revoke`,headers});
 const prepare=()=>app.inject({method:'GET',url:`/v1/chats/${chatId}/key-rotation`,headers});
 const complete=(envelopes:{deviceId:string;sealedKeyEnvelope:string}[],fromKeyVersion=1)=>app.inject({method:'POST',url:`/v1/chats/${chatId}/key-rotation`,headers,payload:{fromKeyVersion,nextKeyVersion:fromKeyVersion+1,envelopes}});
 const envelopes=[f.primary,f.secondary,f.other].map(a=>({deviceId:a.device,sealedKeyEnvelope:'new-sealed-'+a.device}));
 const send=(keyVersion=1)=>app.inject({method:'POST',url:`/v1/chats/${chatId}/messages`,headers,payload:{messageId:randomUUID(),chatId,senderDeviceId:f.primary.device,keyVersion,nonce:'nonce',ciphertext:'ciphertext'}});
 return {...f,chatId,headers,revoke,prepare,complete,envelopes,send};
}
describe('required rotation',()=>{
 it('blocks writes and deduplicates rotation audit when a keyed device is revoked',async()=>{
  const f=await setup();expect((await f.revoke()).statusCode).toBe(204);expect((await f.revoke()).statusCode).toBe(204);
  expect((await f.send()).json()).toEqual({error:'key_rotation_required'});
  const r=await f.prepare();expect(r.statusCode).toBe(200);expect(r.json()).toMatchObject({status:'required',chatId:f.chatId,fromKeyVersion:1,nextKeyVersion:2});
  expect(r.json().devices.map((d:{deviceId:string})=>d.deviceId).sort()).toEqual(f.envelopes.map(e=>e.deviceId).sort());
  expect((await pool.query(`SELECT * FROM audit_events WHERE event_type='chat.key.rotation.required'`)).rowCount).toBe(1);
 });
 it('does not require rotation when revoked device had no current key',async()=>{
  const f=await setup();await pool.query('DELETE FROM device_key_envelopes WHERE device_id=$1',[f.member.device]);await f.revoke();
  expect((await f.prepare()).json()).toEqual({status:'not_required'});expect((await f.send()).statusCode).toBe(201);
 });
 it('removal rotates family chat but not archived direct chat',async()=>{
  const f=await setup();const d=await app.inject({method:'POST',url:`/v1/members/${f.member.id}/direct-chat`,headers:f.headers,payload:{envelopes:[{deviceId:f.primary.device,sealedKeyEnvelope:'p'},{deviceId:f.member.device,sealedKeyEnvelope:'m'}]}});
  expect(d.statusCode).toBe(201);expect((await app.inject({method:'POST',url:`/v1/family/members/${f.member.id}/remove`,headers:f.headers})).statusCode).toBe(204);
  expect((await f.prepare()).json()).toMatchObject({status:'required'});
  expect((await app.inject({method:'GET',url:`/v1/chats/${d.json().chatId}/key-rotation`,headers:f.headers})).json()).toEqual({error:'chat_read_only'});
  expect((await pool.query('SELECT chat_id FROM chat_key_rotations')).rows).toEqual([{chat_id:f.chatId}]);
 });
});
describe('atomic rotation completion',()=>{
 it.each(['missing','extra','duplicate'] as const)('rejects %s envelopes without partial storage',async(mode)=>{
  const f=await setup();await f.revoke();let env=f.envelopes;
  if(mode==='missing')env=env.slice(1);if(mode==='extra')env=[...env,{deviceId:f.member.device,sealedKeyEnvelope:'revoked'}];if(mode==='duplicate')env=[...env,env[0]!];
  const r=await f.complete(env);expect(r.statusCode).toBe(409);expect(r.json()).toEqual({error:'device_key_set_changed'});
  expect((await pool.query('SELECT * FROM conversation_key_versions WHERE chat_id=$1',[f.chatId])).rowCount).toBe(1);
 });
 it('changes key once and never sends a new message with an old version',async()=>{
  const f=await setup();await f.revoke();expect((await f.complete(f.envelopes)).statusCode).toBe(204);
  expect((await f.prepare()).json()).toEqual({status:'not_required'});expect((await f.send(1)).statusCode).toBe(409);expect((await f.send(2)).statusCode).toBe(201);
  const rows=await pool.query('SELECT device_id,sealed_key_envelope FROM device_key_envelopes WHERE chat_id=$1 AND key_version=2 ORDER BY device_id',[f.chatId]);
  expect(rows.rows).toEqual(f.envelopes.map(e=>({device_id:e.deviceId,sealed_key_envelope:e.sealedKeyEnvelope})).sort((a,b)=>a.device_id.localeCompare(b.device_id)));
  const audit=await pool.query(`SELECT details FROM audit_events WHERE event_type='chat.key.rotated'`);expect(audit.rows).toEqual([{details:{chatId:f.chatId,keyVersion:2}}]);
 });
 it('only one concurrent rotation succeeds',async()=>{
  const f=await setup();await f.revoke();const r=await Promise.all([f.complete(f.envelopes),f.complete(f.envelopes)]);expect(r.map(x=>x.statusCode).sort()).toEqual([204,409]);
  expect((await pool.query('SELECT * FROM conversation_key_versions WHERE chat_id=$1',[f.chatId])).rowCount).toBe(2);
 });
 it('rejects recipients that changed after preparation',async()=>{
  const f=await setup();await f.revoke();await f.prepare();
  expect((await app.inject({method:'POST',url:`/v1/family/devices/${f.other.device}/revoke`,headers:f.headers})).statusCode).toBe(204);
  expect((await f.complete(f.envelopes)).json()).toEqual({error:'device_key_set_changed'});
 });
 it('requires a trusted actor with the previous envelope',async()=>{
  const f=await setup();await f.revoke();await pool.query('DELETE FROM device_key_envelopes WHERE device_id=$1',[f.primary.device]);
  expect((await f.prepare()).json()).toEqual({error:'trusted_device_required'});expect((await f.complete(f.envelopes)).statusCode).toBe(403);
 });
 it('rejects absent requirements and stale versions',async()=>{
  const f=await setup();expect((await f.complete(f.envelopes)).json()).toEqual({error:'key_rotation_not_required'});await f.revoke();expect((await f.complete(f.envelopes,7)).json()).toEqual({error:'key_rotation_stale'});
 });
});
