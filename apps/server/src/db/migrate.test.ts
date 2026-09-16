import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createPool } from './pool.js';
import { migrate } from './migrate.js';

const baseUrl=process.env.TEST_DATABASE_URL;
if(!baseUrl)throw new Error('TEST_DATABASE_URL_required');

const schema='fm_phase3_migration_test';
const adminPool=createPool(baseUrl);
const schemaUrl=new URL(baseUrl);
schemaUrl.searchParams.set('options',`-c search_path=${schema}`);
const pool=createPool(schemaUrl.toString());

async function resetSchema(){
  await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await adminPool.query(`CREATE SCHEMA ${schema}`);
}

async function runLegacyCore(){
  const sql=await readFile(new URL('./migrations/001_core.sql',import.meta.url),'utf8');
  await pool.query(sql);
}

beforeEach(resetSchema);
afterAll(async()=>{
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await adminPool.end();
});

describe('Phase 3 identity migration',()=>{
  it('adds owner role and Phase 3 identity/chat/device tables',async()=>{
    await migrate(pool);

    const roles=await pool.query<{definition:string}>(`
      SELECT pg_get_constraintdef(oid) definition
      FROM pg_constraint
      WHERE conname='family_memberships_role_check'
        AND conrelid='family_memberships'::regclass
    `);
    expect(roles.rows[0]?.definition).toContain('owner');

    const tables=await pool.query<{tablename:string}>(`
      SELECT tablename FROM pg_tables
      WHERE schemaname=$1
        AND tablename IN ('direct_chat_pairs','device_links','chat_key_rotation_requests')
      ORDER BY tablename
    `,[schema]);
    expect(tables.rows.map(row=>row.tablename)).toEqual([
      'chat_key_rotation_requests',
      'device_links',
      'direct_chat_pairs'
    ]);

    const columns=await pool.query<{column_name:string}>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema=$1 AND table_name='devices' AND column_name='last_seen_at'
    `,[schema]);
    expect(columns.rows).toHaveLength(1);
  });

  it('promotes the earliest legacy administrator to owner and keeps at most one secondary admin',async()=>{
    await runLegacyCore();
    const family=await pool.query<{id:string}>(`INSERT INTO families(display_name) VALUES('Legacy family') RETURNING id`);
    const familyId=family.rows[0]!.id;
    const first=await pool.query<{id:string}>(`INSERT INTO members(display_name,created_at) VALUES('First admin','2026-01-01T00:00:00Z') RETURNING id`);
    const second=await pool.query<{id:string}>(`INSERT INTO members(display_name,created_at) VALUES('Second admin','2026-01-02T00:00:00Z') RETURNING id`);
    await pool.query(`INSERT INTO family_memberships(family_id,member_id,role,status,created_at) VALUES($1,$2,'admin','active','2026-01-01T00:00:00Z'),($1,$3,'admin','active','2026-01-02T00:00:00Z')`,[familyId,first.rows[0]!.id,second.rows[0]!.id]);

    await migrate(pool);

    const roles=await pool.query<{member_id:string;role:string}>(`
      SELECT member_id,role FROM family_memberships
      WHERE family_id=$1 AND status='active'
      ORDER BY created_at,member_id
    `,[familyId]);
    expect(roles.rows).toEqual([
      {member_id:first.rows[0]!.id,role:'owner'},
      {member_id:second.rows[0]!.id,role:'admin'}
    ]);
  });
});
