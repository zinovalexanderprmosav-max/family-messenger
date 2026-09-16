import { afterAll,beforeEach,describe,expect,it } from 'vitest';
import { buildApp } from '../app.js';
import { createPool } from '../db/pool.js';
import { createFamilyBootstrap } from '../families/repository.js';
import { hashOpaqueToken } from '../auth/session.js';

const baseUrl=process.env.TEST_DATABASE_URL;
if(!baseUrl)throw new Error('TEST_DATABASE_URL_required');
const schema='fm_phase3_devices_routes_test';
const adminPool=createPool(baseUrl);
const schemaUrl=new URL(baseUrl);
schemaUrl.searchParams.set('options',`-c search_path=${schema}`);
const pool=createPool(schemaUrl.toString());

async function reset(){await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await adminPool.query(`CREATE SCHEMA ${schema}`);}
async function seed(){
  const tx=await pool.connect();
  try{
    await tx.query('BEGIN');
    const owner=await createFamilyBootstrap(tx,{familyDisplayName:'Family',memberDisplayName:'Owner',deviceName:'Owner iPhone',encryptionPublicKey:'enc-owner',signingPublicKey:'sign-owner',initialFamilyChatKeyEnvelope:'sealed-owner'});
    async function add(name:string,role:'admin'|'member',suffix:string){
      const m=await tx.query<{id:string}>(`INSERT INTO members(display_name) VALUES($1) RETURNING id`,[name]);
      const memberId=m.rows[0]!.id;
      await tx.query(`INSERT INTO family_memberships(family_id,member_id,role,status) VALUES($1,$2,$3,'active')`,[owner.familyId,memberId,role]);
      const d=await tx.query<{id:string}>(`INSERT INTO devices(family_id,member_id,device_name,encryption_public_key,signing_public_key,status) VALUES($1,$2,$3,$4,$5,'active') RETURNING id`,[owner.familyId,memberId,`${name} Android`,`enc-${suffix}`,`sign-${suffix}`]);
      await tx.query(`INSERT INTO chat_members(chat_id,member_id) VALUES($1,$2)`,[owner.familyChatId,memberId]);
      return {memberId,deviceId:d.rows[0]!.id};
    }
    const admin=await add('Wife','admin','admin');
    const member=await add('Vika','member','member');
    async function session(memberId:string,deviceId:string,label:string){
      const token=`${label}-token`; const csrf=`${label}-csrf`;
      await tx.query(`INSERT INTO sessions(token_hash,device_id,member_id,family_id,csrf_token,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 day')`,[hashOpaqueToken(token),deviceId,memberId,owner.familyId,csrf]);
      return {token,csrf};
    }
    const ownerSession=await session(owner.memberId,owner.deviceId,'owner');
    const adminSession=await session(admin.memberId,admin.deviceId,'admin');
    const memberSession=await session(member.memberId,member.deviceId,'member');
    await tx.query('COMMIT');
    return {...owner,admin,member,ownerSession,adminSession,memberSession};
  }catch(error){await tx.query('ROLLBACK');throw error;}finally{tx.release();}
}
const headers=(s:{token:string;csrf:string})=>({cookie:`fm_session=${s.token}`,'x-csrf-token':s.csrf});

beforeEach(reset);
afterAll(async()=>{await pool.end();await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await adminPool.end();});

describe('device inventory and management',()=>{
  it('shows an ordinary member only their own devices',async()=>{
    const app=await buildApp({pool});
    try{
      const s=await seed();
      const response=await app.inject({method:'GET',url:'/v1/devices',headers:{cookie:`fm_session=${s.memberSession.token}`}});
      expect(response.statusCode).toBe(200);
      expect(response.json().items.map((x:{deviceId:string})=>x.deviceId)).toEqual([s.member.deviceId]);
    }finally{await app.close();}
  });

  it('lets owner rename own device and secondary admin rename an ordinary member device but not owner device',async()=>{
    const app=await buildApp({pool});
    try{
      const s=await seed();
      const ownerRename=await app.inject({method:'PATCH',url:`/v1/devices/${s.deviceId}`,headers:headers(s.ownerSession),payload:{deviceName:'My iPhone'}});
      expect(ownerRename.statusCode).toBe(200);
      expect(ownerRename.json().deviceName).toBe('My iPhone');

      const memberRename=await app.inject({method:'PATCH',url:`/v1/devices/${s.member.deviceId}`,headers:headers(s.adminSession),payload:{deviceName:'Vika phone'}});
      expect(memberRename.statusCode).toBe(200);

      const ownerByAdmin=await app.inject({method:'PATCH',url:`/v1/devices/${s.deviceId}`,headers:headers(s.adminSession),payload:{deviceName:'Forbidden'}});
      expect(ownerByAdmin.statusCode).toBe(403);
    }finally{await app.close();}
  });

  it('protects the last active owner device and revokes ordinary devices with their sessions',async()=>{
    const app=await buildApp({pool});
    try{
      const s=await seed();
      const ownerDelete=await app.inject({method:'DELETE',url:`/v1/devices/${s.deviceId}`,headers:headers(s.ownerSession)});
      expect(ownerDelete.statusCode).toBe(409);
      expect(ownerDelete.json()).toEqual({error:'owner_last_device'});

      const memberDelete=await app.inject({method:'DELETE',url:`/v1/devices/${s.member.deviceId}`,headers:headers(s.ownerSession)});
      expect(memberDelete.statusCode).toBe(204);
      const device=await pool.query<{status:string}>(`SELECT status FROM devices WHERE id=$1`,[s.member.deviceId]);
      expect(device.rows[0]?.status).toBe('revoked');
      const sessions=await pool.query(`SELECT 1 FROM sessions WHERE device_id=$1`,[s.member.deviceId]);
      expect(sessions.rowCount).toBe(0);
    }finally{await app.close();}
  });
});
