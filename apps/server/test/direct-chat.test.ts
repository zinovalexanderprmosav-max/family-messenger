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
});
