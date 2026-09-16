import { afterAll,beforeEach,describe,expect,it } from 'vitest';
import { buildApp } from '../app.js';
import { createPool } from '../db/pool.js';
import { createFamilyBootstrap } from '../families/repository.js';
import { hashOpaqueToken } from '../auth/session.js';

const baseUrl=process.env.TEST_DATABASE_URL;
if(!baseUrl)throw new Error('TEST_DATABASE_URL_required');
const schema='fm_phase3_device_links_test';
const adminPool=createPool(baseUrl);
const schemaUrl=new URL(baseUrl);schemaUrl.searchParams.set('options',`-c search_path=${schema}`);
const pool=createPool(schemaUrl.toString());
async function reset(){await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await adminPool.query(`CREATE SCHEMA ${schema}`);}

async function seed(){
  const tx=await pool.connect();
  try{
    await tx.query('BEGIN');
    const owner=await createFamilyBootstrap(tx,{familyDisplayName:'Family',memberDisplayName:'Owner',deviceName:'Owner iPhone',encryptionPublicKey:'enc-owner',signingPublicKey:'sign-owner',initialFamilyChatKeyEnvelope:'sealed-owner'});
    const token='owner-token',csrf='owner-csrf';
    await tx.query(`INSERT INTO sessions(token_hash,device_id,member_id,family_id,csrf_token,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 day')`,[hashOpaqueToken(token),owner.deviceId,owner.memberId,owner.familyId,csrf]);
    await tx.query('COMMIT');
    return {...owner,token,csrf};
  }catch(error){await tx.query('ROLLBACK');throw error;}finally{tx.release();}
}

beforeEach(reset);
afterAll(async()=>{await pool.end();await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await adminPool.end();});

describe('device link flow',()=>{
  it('links a new pending device to the same member and consumes token once',async()=>{
    const app=await buildApp({pool});
    try{
      const s=await seed();
      const create=await app.inject({method:'POST',url:'/v1/device-links',headers:{cookie:`fm_session=${s.token}`,'x-csrf-token':s.csrf},payload:{}});
      expect(create.statusCode).toBe(201);
      const {linkToken}=create.json();

      const inspect=await app.inject({method:'POST',url:'/v1/device-links/inspect',payload:{linkToken}});
      expect(inspect.statusCode).toBe(200);
      expect(inspect.json()).toEqual(expect.objectContaining({familyId:s.familyId,memberId:s.memberId,familyDisplayName:'Family',memberDisplayName:'Owner'}));

      const accept=await app.inject({method:'POST',url:'/v1/device-links/accept',payload:{linkToken,deviceName:'Owner Windows',encryptionPublicKey:'enc-new',signingPublicKey:'sign-new'}});
      expect(accept.statusCode).toBe(201);
      expect(accept.json()).toEqual(expect.objectContaining({familyId:s.familyId,memberId:s.memberId,familyChatId:s.familyChatId,status:'pending_key'}));
      const device=await pool.query<{member_id:string;status:string}>(`SELECT member_id,status FROM devices WHERE id=$1`,[accept.json().deviceId]);
      expect(device.rows[0]).toEqual({member_id:s.memberId,status:'pending_key'});

      const reused=await app.inject({method:'POST',url:'/v1/device-links/accept',payload:{linkToken,deviceName:'Again',encryptionPublicKey:'enc-again',signingPublicKey:'sign-again'}});
      expect(reused.statusCode).toBe(410);
    }finally{await app.close();}
  });

  it('rejects a fourth active or pending device',async()=>{
    const app=await buildApp({pool});
    try{
      const s=await seed();
      await pool.query(`INSERT INTO devices(family_id,member_id,device_name,encryption_public_key,signing_public_key,status) VALUES($1,$2,'Second','enc-2','sign-2','active'),($1,$2,'Third','enc-3','sign-3','pending_key')`,[s.familyId,s.memberId]);
      const create=await app.inject({method:'POST',url:'/v1/device-links',headers:{cookie:`fm_session=${s.token}`,'x-csrf-token':s.csrf},payload:{}});
      const {linkToken}=create.json();
      const accept=await app.inject({method:'POST',url:'/v1/device-links/accept',payload:{linkToken,deviceName:'Fourth','encryptionPublicKey':'enc-4','signingPublicKey':'sign-4'}});
      expect(accept.statusCode).toBe(409);
      expect(accept.json()).toEqual({error:'device_limit_reached'});
    }finally{await app.close();}
  });
});
