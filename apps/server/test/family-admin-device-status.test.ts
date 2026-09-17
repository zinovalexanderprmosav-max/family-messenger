import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { hashOpaqueToken } from '../src/auth/session.js';

const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl) throw new Error('DATABASE_URL_required_for_family_admin_device_status_tests');
const pool=new Pool({connectionString:databaseUrl});
let app:FastifyInstance;

beforeAll(async()=>{app=await buildApp({pool});});
afterAll(async()=>{await app.close();await pool.end();});
beforeEach(async()=>{await pool.query(`TRUNCATE audit_events,auth_challenges,sessions,message_envelopes,device_key_envelopes,conversation_key_versions,chat_members,chats,invitations,devices,family_memberships,members,families RESTART IDENTITY CASCADE`);});

async function seedFamily(){
  const family=(await pool.query<{id:string}>(`INSERT INTO families(display_name) VALUES('Device Guard Family') RETURNING id`)).rows[0]!;
  const alex=(await pool.query<{id:string}>(`INSERT INTO members(display_name) VALUES('Alex') RETURNING id`)).rows[0]!;
  const mama=(await pool.query<{id:string}>(`INSERT INTO members(display_name) VALUES('Мама') RETURNING id`)).rows[0]!;
  await pool.query(`INSERT INTO family_memberships(family_id,member_id,role,status) VALUES($1,$2,'admin','active'),($1,$3,'member','active')`,[family.id,alex.id,mama.id]);
  await pool.query(`UPDATE families SET primary_admin_member_id=$1 WHERE id=$2`,[alex.id,family.id]);
  const device=(await pool.query<{id:string}>(`
    INSERT INTO devices(family_id,member_id,device_name,encryption_public_key,signing_public_key,status)
    VALUES($1,$2,'Alex iPhone','enc-device-guard','sig-device-guard','active')
    RETURNING id
  `,[family.id,alex.id])).rows[0]!;
  const token='device-guard-session';
  const csrf='device-guard-csrf';
  await pool.query(`INSERT INTO sessions(token_hash,device_id,member_id,family_id,csrf_token,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 day')`,[hashOpaqueToken(token),device.id,alex.id,family.id,csrf]);
  return {familyId:family.id,alexId:alex.id,mamaId:mama.id,deviceId:device.id,token,csrf};
}

function headers(seeded:{token:string;csrf:string}){
  return {cookie:`fm_session=${seeded.token}`,'x-csrf-token':seeded.csrf};
}

describe('administrator mutation device status',()=>{
  it('rejects promotion from a revoked primary-administrator device',async()=>{
    const seeded=await seedFamily();
    await pool.query(`UPDATE devices SET status='revoked',revoked_at=now() WHERE id=$1`,[seeded.deviceId]);

    const response=await app.inject({method:'POST',url:`/v1/family/admins/${seeded.mamaId}/promote`,headers:headers(seeded)});

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({error:'device_not_active'});
    const membership=await pool.query<{role:string}>(`SELECT role FROM family_memberships WHERE family_id=$1 AND member_id=$2`,[seeded.familyId,seeded.mamaId]);
    expect(membership.rows[0]?.role).toBe('member');
  });

  it('rejects demotion from a pending-key primary-administrator device',async()=>{
    const seeded=await seedFamily();
    await pool.query(`UPDATE family_memberships SET role='admin' WHERE family_id=$1 AND member_id=$2`,[seeded.familyId,seeded.mamaId]);
    await pool.query(`UPDATE devices SET status='pending_key' WHERE id=$1`,[seeded.deviceId]);

    const response=await app.inject({method:'POST',url:`/v1/family/admins/${seeded.mamaId}/demote`,headers:headers(seeded)});

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({error:'device_not_active'});
    const membership=await pool.query<{role:string}>(`SELECT role FROM family_memberships WHERE family_id=$1 AND member_id=$2`,[seeded.familyId,seeded.mamaId]);
    expect(membership.rows[0]?.role).toBe('admin');
  });
});
