import { afterAll,beforeEach,describe,expect,it } from 'vitest';
import { buildApp } from '../app.js';
import { createPool } from '../db/pool.js';
import { createFamilyBootstrap } from '../families/repository.js';
import { hashOpaqueToken } from '../auth/session.js';

const baseUrl=process.env.TEST_DATABASE_URL;
if(!baseUrl)throw new Error('TEST_DATABASE_URL_required');
const schema='fm_phase3_members_routes_test';
const adminPool=createPool(baseUrl);
const schemaUrl=new URL(baseUrl);
schemaUrl.searchParams.set('options',`-c search_path=${schema}`);
const pool=createPool(schemaUrl.toString());

async function reset(){
  await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await adminPool.query(`CREATE SCHEMA ${schema}`);
}

async function seed(){
  const tx=await pool.connect();
  try{
    await tx.query('BEGIN');
    const owner=await createFamilyBootstrap(tx,{familyDisplayName:'Family',memberDisplayName:'Owner',deviceName:'Owner iPhone',encryptionPublicKey:'enc-owner',signingPublicKey:'sign-owner',initialFamilyChatKeyEnvelope:'sealed-owner'});
    async function addMember(name:string,role:'admin'|'member',suffix:string,status:'active'|'removed'='active'){
      const m=await tx.query<{id:string}>(`INSERT INTO members(display_name) VALUES($1) RETURNING id`,[name]);
      const memberId=m.rows[0]!.id;
      await tx.query(`INSERT INTO family_memberships(family_id,member_id,role,status) VALUES($1,$2,$3,$4)`,[owner.familyId,memberId,role,status]);
      const d=await tx.query<{id:string}>(`INSERT INTO devices(family_id,member_id,device_name,encryption_public_key,signing_public_key,status) VALUES($1,$2,$3,$4,$5,'active') RETURNING id`,[owner.familyId,memberId,`${name} Android`,`enc-${suffix}`,`sign-${suffix}`]);
      if(status==='active') await tx.query(`INSERT INTO chat_members(chat_id,member_id) VALUES($1,$2)`,[owner.familyChatId,memberId]);
      return {memberId,deviceId:d.rows[0]!.id};
    }
    const admin=await addMember('Wife','admin','admin');
    const member=await addMember('Vika','member','member');
    const removed=await addMember('Removed','member','removed','removed');
    async function session(memberId:string,deviceId:string,label:string){
      const token=`${label}-token`; const csrf=`${label}-csrf`;
      await tx.query(`INSERT INTO sessions(token_hash,device_id,member_id,family_id,csrf_token,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 day')`,[hashOpaqueToken(token),deviceId,memberId,owner.familyId,csrf]);
      return {token,csrf};
    }
    const ownerSession=await session(owner.memberId,owner.deviceId,'owner');
    const adminSession=await session(admin.memberId,admin.deviceId,'admin');
    const memberSession=await session(member.memberId,member.deviceId,'member');
    await tx.query('COMMIT');
    return {...owner,admin,member,removed,ownerSession,adminSession,memberSession};
  }catch(error){await tx.query('ROLLBACK');throw error;}finally{tx.release();}
}

const headers=(s:{token:string;csrf:string})=>({cookie:`fm_session=${s.token}`,'x-csrf-token':s.csrf});

beforeEach(reset);
afterAll(async()=>{await pool.end();await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await adminPool.end();});

describe('contacts and family member management',()=>{
  it('returns active family contacts automatically and excludes self/removed members',async()=>{
    const app=await buildApp({pool});
    try{
      const s=await seed();
      const response=await app.inject({method:'GET',url:'/v1/contacts',headers:{cookie:`fm_session=${s.ownerSession.token}`}});
      expect(response.statusCode).toBe(200);
      expect(response.json().items).toEqual([
        expect.objectContaining({memberId:s.admin.memberId,displayName:'Wife',role:'admin'}),
        expect.objectContaining({memberId:s.member.memberId,displayName:'Vika',role:'member'})
      ]);
    }finally{await app.close();}
  });

  it('lets owner remove secondary admin and lets secondary admin remove an ordinary member',async()=>{
    const app=await buildApp({pool});
    try{
      const s=await seed();
      const removeMember=await app.inject({method:'DELETE',url:`/v1/members/${s.member.memberId}`,headers:headers(s.adminSession)});
      expect(removeMember.statusCode).toBe(204);
      const removedMember=await pool.query<{status:string}>(`SELECT status FROM family_memberships WHERE family_id=$1 AND member_id=$2`,[s.familyId,s.member.memberId]);
      expect(removedMember.rows[0]?.status).toBe('removed');

      const removeAdmin=await app.inject({method:'DELETE',url:`/v1/members/${s.admin.memberId}`,headers:headers(s.ownerSession)});
      expect(removeAdmin.statusCode).toBe(204);
    }finally{await app.close();}
  });

  it('never lets secondary admin remove the owner',async()=>{
    const app=await buildApp({pool});
    try{
      const s=await seed();
      const response=await app.inject({method:'DELETE',url:`/v1/members/${s.memberId}`,headers:headers(s.adminSession)});
      expect(response.statusCode).toBe(403);
      const membership=await pool.query<{status:string}>(`SELECT status FROM family_memberships WHERE family_id=$1 AND member_id=$2`,[s.familyId,s.memberId]);
      expect(membership.rows[0]?.status).toBe('active');
    }finally{await app.close();}
  });
});
