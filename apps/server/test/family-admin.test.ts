import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/db/migrate.js';

const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl) throw new Error('DATABASE_URL_required_for_family_admin_tests');
const pool=new Pool({connectionString:databaseUrl});
let app:FastifyInstance;

beforeAll(async()=>{app=await buildApp({pool});});
afterAll(async()=>{await app.close();await pool.end();});
beforeEach(async()=>{await pool.query(`TRUNCATE audit_events,auth_challenges,sessions,message_envelopes,device_key_envelopes,conversation_key_versions,chat_members,chats,invitations,devices,family_memberships,members,families RESTART IDENTITY CASCADE`);});

async function readPrimaryAdmin(familyId:string){
  const stored=await pool.query<{primary_admin_member_id:string|null}>(`
    SELECT to_jsonb(families)->>'primary_admin_member_id' AS primary_admin_member_id
    FROM families
    WHERE id=$1
  `,[familyId]);
  return stored.rows[0]?.primary_admin_member_id ?? null;
}

async function bootstrapFamily(){
  const response=await app.inject({
    method:'POST',
    url:'/v1/families/bootstrap',
    payload:{
      familyDisplayName:'Family',
      memberDisplayName:'Alex',
      deviceName:'iPhone Alex',
      encryptionPublicKey:'enc-alex',
      signingPublicKey:'sig-alex',
      initialFamilyChatKeyEnvelope:'sealed-family-key'
    }
  });
  expect(response.statusCode).toBe(201);
  return response.json() as {familyId:string;memberId:string};
}

describe('primary family administrator persistence',()=>{
  it('stores the family creator as primary administrator during bootstrap',async()=>{
    const created=await bootstrapFamily();
    expect(await readPrimaryAdmin(created.familyId)).toBe(created.memberId);
  });

  it('backfills the earliest active administrator for an existing family',async()=>{
    const family=(await pool.query<{id:string}>(`INSERT INTO families(display_name) VALUES('Legacy Family') RETURNING id`)).rows[0]!;
    const newer=(await pool.query<{id:string}>(`INSERT INTO members(display_name) VALUES('Newer Admin') RETURNING id`)).rows[0]!;
    const older=(await pool.query<{id:string}>(`INSERT INTO members(display_name) VALUES('Older Admin') RETURNING id`)).rows[0]!;
    await pool.query(`
      INSERT INTO family_memberships(family_id,member_id,role,status,created_at)
      VALUES
        ($1,$2,'admin','active','2026-02-01T00:00:00Z'),
        ($1,$3,'admin','active','2026-01-01T00:00:00Z')
    `,[family.id,newer.id,older.id]);

    await migrate(pool);

    expect(await readPrimaryAdmin(family.id)).toBe(older.id);
  });

  it('uses member id as a deterministic tie breaker during backfill',async()=>{
    const family=(await pool.query<{id:string}>(`INSERT INTO families(display_name) VALUES('Tie Family') RETURNING id`)).rows[0]!;
    const smallerId='00000000-0000-4000-8000-000000000001';
    const largerId='00000000-0000-4000-8000-000000000002';
    await pool.query(`INSERT INTO members(id,display_name) VALUES($1,'Admin A'),($2,'Admin B')`,[smallerId,largerId]);
    await pool.query(`
      INSERT INTO family_memberships(family_id,member_id,role,status,created_at)
      VALUES
        ($1,$2,'admin','active','2026-01-01T00:00:00Z'),
        ($1,$3,'admin','active','2026-01-01T00:00:00Z')
    `,[family.id,largerId,smallerId]);

    await migrate(pool);

    expect(await readPrimaryAdmin(family.id)).toBe(smallerId);
  });
});
