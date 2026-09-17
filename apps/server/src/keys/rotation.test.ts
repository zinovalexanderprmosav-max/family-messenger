import { afterAll,beforeEach,describe,expect,it } from 'vitest';
import { buildApp } from '../app.js';
import { createPool } from '../db/pool.js';
import { createFamilyBootstrap } from '../families/repository.js';
import { hashOpaqueToken } from '../auth/session.js';

const baseUrl=process.env.TEST_DATABASE_URL;
if(!baseUrl)throw new Error('TEST_DATABASE_URL_required');
const schema='fm_phase3_rotation_test';
const adminPool=createPool(baseUrl);
const schemaUrl=new URL(baseUrl);schemaUrl.searchParams.set('options',`-c search_path=${schema}`);
const pool=createPool(schemaUrl.toString());
async function reset(){await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await adminPool.query(`CREATE SCHEMA ${schema}`);}

async function seed(){
  const tx=await pool.connect();
  try{
    await tx.query('BEGIN');
    const owner=await createFamilyBootstrap(tx,{familyDisplayName:'Family',memberDisplayName:'Owner',deviceName:'Owner iPhone',encryptionPublicKey:'enc-owner',signingPublicKey:'sign-owner',initialFamilyChatKeyEnvelope:'sealed-owner-v1'});
    await tx.query(`INSERT INTO sessions(token_hash,device_id,member_id,family_id,csrf_token,expires_at) VALUES($1,$2,$3,$4,'owner-csrf',now()+interval '1 day')`,[hashOpaqueToken('owner-token'),owner.deviceId,owner.memberId,owner.familyId]);

    const member=await tx.query<{id:string}>(`INSERT INTO members(display_name) VALUES('Mama') RETURNING id`);
    const memberId=member.rows[0]!.id;
    await tx.query(`INSERT INTO family_memberships(family_id,member_id,role,status) VALUES($1,$2,'member','active')`,[owner.familyId,memberId]);
    const device=await tx.query<{id:string}>(`INSERT INTO devices(family_id,member_id,device_name,encryption_public_key,signing_public_key,status) VALUES($1,$2,'Mama Android','enc-mama','sign-mama','active') RETURNING id`,[owner.familyId,memberId]);
    const memberDeviceId=device.rows[0]!.id;
    await tx.query(`INSERT INTO sessions(token_hash,device_id,member_id,family_id,csrf_token,expires_at) VALUES($1,$2,$3,$4,'member-csrf',now()+interval '1 day')`,[hashOpaqueToken('member-token'),memberDeviceId,memberId,owner.familyId]);

    const familyChat=await tx.query<{id:string}>(`SELECT id FROM chats WHERE family_id=$1 AND kind='family'`,[owner.familyId]);
    const familyChatId=familyChat.rows[0]!.id;
    await tx.query(`INSERT INTO chat_members(chat_id,member_id) VALUES($1,$2)`,[familyChatId,memberId]);
    await tx.query(`INSERT INTO device_key_envelopes(chat_id,key_version,device_id,sealed_key_envelope) VALUES($1,1,$2,'sealed-mama-family-v1')`,[familyChatId,memberDeviceId]);

    const direct=await tx.query<{id:string}>(`INSERT INTO chats(family_id,kind) VALUES($1,'direct') RETURNING id`,[owner.familyId]);
    const directChatId=direct.rows[0]!.id;
    await tx.query(`INSERT INTO chat_members(chat_id,member_id) VALUES($1,$2),($1,$3)`,[directChatId,owner.memberId,memberId]);
    await tx.query(`INSERT INTO conversation_key_versions(chat_id,key_version) VALUES($1,1)`,[directChatId]);
    await tx.query(`INSERT INTO device_key_envelopes(chat_id,key_version,device_id,sealed_key_envelope) VALUES($1,1,$2,'sealed-owner-direct-v1'),($1,1,$3,'sealed-mama-direct-v1')`,[directChatId,owner.deviceId,memberDeviceId]);
    await tx.query('COMMIT');
    return {...owner,memberId,memberDeviceId,familyChatId,directChatId};
  }catch(error){await tx.query('ROLLBACK');throw error;}finally{tx.release();}
}

beforeEach(reset);
afterAll(async()=>{await pool.end();await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await adminPool.end();});

describe('chat key rotation after access removal',()=>{
  it('blocks new messages until all remaining active devices receive the next key version',async()=>{
    const app=await buildApp({pool});
    try{
      const s=await seed();
      const headers={cookie:'fm_session=owner-token','x-csrf-token':'owner-csrf'};
      const revoked=await app.inject({method:'DELETE',url:`/v1/devices/${s.memberDeviceId}`,headers});
      expect(revoked.statusCode).toBe(204);

      const scheduled=await pool.query<{chat_id:string;from_key_version:number;to_key_version:number;reason:string;state:string}>(`SELECT chat_id,from_key_version,to_key_version,reason,state FROM chat_key_rotation_requests ORDER BY chat_id`);
      expect(scheduled.rows).toHaveLength(2);
      expect(scheduled.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({chat_id:s.familyChatId,from_key_version:1,to_key_version:2,reason:'device_revoked',state:'pending'}),
        expect.objectContaining({chat_id:s.directChatId,from_key_version:1,to_key_version:2,reason:'device_revoked',state:'pending'})
      ]));

      const pending=await app.inject({method:'GET',url:'/v1/key-rotations',headers:{cookie:'fm_session=owner-token'}});
      expect(pending.statusCode).toBe(200);
      const familyRotation=pending.json().items.find((x:{chatId:string})=>x.chatId===s.familyChatId);
      expect(familyRotation).toEqual(expect.objectContaining({fromKeyVersion:1,toKeyVersion:2,reason:'device_revoked'}));
      expect(familyRotation.recipientDevices.map((x:{deviceId:string})=>x.deviceId)).toEqual([s.deviceId]);

      const oldMessage=await app.inject({method:'POST',url:`/v1/chats/${s.familyChatId}/messages`,headers,payload:{messageId:'11111111-1111-4111-8111-111111111111',chatId:s.familyChatId,senderDeviceId:s.deviceId,keyVersion:1,nonce:'nonce-old',ciphertext:'cipher-old'}});
      expect(oldMessage.statusCode).toBe(409);
      expect(oldMessage.json()).toEqual({error:'key_rotation_required',toKeyVersion:2});

      const incomplete=await app.inject({method:'POST',url:`/v1/chats/${s.familyChatId}/key-rotation`,headers,payload:{toKeyVersion:2,envelopes:[]}});
      expect(incomplete.statusCode).toBe(400);
      expect(incomplete.json()).toEqual({error:'key_envelope_recipient_mismatch'});

      const completed=await app.inject({method:'POST',url:`/v1/chats/${s.familyChatId}/key-rotation`,headers,payload:{toKeyVersion:2,envelopes:[{deviceId:s.deviceId,sealedKeyEnvelope:'sealed-owner-family-v2'}]}});
      expect(completed.statusCode).toBe(201);
      const versions=await pool.query<{key_version:number}>(`SELECT key_version FROM conversation_key_versions WHERE chat_id=$1 ORDER BY key_version`,[s.familyChatId]);
      expect(versions.rows).toEqual([{key_version:1},{key_version:2}]);
      const request=await pool.query<{state:string;completed_at:Date|null}>(`SELECT state,completed_at FROM chat_key_rotation_requests WHERE chat_id=$1`,[s.familyChatId]);
      expect(request.rows[0]?.state).toBe('completed');
      expect(request.rows[0]?.completed_at).toBeInstanceOf(Date);

      const newMessage=await app.inject({method:'POST',url:`/v1/chats/${s.familyChatId}/messages`,headers,payload:{messageId:'22222222-2222-4222-8222-222222222222',chatId:s.familyChatId,senderDeviceId:s.deviceId,keyVersion:2,nonce:'nonce-new',ciphertext:'cipher-new'}});
      expect(newMessage.statusCode).toBe(201);
    }finally{await app.close();}
  });

  it('schedules rotations when a member is removed and excludes that member devices from recipients',async()=>{
    const app=await buildApp({pool});
    try{
      const s=await seed();
      const headers={cookie:'fm_session=owner-token','x-csrf-token':'owner-csrf'};
      const removed=await app.inject({method:'DELETE',url:`/v1/members/${s.memberId}`,headers});
      expect(removed.statusCode).toBe(204);
      const rotations=await app.inject({method:'GET',url:'/v1/key-rotations',headers:{cookie:'fm_session=owner-token'}});
      expect(rotations.statusCode).toBe(200);
      expect(rotations.json().items).toHaveLength(2);
      for(const item of rotations.json().items){
        expect(item.reason).toBe('member_removed');
        expect(item.recipientDevices.map((x:{deviceId:string})=>x.deviceId)).toEqual([s.deviceId]);
      }
    }finally{await app.close();}
  });
});
