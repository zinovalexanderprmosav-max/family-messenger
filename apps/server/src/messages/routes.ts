import type {PoolClient} from 'pg';
import {assertActiveActor,lockFamily,fail} from '../families/access.js';
import type { FastifyInstance } from 'fastify';
import { EncryptedMessageEnvelopeSchema } from '@family-messenger/protocol';
import type { DatabasePool } from '../db/pool.js';
import { requireSession } from '../auth/session.js';
import { requireCsrf } from '../auth/csrf.js';
import { insertMessageEnvelope, listMessageEnvelopesAfter } from './repository.js';
import type { RealtimeHub } from '../realtime/hub.js';

async function authorizeChat(pool:DatabasePool|PoolClient,input:{chatId:string;familyId:string;memberId:string;deviceId:string;keyVersion?:number}){
  const r=await pool.query<{key_version:number|null;write_disabled_at:Date|null}>(`SELECT c.write_disabled_at,(SELECT max(key_version) FROM conversation_key_versions WHERE chat_id=c.id) key_version FROM chats c JOIN chat_members cm ON cm.chat_id=c.id WHERE c.id=$1 AND c.family_id=$2 AND cm.member_id=$3`,[input.chatId,input.familyId,input.memberId]);
  const row=r.rows[0]; if(!row) return null; if(input.keyVersion!==undefined&&row.key_version!==input.keyVersion) return {allowed:false,currentKeyVersion:row.key_version}; return {allowed:true,currentKeyVersion:row.key_version,readOnly:row.write_disabled_at!==null};
}

export async function registerMessageRoutes(app:FastifyInstance,pool:DatabasePool,hub:RealtimeHub){
  app.post<{Params:{chatId:string}}>('/v1/chats/:chatId/messages',async(request,reply)=>{
    const p=await requireSession(request,pool);requireCsrf(request,p);if(p.deviceStatus!=='active')return reply.code(403).send({error:'device_not_active'});
    const envelope=EncryptedMessageEnvelopeSchema.parse(request.body);
    if(envelope.chatId!==request.params.chatId||envelope.senderDeviceId!==p.deviceId)return reply.code(400).send({error:'message_identity_mismatch'});
    const tx=await pool.connect();try{
      await tx.query('BEGIN');await lockFamily(tx,p.familyId);await assertActiveActor(tx,p);
      const auth=await authorizeChat(tx,{chatId:envelope.chatId,familyId:p.familyId,memberId:p.memberId,deviceId:p.deviceId});
      if(!auth)fail('chat_not_found',404);if(auth.readOnly)fail('chat_read_only',409);
      if(auth.currentKeyVersion!==envelope.keyVersion){await tx.query('ROLLBACK');return reply.code(409).send({error:'key_version_mismatch',currentKeyVersion:auth.currentKeyVersion});}
      const stored=await insertMessageEnvelope(tx,envelope);await tx.query('COMMIT');hub.publish(p.familyId,{type:'reconcile.required',chatId:envelope.chatId,latestSequence:stored.sequence});return reply.code(stored.inserted?201:200).send({...envelope,sequence:stored.sequence,acceptedAt:stored.acceptedAt});
    }catch(error){await tx.query('ROLLBACK');throw error;}finally{tx.release();}
  });

  app.get<{Params:{chatId:string};Querystring:{after?:string;limit?:string}}>('/v1/chats/:chatId/messages',async(request,reply)=>{
    const p=await requireSession(request,pool);if(p.deviceStatus!=='active')return reply.code(403).send({error:'device_not_active'});
    const auth=await authorizeChat(pool,{chatId:request.params.chatId,familyId:p.familyId,memberId:p.memberId,deviceId:p.deviceId});if(!auth)return reply.code(404).send({error:'chat_not_found'});
    const after=/^\d+$/.test(request.query.after??'0')?request.query.after??'0':'0';const parsed=Number.parseInt(request.query.limit??'100',10);const limit=Math.max(1,Math.min(100,Number.isFinite(parsed)?parsed:100));
    const tx=await pool.connect();try{const items=await listMessageEnvelopesAfter(tx,request.params.chatId,after,limit);return {items,nextCursor:items.at(-1)?.sequence??after};}finally{tx.release();}
  });
}
