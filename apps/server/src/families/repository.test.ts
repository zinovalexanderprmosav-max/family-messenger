import { afterAll,beforeEach,describe,expect,it } from 'vitest';
import { createPool } from '../db/pool.js';
import { migrate } from '../db/migrate.js';
import { createFamilyBootstrap,getFamilySummary,promoteAdministrator } from './repository.js';

const baseUrl=process.env.TEST_DATABASE_URL;
if(!baseUrl)throw new Error('TEST_DATABASE_URL_required');
const schema='fm_phase3_family_repo_test';
const adminPool=createPool(baseUrl);
const schemaUrl=new URL(baseUrl);
schemaUrl.searchParams.set('options',`-c search_path=${schema}`);
const pool=createPool(schemaUrl.toString());

async function reset(){
  await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
}

async function bootstrap(){
  const tx=await pool.connect();
  try{
    await tx.query('BEGIN');
    const created=await createFamilyBootstrap(tx,{
      familyDisplayName:'Family',
      memberDisplayName:'Owner',
      deviceName:'Owner iPhone',
      encryptionPublicKey:'enc-owner',
      signingPublicKey:'sign-owner',
      initialFamilyChatKeyEnvelope:'sealed-owner'
    });
    await tx.query('COMMIT');
    return created;
  }catch(error){await tx.query('ROLLBACK');throw error;}finally{tx.release();}
}

beforeEach(reset);
afterAll(async()=>{
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await adminPool.end();
});

describe('family repository Phase 3 roles',()=>{
  it('bootstraps the first member as the family owner',async()=>{
    const created=await bootstrap();
    const membership=await pool.query<{role:string}>(`SELECT role FROM family_memberships WHERE family_id=$1 AND member_id=$2`,[created.familyId,created.memberId]);
    expect(membership.rows[0]?.role).toBe('owner');

    const tx=await pool.connect();
    try{
      const summary=await getFamilySummary(tx,created.familyId);
      expect(summary?.members).toEqual([
        expect.objectContaining({id:created.memberId,role:'owner',status:'active'})
      ]);
    }finally{tx.release();}
  });

  it('allows at most one active secondary administrator',async()=>{
    const created=await bootstrap();
    const first=await pool.query<{id:string}>(`INSERT INTO members(display_name) VALUES('Admin candidate') RETURNING id`);
    const second=await pool.query<{id:string}>(`INSERT INTO members(display_name) VALUES('Another candidate') RETURNING id`);
    await pool.query(`INSERT INTO family_memberships(family_id,member_id,role,status) VALUES($1,$2,'member','active'),($1,$3,'member','active')`,[created.familyId,first.rows[0]!.id,second.rows[0]!.id]);

    const tx=await pool.connect();
    try{
      await promoteAdministrator(tx,created.familyId,first.rows[0]!.id);
      await expect(promoteAdministrator(tx,created.familyId,second.rows[0]!.id)).rejects.toThrow('administrator_limit_reached');
    }finally{tx.release();}
  });
});
