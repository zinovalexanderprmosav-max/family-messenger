import {assertActiveActor,lockFamily} from '../families/access.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DatabasePool } from '../db/pool.js';
import { requireSession } from '../auth/session.js';
import { requireCsrf } from '../auth/csrf.js';
import { appendAuditEvent } from '../audit/repository.js';

const CreateDirectChatRequest=z.object({
  envelopes:z.array(z.object({deviceId:z.string().uuid(),sealedKeyEnvelope:z.string().min(1)})).min(1)
});

async function activePair(pool:DatabasePool,familyId:string,memberIds:string[]){
  return pool.query<{member_id:string}>(`
    SELECT member_id
    FROM family_memberships
    WHERE family_id=$1 AND member_id=ANY($2::uuid[]) AND status='active'
  `,[familyId,memberIds]);
}

async function activeDevices(pool:DatabasePool,familyId:string,memberIds:string[]){
  return pool.query<{id:string;member_id:string;encryption_public_key:string}>(`
    SELECT id,member_id,encryption_public_key
    FROM devices
    WHERE family_id=$1 AND member_id=ANY($2::uuid[]) AND status='active'
    ORDER BY created_at,id
  `,[familyId,memberIds]);
}

export async function registerDirectChatRoutes(app:FastifyInstance,pool:DatabasePool){
  app.get<{Params:{memberId:string}}>('/v1/members/:memberId/direct-chat',async(request,reply)=>{
    const principal=await requireSession(request,pool);
    if(principal.deviceStatus!=='active') return reply.code(403).send({error:'device_not_active'});
    const memberIds=[principal.memberId,request.params.memberId];
    const members=await activePair(pool,principal.familyId,memberIds);


    const existing=await pool.query<{id:string;key_version:number;write_disabled_at:Date|null}>(`
      SELECT c.id,c.write_disabled_at,(SELECT max(key_version)::int FROM conversation_key_versions WHERE chat_id=c.id) key_version
      FROM chats c
      WHERE c.family_id=$1 AND c.kind='direct'
        AND (SELECT count(*) FROM chat_members cm WHERE cm.chat_id=c.id)=2
        AND EXISTS(SELECT 1 FROM chat_members cm WHERE cm.chat_id=c.id AND cm.member_id=$2)
        AND EXISTS(SELECT 1 FROM chat_members cm WHERE cm.chat_id=c.id AND cm.member_id=$3)
      LIMIT 1
    `,[principal.familyId,principal.memberId,request.params.memberId]);
    if(existing.rows[0]){
      const envelope=await pool.query<{sealed_key_envelope:string}>(`
        SELECT sealed_key_envelope
        FROM device_key_envelopes
        WHERE chat_id=$1 AND key_version=$2 AND device_id=$3
        LIMIT 1
      `,[existing.rows[0].id,existing.rows[0].key_version,principal.deviceId]);
      if(!envelope.rows[0]) return reply.code(409).send({error:'chat_key_envelope_not_found'});
      return {status:'ready' as const,readOnly:existing.rows[0].write_disabled_at!==null,chatId:existing.rows[0].id,keyVersion:existing.rows[0].key_version,sealedKeyEnvelope:envelope.rows[0].sealed_key_envelope};
    }

    if(members.rowCount!==2) return reply.code(404).send({error:'member_not_found'});
    const devices=await activeDevices(pool,principal.familyId,memberIds);
    return {
      status:'needs_key' as const,
      devices:devices.rows.map(row=>({deviceId:row.id,memberId:row.member_id,encryptionPublicKey:row.encryption_public_key}))
    };
  });

  app.post<{Params:{memberId:string}}>('/v1/members/:memberId/direct-chat',async(request,reply)=>{
    const principal=await requireSession(request,pool);
    requireCsrf(request,principal);
    if(principal.deviceStatus!=='active') return reply.code(403).send({error:'device_not_active'});
    const input=CreateDirectChatRequest.parse(request.body);
    const memberIds=[principal.memberId,request.params.memberId];
    const tx=await pool.connect();
    try{
      await tx.query('BEGIN');
      await lockFamily(tx,principal.familyId);await assertActiveActor(tx,principal);
      const members=await tx.query<{member_id:string}>(`
        SELECT member_id FROM family_memberships
        WHERE family_id=$1 AND member_id=ANY($2::uuid[]) AND status='active'
      `,[principal.familyId,memberIds]);
      if(members.rowCount!==2) throw Object.assign(new Error('member_not_found'),{statusCode:404});

      const existing=await tx.query<{id:string;key_version:number;write_disabled_at:Date|null}>(`
        SELECT c.id,c.write_disabled_at,(SELECT max(key_version)::int FROM conversation_key_versions WHERE chat_id=c.id) key_version
        FROM chats c
        WHERE c.family_id=$1 AND c.kind='direct'
          AND (SELECT count(*) FROM chat_members cm WHERE cm.chat_id=c.id)=2
          AND EXISTS(SELECT 1 FROM chat_members cm WHERE cm.chat_id=c.id AND cm.member_id=$2)
          AND EXISTS(SELECT 1 FROM chat_members cm WHERE cm.chat_id=c.id AND cm.member_id=$3)
        LIMIT 1
      `,[principal.familyId,principal.memberId,request.params.memberId]);
      if(existing.rows[0]){
        const envelope=await tx.query<{sealed_key_envelope:string}>(`
          SELECT sealed_key_envelope
          FROM device_key_envelopes
          WHERE chat_id=$1 AND key_version=$2 AND device_id=$3
          LIMIT 1
        `,[existing.rows[0].id,existing.rows[0].key_version,principal.deviceId]);
        if(!envelope.rows[0]) throw Object.assign(new Error('chat_key_envelope_not_found'),{statusCode:409});
        await tx.query('COMMIT');
        return reply.code(200).send({status:'ready',chatId:existing.rows[0].id,keyVersion:existing.rows[0].key_version,sealedKeyEnvelope:envelope.rows[0].sealed_key_envelope});
      }

      const devices=await tx.query<{id:string}>(`
        SELECT id FROM devices
        WHERE family_id=$1 AND member_id=ANY($2::uuid[]) AND status='active'
        ORDER BY id
      `,[principal.familyId,memberIds]);
      const expectedIds=devices.rows.map(row=>row.id).sort();
      const providedIds=input.envelopes.map(item=>item.deviceId).sort();
      const exactSet=expectedIds.length===providedIds.length&&expectedIds.every((id,index)=>id===providedIds[index]);
      if(!exactSet) throw Object.assign(new Error('device_key_set_changed'),{statusCode:409});
      const currentEnvelope=input.envelopes.find(item=>item.deviceId===principal.deviceId);
      if(!currentEnvelope) throw Object.assign(new Error('device_key_set_changed'),{statusCode:409});

      const chat=(await tx.query<{id:string}>(`INSERT INTO chats(family_id,kind) VALUES($1,'direct') RETURNING id`,[principal.familyId])).rows[0]!;
      await tx.query(`INSERT INTO chat_members(chat_id,member_id) VALUES($1,$2),($1,$3)`,[chat.id,principal.memberId,request.params.memberId]);
      await tx.query(`INSERT INTO conversation_key_versions(chat_id,key_version) VALUES($1,1)`,[chat.id]);
      for(const envelope of input.envelopes){
        await tx.query(`INSERT INTO device_key_envelopes(chat_id,key_version,device_id,sealed_key_envelope) VALUES($1,1,$2,$3)`,[chat.id,envelope.deviceId,envelope.sealedKeyEnvelope]);
      }
      await appendAuditEvent(tx,{familyId:principal.familyId,actorDeviceId:principal.deviceId,eventType:'direct_chat.created',details:{chatId:chat.id,memberId:request.params.memberId}});
      await tx.query('COMMIT');
      return reply.code(201).send({status:'ready',chatId:chat.id,keyVersion:1,sealedKeyEnvelope:currentEnvelope.sealedKeyEnvelope});
    }catch(error){
      await tx.query('ROLLBACK');
      throw error;
    }finally{tx.release();}
  });
}
