import { afterAll,beforeEach,describe,expect,it } from 'vitest';
import { buildApp } from '../app.js';
import { createPool } from '../db/pool.js';
import { createFamilyBootstrap } from '../families/repository.js';
import { hashOpaqueToken } from './session.js';

const baseUrl=process.env.TEST_DATABASE_URL;
if(!baseUrl)throw new Error('TEST_DATABASE_URL_required');
const schema='fm_phase3_auth_routes_test';
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
    const owner=await createFamilyBootstrap(tx,{
      familyDisplayName:'Family',memberDisplayName:'Owner',deviceName:'Owner iPhone',
      encryptionPublicKey:'enc-owner',signingPublicKey:'sign-owner',initialFamilyChatKeyEnvelope:'sealed-owner'
    });
    const member=await tx.query<{id:string}>(`INSERT INTO members(display_name) VALUES('Member') RETURNING id`);
    const memberId=member.rows[0]!.id;
    await tx.query(`INSERT INTO family_memberships(family_id,member_id,role,status) VALUES($1,$2,'member','active')`,[owner.familyId,memberId]);
    const device=await tx.query<{id:string}>(`INSERT INTO devices(family_id,member_id,device_name,encryption_public_key,signing_public_key,status) VALUES($1,$2,'Member Android','enc-member','sign-member','active') RETURNING id`,[owner.familyId,memberId]);
    const memberDeviceId=device.rows[0]!.id;
    await tx.query(`INSERT INTO chat_members(chat_id,member_id) VALUES($1,$2)`,[owner.familyChatId,memberId]);

    const ownerToken='owner-session'; const ownerCsrf='owner-csrf';
    const memberToken='member-session'; const memberCsrf='member-csrf';
    await tx.query(`INSERT INTO sessions(token_hash,device_id,member_id,family_id,csrf_token,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 day'),($6,$7,$8,$4,$9,now()+interval '1 day')`,[
      hashOpaqueToken(ownerToken),owner.deviceId,owner.memberId,owner.familyId,ownerCsrf,
      hashOpaqueToken(memberToken),memberDeviceId,memberId,memberCsrf
    ]);
    await tx.query('COMMIT');
    return {...owner,memberId,memberDeviceId,ownerToken,ownerCsrf,memberToken,memberCsrf};
  }catch(error){await tx.query('ROLLBACK');throw error;}finally{tx.release();}
}

beforeEach(reset);
afterAll(async()=>{
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await adminPool.end();
});

describe('central role authorization on HTTP routes',()=>{
  it('allows the owner to invite, inspect pending devices and appoint the secondary admin',async()=>{
    const app=await buildApp({pool});
    try{
      const seeded=await seed();
      const cookie=`fm_session=${seeded.ownerToken}`;

      const invite=await app.inject({method:'POST',url:'/v1/invitations',headers:{cookie,'x-csrf-token':seeded.ownerCsrf},payload:{}});
      expect(invite.statusCode).toBe(201);

      const pending=await app.inject({method:'GET',url:'/v1/devices/pending',headers:{cookie}});
      expect(pending.statusCode).toBe(200);

      const promote=await app.inject({method:'POST',url:`/v1/family/admins/${seeded.memberId}/promote`,headers:{cookie,'x-csrf-token':seeded.ownerCsrf},payload:{}});
      expect(promote.statusCode).toBe(204);
    }finally{await app.close();}
  });

  it('keeps ordinary members out of administrator routes',async()=>{
    const app=await buildApp({pool});
    try{
      const seeded=await seed();
      const cookie=`fm_session=${seeded.memberToken}`;
      const invite=await app.inject({method:'POST',url:'/v1/invitations',headers:{cookie,'x-csrf-token':seeded.memberCsrf},payload:{}});
      expect(invite.statusCode).toBe(403);
    }finally{await app.close();}
  });

  it('does not issue auth challenges for devices whose membership was removed',async()=>{
    const app=await buildApp({pool});
    try{
      const seeded=await seed();
      await pool.query(`UPDATE family_memberships SET status='removed' WHERE family_id=$1 AND member_id=$2`,[seeded.familyId,seeded.memberId]);
      const response=await app.inject({method:'POST',url:'/v1/auth/challenge',payload:{deviceId:seeded.memberDeviceId}});
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({error:'device_not_found'});
    }finally{await app.close();}
  });
});
