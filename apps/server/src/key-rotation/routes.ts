import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {DatabasePool} from '../db/pool.js';
import {requireSession} from '../auth/session.js';
import {requireCsrf} from '../auth/csrf.js';
import {appendAuditEvent} from '../audit/repository.js';
import {assertActiveActor,fail,lockFamily} from '../families/access.js';

const CompleteRotationRequest=z.object({
  fromKeyVersion:z.number().int().positive(),
  nextKeyVersion:z.number().int().positive(),
  envelopes:z.array(z.object({
    deviceId:z.string().uuid(),
    sealedKeyEnvelope:z.string().min(1)
  })).min(1)
});

type RotationRow={
  from_key_version:number;
  status:'required'|'completed';
};

async function authorizeRotationChat(
  tx:PoolClient,
  input:{chatId:string;familyId:string;memberId:string;deviceId:string}
){
  const chat=(await tx.query<{write_disabled_at:Date|null}>(`
    SELECT c.write_disabled_at
    FROM chats c
    JOIN chat_members cm ON cm.chat_id=c.id
    WHERE c.id=$1 AND c.family_id=$2 AND cm.member_id=$3
    FOR UPDATE OF c
  `,[input.chatId,input.familyId,input.memberId])).rows[0];
  if(!chat)fail('chat_not_found',404);
  if(chat.write_disabled_at)fail('chat_read_only',409);
}

async function requiredDevices(
  tx:PoolClient,
  input:{chatId:string;familyId:string}
){
  const rows=await tx.query<{device_id:string;member_id:string;encryption_public_key:string}>(`
    SELECT d.id AS device_id,d.member_id,d.encryption_public_key
    FROM chat_members cm
    JOIN family_memberships fm
      ON fm.member_id=cm.member_id
     AND fm.family_id=$2
     AND fm.status='active'
    JOIN devices d
      ON d.family_id=$2
     AND d.member_id=cm.member_id
     AND d.status='active'
    WHERE cm.chat_id=$1
    ORDER BY d.id
  `,[input.chatId,input.familyId]);
  return rows.rows;
}

async function assertTrustedActor(
  tx:PoolClient,
  input:{chatId:string;deviceId:string;fromKeyVersion:number}
){
  const trusted=await tx.query(`
    SELECT 1
    FROM device_key_envelopes
    WHERE chat_id=$1 AND key_version=$2 AND device_id=$3
    LIMIT 1
  `,[input.chatId,input.fromKeyVersion,input.deviceId]);
  if(!trusted.rowCount)fail('trusted_device_required',403);
}

export async function registerKeyRotationRoutes(app:FastifyInstance,pool:DatabasePool){
  app.get<{Params:{chatId:string}}>('/v1/chats/:chatId/key-rotation',async(request,reply)=>{
    const principal=await requireSession(request,pool);
    if(principal.deviceStatus!=='active')return reply.code(403).send({error:'device_not_active'});
    const tx=await pool.connect();
    try{
      await tx.query('BEGIN');
      await lockFamily(tx,principal.familyId);
      await assertActiveActor(tx,principal);
      await authorizeRotationChat(tx,{chatId:request.params.chatId,familyId:principal.familyId,memberId:principal.memberId,deviceId:principal.deviceId});
      const rotation=(await tx.query<RotationRow>(`
        SELECT from_key_version,status
        FROM chat_key_rotations
        WHERE chat_id=$1 AND status='required'
        ORDER BY from_key_version DESC
        LIMIT 1
        FOR UPDATE
      `,[request.params.chatId])).rows[0];
      if(!rotation){
        await tx.query('COMMIT');
        return {status:'not_required' as const};
      }
      await assertTrustedActor(tx,{chatId:request.params.chatId,deviceId:principal.deviceId,fromKeyVersion:rotation.from_key_version});
      const devices=await requiredDevices(tx,{chatId:request.params.chatId,familyId:principal.familyId});
      if(devices.length===0)fail('device_key_set_changed',409);
      await tx.query('COMMIT');
      return {
        status:'required' as const,
        chatId:request.params.chatId,
        fromKeyVersion:rotation.from_key_version,
        nextKeyVersion:rotation.from_key_version+1,
        devices:devices.map(row=>({
          deviceId:row.device_id,
          memberId:row.member_id,
          encryptionPublicKey:row.encryption_public_key
        }))
      };
    }catch(error){
      await tx.query('ROLLBACK');
      throw error;
    }finally{tx.release();}
  });

  app.post<{Params:{chatId:string}}>('/v1/chats/:chatId/key-rotation',async(request,reply)=>{
    const principal=await requireSession(request,pool);
    requireCsrf(request,principal);
    if(principal.deviceStatus!=='active')return reply.code(403).send({error:'device_not_active'});
    const input=CompleteRotationRequest.parse(request.body);
    const tx=await pool.connect();
    try{
      await tx.query('BEGIN');
      await lockFamily(tx,principal.familyId);
      await assertActiveActor(tx,principal);
      await authorizeRotationChat(tx,{chatId:request.params.chatId,familyId:principal.familyId,memberId:principal.memberId,deviceId:principal.deviceId});
      const rotation=(await tx.query<RotationRow>(`
        SELECT from_key_version,status
        FROM chat_key_rotations
        WHERE chat_id=$1 AND status='required'
        ORDER BY from_key_version DESC
        LIMIT 1
        FOR UPDATE
      `,[request.params.chatId])).rows[0];
      if(!rotation)fail('key_rotation_not_required',409);
      if(input.fromKeyVersion!==rotation.from_key_version||input.nextKeyVersion!==rotation.from_key_version+1)fail('key_rotation_stale',409);
      await assertTrustedActor(tx,{chatId:request.params.chatId,deviceId:principal.deviceId,fromKeyVersion:rotation.from_key_version});

      const devices=await requiredDevices(tx,{chatId:request.params.chatId,familyId:principal.familyId});
      const expected=devices.map(row=>row.device_id).sort();
      const provided=input.envelopes.map(item=>item.deviceId).sort();
      const exact=expected.length===provided.length
        && new Set(provided).size===provided.length
        && expected.every((id,index)=>id===provided[index]);
      if(!exact)fail('device_key_set_changed',409);

      await tx.query(
        'INSERT INTO conversation_key_versions(chat_id,key_version) VALUES($1,$2)',
        [request.params.chatId,input.nextKeyVersion]
      );
      for(const envelope of input.envelopes){
        await tx.query(`
          INSERT INTO device_key_envelopes(chat_id,key_version,device_id,sealed_key_envelope)
          VALUES($1,$2,$3,$4)
        `,[request.params.chatId,input.nextKeyVersion,envelope.deviceId,envelope.sealedKeyEnvelope]);
      }
      await tx.query(`
        UPDATE chat_key_rotations
        SET status='completed',completed_at=now()
        WHERE chat_id=$1 AND from_key_version=$2 AND status='required'
      `,[request.params.chatId,rotation.from_key_version]);
      await appendAuditEvent(tx,{
        familyId:principal.familyId,
        actorDeviceId:principal.deviceId,
        eventType:'chat.key.rotated',
        details:{chatId:request.params.chatId,keyVersion:input.nextKeyVersion}
      });
      await tx.query('COMMIT');
      return reply.code(204).send();
    }catch(error){
      await tx.query('ROLLBACK');
      throw error;
    }finally{tx.release();}
  });
}
