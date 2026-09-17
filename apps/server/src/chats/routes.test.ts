import { afterAll,beforeEach,describe,expect,it } from 'vitest';
import { buildApp } from '../app.js';
import { createPool } from '../db/pool.js';
import { createFamilyBootstrap } from '../families/repository.js';
import { hashOpaqueToken } from '../auth/session.js';

const baseUrl=process.env.TEST_DATABASE_URL;
if(!baseUrl)throw new Error('TEST_DATABASE_URL_required');
const schema='fm_phase3_direct_chats_test';
const adminPool=createPool(baseUrl);
const schemaUrl=new URL(baseUrl);schemaUrl.searchParams.set('options',`-c search_path=${schema}`);
const pool=createPool(schemaUrl.toString());
async function reset(){await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await adminPool.query(`CREATE SCHEMA ${schema}`);}

async function seedMember(input:{familyId:string;displayName:string;deviceName:string;enc:string;sign:string;token:string;csrf:string}){
  const member=await pool.query<{id:string}>(`INSERT INTO members(display_name) VALUES($1) RETURNING id`,[input.displayName]);
  const memberId=member.rows[0]!.id;
  await pool.query(`INSERT INTO family_memberships(family_id,member_id,role,status) VALUES($1,$2,'member','active')`,[input.familyId,memberId]);
  const device=await pool.query<{id:string}>(`INSERT INTO devices(family_id,member_id,device_name,encryption_public_key,signing_public_key,status) VALUES($1,$2,$3,$4,$5,'active') RETURNING id`,[input.familyId,memberId,input.deviceName,input.enc,input.sign]);
  const deviceId=device.rows[0]!.id;
  await pool.query(`INSERT INTO sessions(token_hash,device_id,member_id,family_id,csrf_token,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 day')`,[hashOpaqueToken(input.token),deviceId,memberId,input.familyId,input.csrf]);
  const familyChat=await pool.query<{id:string}>(`SELECT id FROM chats WHERE family_id=$1 AND kind='family'`,[input.familyId]);
  await pool.query(`INSERT INTO chat_members(chat_id,member_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,[familyChat.rows[0]!.id,memberId]);
  return {memberId,deviceId,...input};
}

async function seed(){
  const tx=await pool.connect();
  let owner:Awaited<ReturnType<typeof createFamilyBootstrap>>;
  try{
    await tx.query('BEGIN');
    owner=await createFamilyBootstrap(tx,{familyDisplayName:'Family',memberDisplayName:'Owner',deviceName:'Owner iPhone',encryptionPublicKey:'enc-owner',signingPublicKey:'sign-owner',initialFamilyChatKeyEnvelope:'sealed-owner'});
    await tx.query(`INSERT INTO sessions(token_hash,device_id,member_id,family_id,csrf_token,expires_at) VALUES($1,$2,$3,$4,'owner-csrf',now()+interval '1 day')`,[hashOpaqueToken('owner-token'),owner.deviceId,owner.memberId,owner.familyId]);
    await tx.query('COMMIT');
  }catch(error){await tx.query('ROLLBACK');throw error;}finally{tx.release();}
  const other=await seedMember({familyId:owner!.familyId,displayName:'Mama',deviceName:'Mama Android',enc:'enc-mama',sign:'sign-mama',token:'mama-token',csrf:'mama-csrf'});
  return {owner:owner!,other};
}

beforeEach(reset);
afterAll(async()=>{await pool.end();await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await adminPool.end();});

describe('direct chat preparation',()=>{
  it('returns one canonical chat for A-to-B and B-to-A even when opened concurrently',async()=>{
    const app=await buildApp({pool});
    try{
      const s=await seed();
      const [fromOwner,fromMama]=await Promise.all([
        app.inject({method:'POST',url:`/v1/direct-chats/${s.other.memberId}/prepare`,headers:{cookie:'fm_session=owner-token','x-csrf-token':'owner-csrf'},payload:{}}),
        app.inject({method:'POST',url:`/v1/direct-chats/${s.owner.memberId}/prepare`,headers:{cookie:'fm_session=mama-token','x-csrf-token':'mama-csrf'},payload:{}})
      ]);
      expect([200,201]).toContain(fromOwner.statusCode);
      expect([200,201]).toContain(fromMama.statusCode);
      const a=fromOwner.json();const b=fromMama.json();
      expect(a.chatId).toBe(b.chatId);
      expect(a).toEqual(expect.objectContaining({kind:'direct',keyInitialized:false}));
      expect(a.recipientDevices).toEqual(expect.arrayContaining([
        expect.objectContaining({deviceId:s.owner.deviceId,memberId:s.owner.memberId,encryptionPublicKey:'enc-owner'}),
        expect.objectContaining({deviceId:s.other.deviceId,memberId:s.other.memberId,encryptionPublicKey:'enc-mama'})
      ]));
      const pairs=await pool.query(`SELECT chat_id FROM direct_chat_pairs WHERE family_id=$1`,[s.owner.familyId]);
      expect(pairs.rowCount).toBe(1);
      const members=await pool.query(`SELECT member_id FROM chat_members WHERE chat_id=$1 ORDER BY member_id`,[a.chatId]);
      expect(members.rows.map(row=>row.member_id).sort()).toEqual([s.owner.memberId,s.other.memberId].sort());
    }finally{await app.close();}
  });

  it('rejects self, removed targets, and targets from another family',async()=>{
    const app=await buildApp({pool});
    try{
      const s=await seed();
      const headers={cookie:'fm_session=owner-token','x-csrf-token':'owner-csrf'};
      const self=await app.inject({method:'POST',url:`/v1/direct-chats/${s.owner.memberId}/prepare`,headers,payload:{}});
      expect(self.statusCode).toBe(400);

      await pool.query(`UPDATE family_memberships SET status='removed' WHERE family_id=$1 AND member_id=$2`,[s.owner.familyId,s.other.memberId]);
      const removed=await app.inject({method:'POST',url:`/v1/direct-chats/${s.other.memberId}/prepare`,headers,payload:{}});
      expect(removed.statusCode).toBe(404);

      const otherFamily=await pool.query<{id:string}>(`INSERT INTO families(display_name) VALUES('Other') RETURNING id`);
      const stranger=await pool.query<{id:string}>(`INSERT INTO members(display_name) VALUES('Stranger') RETURNING id`);
      await pool.query(`INSERT INTO family_memberships(family_id,member_id,role,status) VALUES($1,$2,'member','active')`,[otherFamily.rows[0]!.id,stranger.rows[0]!.id]);
      const foreign=await app.inject({method:'POST',url:`/v1/direct-chats/${stranger.rows[0]!.id}/prepare`,headers,payload:{}});
      expect(foreign.statusCode).toBe(404);
    }finally{await app.close();}
  });

  it('initializes a direct chat key exactly once using sealed envelopes for every active participant device',async()=>{
    const app=await buildApp({pool});
    try{
      const s=await seed();
      const headers={cookie:'fm_session=owner-token','x-csrf-token':'owner-csrf'};
      const prepared=await app.inject({method:'POST',url:`/v1/direct-chats/${s.other.memberId}/prepare`,headers,payload:{}});
      expect([200,201]).toContain(prepared.statusCode);
      const {chatId}=prepared.json();

      const initialized=await app.inject({
        method:'POST',url:`/v1/chats/${chatId}/keys/initialize`,headers,
        payload:{keyVersion:1,envelopes:[
          {deviceId:s.owner.deviceId,sealedKeyEnvelope:'sealed-direct-owner'},
          {deviceId:s.other.deviceId,sealedKeyEnvelope:'sealed-direct-mama'}
        ]}
      });
      expect(initialized.statusCode).toBe(201);

      const versions=await pool.query(`SELECT key_version FROM conversation_key_versions WHERE chat_id=$1`,[chatId]);
      expect(versions.rows).toEqual([{key_version:1}]);
      const envelopes=await pool.query<{device_id:string;sealed_key_envelope:string}>(`SELECT device_id,sealed_key_envelope FROM device_key_envelopes WHERE chat_id=$1 ORDER BY device_id`,[chatId]);
      expect(envelopes.rows).toEqual(expect.arrayContaining([
        {device_id:s.owner.deviceId,sealed_key_envelope:'sealed-direct-owner'},
        {device_id:s.other.deviceId,sealed_key_envelope:'sealed-direct-mama'}
      ]));

      const duplicate=await app.inject({
        method:'POST',url:`/v1/chats/${chatId}/keys/initialize`,headers,
        payload:{keyVersion:1,envelopes:[
          {deviceId:s.owner.deviceId,sealedKeyEnvelope:'different-owner'},
          {deviceId:s.other.deviceId,sealedKeyEnvelope:'different-mama'}
        ]}
      });
      expect(duplicate.statusCode).toBe(409);
      expect(duplicate.json()).toEqual({error:'chat_keys_already_initialized'});
    }finally{await app.close();}
  });
});
