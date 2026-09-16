import { afterAll,beforeEach,describe,expect,it } from 'vitest';
import { createPool } from '../db/pool.js';
import { migrate } from '../db/migrate.js';
import { findSession,hashOpaqueToken } from './session.js';

const baseUrl=process.env.TEST_DATABASE_URL;
if(!baseUrl)throw new Error('TEST_DATABASE_URL_required');
const schema='fm_phase3_session_test';
const adminPool=createPool(baseUrl);
const schemaUrl=new URL(baseUrl);
schemaUrl.searchParams.set('options',`-c search_path=${schema}`);
const pool=createPool(schemaUrl.toString());

async function reset(){
  await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
}

async function seedSession(){
  const family=await pool.query<{id:string}>(`INSERT INTO families(display_name) VALUES('Family') RETURNING id`);
  const member=await pool.query<{id:string}>(`INSERT INTO members(display_name) VALUES('Owner') RETURNING id`);
  await pool.query(`INSERT INTO family_memberships(family_id,member_id,role,status) VALUES($1,$2,'owner','active')`,[family.rows[0]!.id,member.rows[0]!.id]);
  const device=await pool.query<{id:string}>(`INSERT INTO devices(family_id,member_id,device_name,encryption_public_key,signing_public_key,status) VALUES($1,$2,'iPhone','enc','sign','active') RETURNING id`,[family.rows[0]!.id,member.rows[0]!.id]);
  const token='session-token';
  await pool.query(`INSERT INTO sessions(token_hash,device_id,member_id,family_id,csrf_token,expires_at) VALUES($1,$2,$3,$4,'csrf',now()+interval '1 day')`,[hashOpaqueToken(token),device.rows[0]!.id,member.rows[0]!.id,family.rows[0]!.id]);
  return {token,familyId:family.rows[0]!.id,memberId:member.rows[0]!.id,deviceId:device.rows[0]!.id};
}

beforeEach(reset);
afterAll(async()=>{
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await adminPool.end();
});

describe('session membership enforcement',()=>{
  it('returns the active family role and records device activity',async()=>{
    const seeded=await seedSession();
    const principal=await findSession(pool,seeded.token);
    expect(principal).toEqual({
      deviceId:seeded.deviceId,
      memberId:seeded.memberId,
      familyId:seeded.familyId,
      deviceStatus:'active',
      role:'owner',
      csrfToken:'csrf'
    });
    const device=await pool.query<{last_seen_at:Date|null}>(`SELECT last_seen_at FROM devices WHERE id=$1`,[seeded.deviceId]);
    expect(device.rows[0]?.last_seen_at).toBeInstanceOf(Date);
  });

  it('rejects an otherwise valid session when membership is removed',async()=>{
    const seeded=await seedSession();
    await pool.query(`UPDATE family_memberships SET status='removed' WHERE family_id=$1 AND member_id=$2`,[seeded.familyId,seeded.memberId]);
    await expect(findSession(pool,seeded.token)).resolves.toBeNull();
  });

  it('rejects a session for a revoked device',async()=>{
    const seeded=await seedSession();
    await pool.query(`UPDATE devices SET status='revoked',revoked_at=now() WHERE id=$1`,[seeded.deviceId]);
    await expect(findSession(pool,seeded.token)).resolves.toBeNull();
  });
});
