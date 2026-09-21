import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {Pool} from 'pg';
import type {FastifyInstance} from 'fastify';
import {buildApp} from '../src/app.js';
import {seed} from './helpers/family.js';

const pool=new Pool({connectionString:process.env.DATABASE_URL});
let app:FastifyInstance;
beforeAll(async()=>{app=await buildApp({pool});});
afterAll(async()=>{await app.close();await pool.end();});
beforeEach(async()=>{await pool.query('TRUNCATE families,members CASCADE');});

async function setup(){
  const f=await seed(pool),chatId=randomUUID();
  await pool.query(`INSERT INTO chats(id,family_id,kind) VALUES($1,$2,'family')`,[chatId,f.family]);
  await pool.query(`INSERT INTO chat_members(chat_id,member_id) SELECT $1,member_id FROM family_memberships WHERE family_id=$2`,[chatId,f.family]);
  await pool.query(`INSERT INTO conversation_key_versions(chat_id,key_version) VALUES($1,1)`,[chatId]);
  await pool.query(`INSERT INTO device_key_envelopes(chat_id,key_version,device_id,sealed_key_envelope) SELECT $1,1,id,'existing' FROM devices WHERE family_id=$2`,[chatId,f.family]);
  return {...f,chatId};
}
const headers=(a:{token:string;csrf:string})=>({cookie:`fm_session=${a.token}`,'x-csrf-token':a.csrf});
async function create(actor:{token:string;csrf:string}){
  return app.inject({method:'POST',url:'/v1/device-enrollments',headers:headers(actor),payload:{}});
}
async function accept(token:string,name='Second phone'){
  return app.inject({method:'POST',url:'/v1/device-enrollments/accept',payload:{
    enrollmentToken:token,deviceName:name,encryptionPublicKey:randomUUID(),signingPublicKey:randomUUID()
  }});
}

describe('own-device enrollment',()=>{
  it('adds a pending device to the same member and lets that member approve it',async()=>{
    const f=await setup();
    const made=await create(f.member);expect(made.statusCode).toBe(201);
    const token=made.json().enrollmentToken as string;
    const inspected=await app.inject({method:'POST',url:'/v1/device-enrollments/inspect',payload:{enrollmentToken:token}});
    expect(inspected.statusCode).toBe(200);
    expect(inspected.json()).toMatchObject({familyId:f.family,memberId:f.member.id,memberDisplayName:'member'});

    const joined=await accept(token);expect(joined.statusCode).toBe(201);
    expect(joined.json()).toMatchObject({familyId:f.family,memberId:f.member.id,familyChatId:f.chatId,status:'pending_key'});
    const newDeviceId=joined.json().deviceId as string;
    expect((await pool.query('SELECT count(*)::int count FROM family_memberships WHERE family_id=$1 AND member_id=$2',[f.family,f.member.id])).rows[0]?.count).toBe(1);
    expect((await pool.query('SELECT member_id,status FROM devices WHERE id=$1',[newDeviceId])).rows[0]).toEqual({member_id:f.member.id,status:'pending_key'});

    const pending=await app.inject({method:'GET',url:'/v1/devices/pending',headers:{cookie:`fm_session=${f.member.token}`}});
    expect(pending.statusCode).toBe(200);
    expect(pending.json().items.map((d:{deviceId:string})=>d.deviceId)).toContain(newDeviceId);

    const approved=await app.inject({method:'POST',url:`/v1/devices/${newDeviceId}/approve`,headers:headers(f.member),payload:{
      chatId:f.chatId,keyVersion:1,sealedKeyEnvelope:'new-device-envelope'
    }});
    expect(approved.statusCode).toBe(204);
    expect((await pool.query('SELECT status FROM devices WHERE id=$1',[newDeviceId])).rows[0]?.status).toBe('active');
  });

  it('keeps another members pending device hidden and protected from an ordinary member',async()=>{
    const f=await setup();
    const own=await create(f.other);const joined=await accept(own.json().enrollmentToken,'Other phone');
    const deviceId=joined.json().deviceId as string;
    const listed=await app.inject({method:'GET',url:'/v1/devices/pending',headers:{cookie:`fm_session=${f.member.token}`}});
    expect(listed.json().items).toEqual([]);
    const forbidden=await app.inject({method:'POST',url:`/v1/devices/${deviceId}/approve`,headers:headers(f.member),payload:{chatId:f.chatId,keyVersion:1,sealedKeyEnvelope:'x'}});
    expect(forbidden.statusCode).toBe(403);expect(forbidden.json()).toEqual({error:'administrator_required'});
    const admin=await app.inject({method:'POST',url:`/v1/devices/${deviceId}/approve`,headers:headers(f.primary),payload:{chatId:f.chatId,keyVersion:1,sealedKeyEnvelope:'admin-envelope'}});
    expect(admin.statusCode).toBe(204);
  });

  it('makes enrollment tokens one-time and invalidates the previous QR',async()=>{
    const f=await setup();
    const first=await create(f.member),second=await create(f.member);
    const firstInspect=await app.inject({method:'POST',url:'/v1/device-enrollments/inspect',payload:{enrollmentToken:first.json().enrollmentToken}});
    expect(firstInspect.statusCode).toBe(410);expect(firstInspect.json()).toEqual({error:'device_enrollment_revoked'});
    expect((await accept(second.json().enrollmentToken)).statusCode).toBe(201);
    const repeat=await accept(second.json().enrollmentToken);
    expect(repeat.statusCode).toBe(410);expect(repeat.json()).toEqual({error:'device_enrollment_consumed'});
  });

  it('revokes outstanding QR when its trusted creator device is revoked',async()=>{
    const f=await setup(),made=await create(f.member),token=made.json().enrollmentToken as string;
    const revoke=await app.inject({method:'POST',url:`/v1/family/devices/${f.member.device}/revoke`,headers:headers(f.primary)});
    expect(revoke.statusCode).toBe(204);
    const inspect=await app.inject({method:'POST',url:'/v1/device-enrollments/inspect',payload:{enrollmentToken:token}});
    expect(inspect.statusCode).toBe(410);expect(inspect.json()).toEqual({error:'device_enrollment_revoked'});
  });

  it('enforces the three-device limit for one member',async()=>{
    const f=await setup();
    for(const name of ['Phone 2','Phone 3']){
      const made=await create(f.member);expect(made.statusCode).toBe(201);expect((await accept(made.json().enrollmentToken,name)).statusCode).toBe(201);
    }
    const over=await create(f.member);
    expect(over.statusCode).toBe(409);expect(over.json()).toEqual({error:'device_limit_reached'});
  });
});
