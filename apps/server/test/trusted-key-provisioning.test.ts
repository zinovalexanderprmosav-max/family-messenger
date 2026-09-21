import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {Pool} from 'pg';
import type {FastifyInstance} from 'fastify';
import {buildApp} from '../src/app.js';
import {createSession} from '../src/auth/session.js';
import {seed} from './helpers/family.js';

const pool=new Pool({connectionString:process.env.DATABASE_URL});
let app:FastifyInstance;
beforeAll(async()=>{app=await buildApp({pool});});
afterAll(async()=>{await app.close();await pool.end();});
beforeEach(async()=>{await pool.query('TRUNCATE families,members CASCADE');});

const headers=(a:{token:string;csrf:string})=>({cookie:`fm_session=${a.token}`,'x-csrf-token':a.csrf});

async function setup(){
  const f=await seed(pool);
  const familyChat=randomUUID(),directChat=randomUUID(),foreignChat=randomUUID();
  await pool.query(`INSERT INTO chats(id,family_id,kind) VALUES($1,$4,'family'),($2,$4,'direct'),($3,$4,'direct')`,[familyChat,directChat,foreignChat,f.family]);
  await pool.query(`INSERT INTO chat_members(chat_id,member_id) SELECT $1,member_id FROM family_memberships WHERE family_id=$2`,[familyChat,f.family]);
  await pool.query(`INSERT INTO chat_members(chat_id,member_id) VALUES($1,$2),($1,$3)`,[directChat,f.member.id,f.primary.id]);
  await pool.query(`INSERT INTO chat_members(chat_id,member_id) VALUES($1,$2),($1,$3)`,[foreignChat,f.other.id,f.primary.id]);
  await pool.query(`INSERT INTO conversation_key_versions(chat_id,key_version) VALUES($1,1),($1,2),($2,1),($3,1)`,[familyChat,directChat,foreignChat]);
  for(const device of [f.primary.device,f.secondary.device,f.member.device,f.other.device]){
    await pool.query(`INSERT INTO device_key_envelopes(chat_id,key_version,device_id,sealed_key_envelope) VALUES($1,1,$2,$3),($1,2,$2,$4)`,[familyChat,device,`f1-${device}`,`f2-${device}`]);
  }
  await pool.query(`INSERT INTO device_key_envelopes(chat_id,key_version,device_id,sealed_key_envelope) VALUES($1,1,$2,'direct-member'),($1,1,$3,'direct-primary')`,[directChat,f.member.device,f.primary.device]);
  await pool.query(`INSERT INTO device_key_envelopes(chat_id,key_version,device_id,sealed_key_envelope) VALUES($1,1,$2,'foreign-primary')`,[foreignChat,f.primary.device]);

  async function pending(memberId:string){
    const r=await pool.query<{id:string}>(`INSERT INTO devices(family_id,member_id,device_name,encryption_public_key,signing_public_key,status) VALUES($1,$2,'New phone',$3,$4,'pending_key') RETURNING id`,[f.family,memberId,randomUUID(),randomUUID()]);
    return r.rows[0]!.id;
  }
  return {...f,familyChat,directChat,foreignChat,pending};
}

async function sessionFor(deviceId:string,memberId:string,familyId:string){
  const tx=await pool.connect();
  try{return await createSession(tx,{deviceId,memberId,familyId});}
  finally{tx.release();}
}

describe('trusted key provisioning',()=>{
  it('provisions available family history and direct-chat keys to an own pending device',async()=>{
    const f=await setup(),target=await f.pending(f.member.id),session=await sessionFor(target,f.member.id,f.family);
    const before=await app.inject({method:'GET',url:'/v1/keys/device/envelopes',headers:{cookie:`fm_session=${session.token}`}});
    expect(before.statusCode).toBe(404);expect(before.json()).toEqual({error:'key_envelope_not_ready'});

    const approved=await app.inject({method:'POST',url:`/v1/devices/${target}/approve`,headers:headers(f.member),payload:{
      chatId:f.familyChat,keyVersion:2,sealedKeyEnvelope:'target-family-v2',
      provisionedKeys:[
        {chatId:f.familyChat,keyVersion:1,sealedKeyEnvelope:'target-family-v1'},
        {chatId:f.directChat,keyVersion:1,sealedKeyEnvelope:'target-direct-v1'}
      ]
    }});
    expect(approved.statusCode).toBe(204);
    const rows=await pool.query('SELECT chat_id,key_version,sealed_key_envelope FROM device_key_envelopes WHERE device_id=$1 ORDER BY chat_id,key_version',[target]);
    expect(rows.rows).toHaveLength(3);
    expect(rows.rows).toEqual(expect.arrayContaining([
      {chat_id:f.familyChat,key_version:1,sealed_key_envelope:'target-family-v1'},
      {chat_id:f.familyChat,key_version:2,sealed_key_envelope:'target-family-v2'},
      {chat_id:f.directChat,key_version:1,sealed_key_envelope:'target-direct-v1'}
    ]));

    const restored=await app.inject({method:'GET',url:'/v1/keys/device/envelopes',headers:{cookie:`fm_session=${session.token}`}});
    expect(restored.statusCode).toBe(200);
    expect(restored.json().items).toHaveLength(3);
    const audit=await pool.query(`SELECT details FROM audit_events WHERE event_type='device.approved' ORDER BY id DESC LIMIT 1`);
    expect(audit.rows[0]?.details).toMatchObject({deviceId:target,provisionedKeyCount:2});
  });

  it('forbids historical provisioning to a different member even for an administrator',async()=>{
    const f=await setup(),target=await f.pending(f.other.id);
    const r=await app.inject({method:'POST',url:`/v1/devices/${target}/approve`,headers:headers(f.primary),payload:{
      chatId:f.familyChat,keyVersion:2,sealedKeyEnvelope:'current-only',
      provisionedKeys:[{chatId:f.familyChat,keyVersion:1,sealedKeyEnvelope:'old-history'}]
    }});
    expect(r.statusCode).toBe(403);expect(r.json()).toEqual({error:'history_provisioning_forbidden'});
    expect((await pool.query('SELECT status FROM devices WHERE id=$1',[target])).rows[0]?.status).toBe('pending_key');
    expect((await pool.query('SELECT * FROM device_key_envelopes WHERE device_id=$1',[target])).rowCount).toBe(0);
  });

  it('rejects a chat version that the trusted actor was never provisioned',async()=>{
    const f=await setup(),target=await f.pending(f.member.id);
    const r=await app.inject({method:'POST',url:`/v1/devices/${target}/approve`,headers:headers(f.member),payload:{
      chatId:f.familyChat,keyVersion:2,sealedKeyEnvelope:'current',
      provisionedKeys:[{chatId:f.foreignChat,keyVersion:1,sealedKeyEnvelope:'forbidden'}]
    }});
    expect(r.statusCode).toBe(403);expect(r.json()).toEqual({error:'key_provisioning_not_authorized'});
    expect((await pool.query('SELECT status FROM devices WHERE id=$1',[target])).rows[0]?.status).toBe('pending_key');
    expect((await pool.query('SELECT * FROM device_key_envelopes WHERE device_id=$1',[target])).rowCount).toBe(0);
  });

  it('rejects duplicate historical chat/version entries atomically',async()=>{
    const f=await setup(),target=await f.pending(f.member.id);
    const item={chatId:f.directChat,keyVersion:1,sealedKeyEnvelope:'same'};
    const r=await app.inject({method:'POST',url:`/v1/devices/${target}/approve`,headers:headers(f.member),payload:{
      chatId:f.familyChat,keyVersion:2,sealedKeyEnvelope:'current',provisionedKeys:[item,item]
    }});
    expect(r.statusCode).toBe(409);expect(r.json()).toEqual({error:'key_provisioning_duplicate'});
    expect((await pool.query('SELECT * FROM device_key_envelopes WHERE device_id=$1',[target])).rowCount).toBe(0);
  });
});
