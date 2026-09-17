import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { hashOpaqueToken } from '../src/auth/session.js';

const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl) throw new Error('DATABASE_URL_required_for_direct_chat_tests');
const pool=new Pool({connectionString:databaseUrl});
let app:FastifyInstance;

beforeAll(async()=>{app=await buildApp({pool});});
afterAll(async()=>{await app.close();await pool.end();});
beforeEach(async()=>{await pool.query(`TRUNCATE audit_events,auth_challenges,sessions,message_envelopes,device_key_envelopes,conversation_key_versions,chat_members,chats,invitations,devices,family_memberships,members,families RESTART IDENTITY CASCADE`);});

async function seedFamily(){
  const family=(await pool.query<{id:string}>(`INSERT INTO families(display_name) VALUES('Family') RETURNING id`)).rows[0]!;
  const alex=(await pool.query<{id:string}>(`INSERT INTO members(display_name) VALUES('Alex') RETURNING id`)).rows[0]!;
  const mama=(await pool.query<{id:string}>(`INSERT INTO members(display_name) VALUES('Мама') RETURNING id`)).rows[0]!;
  await pool.query(`INSERT INTO family_memberships(family_id,member_id,role,status) VALUES($1,$2,'admin','active'),($1,$3,'member','active')`,[family.id,alex.id,mama.id]);
  const alexDevice=(await pool.query<{id:string}>(`INSERT INTO devices(family_id,member_id,device_name,encryption_public_key,signing_public_key,status) VALUES($1,$2,'iPhone Alex','enc-alex','sig-alex','active') RETURNING id`,[family.id,alex.id])).rows[0]!;
  const mamaDevice=(await pool.query<{id:string}>(`INSERT INTO devices(family_id,member_id,device_name,encryption_public_key,signing_public_key,status) VALUES($1,$2,'Android Mama','enc-mama','sig-mama','active') RETURNING id`,[family.id,mama.id])).rows[0]!;
  const token='test-session-token';const csrf='test-csrf';
  await pool.query(`INSERT INTO sessions(token_hash,device_id,member_id,family_id,csrf_token,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 day')`,[hashOpaqueToken(token),alexDevice.id,alex.id,family.id,csrf]);
  return {familyId:family.id,alexId:alex.id,mamaId:mama.id,alexDevice,mamaDevice,token,csrf};
}

async function createDirectChat(seeded:Awaited<ReturnType<typeof seedFamily>>){
  return app.inject({
    method:'POST',
    url:`/v1/members/${seeded.mamaId}/direct-chat`,
    headers:{cookie:`fm_session=${seeded.token}`,'x-csrf-token':seeded.csrf},
    payload:{envelopes:[
      {deviceId:seeded.alexDevice.id,sealedKeyEnvelope:'sealed-for-alex'},
      {deviceId:seeded.mamaDevice.id,sealedKeyEnvelope:'sealed-for-mama'}
    ]}
  });
}

describe('direct chat preparation',()=>{
  it('returns active devices for both members when a direct chat does not exist',async()=>{
    const seeded=await seedFamily();
    const response=await app.inject({method:'GET',url:`/v1/members/${seeded.mamaId}/direct-chat`,headers:{cookie:`fm_session=${seeded.token}`}});
    expect(response.statusCode).toBe(200);
    const body=response.json() as {status:string;devices:Array<{deviceId:string;memberId:string;encryptionPublicKey:string}>};
    expect(body.status).toBe('needs_key');
    expect(body.devices).toHaveLength(2);
    expect(body.devices).toEqual(expect.arrayContaining([
      {deviceId:seeded.alexDevice.id,memberId:seeded.alexId,encryptionPublicKey:'enc-alex'},
      {deviceId:seeded.mamaDevice.id,memberId:seeded.mamaId,encryptionPublicKey:'enc-mama'}
    ]));
  });

  it('creates one encrypted direct chat with key envelopes for every active device',async()=>{
    const seeded=await seedFamily();
    const response=await createDirectChat(seeded);
    expect(response.statusCode).toBe(201);
    const body=response.json() as {status:string;chatId:string;keyVersion:number};
    expect(body.status).toBe('ready');
    expect(body.keyVersion).toBe(1);

    const chat=await pool.query<{kind:string}>(`SELECT kind FROM chats WHERE id=$1`,[body.chatId]);
    expect(chat.rows[0]?.kind).toBe('direct');
    const members=await pool.query(`SELECT member_id FROM chat_members WHERE chat_id=$1`,[body.chatId]);
    expect(members.rowCount).toBe(2);
    const envelopes=await pool.query<{device_id:string;sealed_key_envelope:string}>(`SELECT device_id,sealed_key_envelope FROM device_key_envelopes WHERE chat_id=$1 AND key_version=1 ORDER BY device_id`,[body.chatId]);
    expect(envelopes.rows).toEqual(expect.arrayContaining([
      {device_id:seeded.alexDevice.id,sealed_key_envelope:'sealed-for-alex'},
      {device_id:seeded.mamaDevice.id,sealed_key_envelope:'sealed-for-mama'}
    ]));
  });

  it('reopens the existing direct chat without creating a duplicate',async()=>{
    const seeded=await seedFamily();
    const created=await createDirectChat(seeded);
    expect(created.statusCode).toBe(201);
    const createdBody=created.json() as {chatId:string;keyVersion:number};

    const prepared=await app.inject({method:'GET',url:`/v1/members/${seeded.mamaId}/direct-chat`,headers:{cookie:`fm_session=${seeded.token}`}});
    expect(prepared.statusCode).toBe(200);
    expect(prepared.json()).toMatchObject({status:'ready',chatId:createdBody.chatId,keyVersion:1});

    const reopened=await createDirectChat(seeded);
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json()).toMatchObject({status:'ready',chatId:createdBody.chatId,keyVersion:1});
    const count=await pool.query<{count:string}>(`SELECT count(*)::text count FROM chats WHERE family_id=$1 AND kind='direct'`,[seeded.familyId]);
    expect(count.rows[0]?.count).toBe('1');
  });
});
