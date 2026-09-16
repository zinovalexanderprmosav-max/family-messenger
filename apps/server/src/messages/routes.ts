import type { FastifyInstance } from 'fastify';
import { EncryptedMessageEnvelopeSchema } from '@family-messenger/protocol';
import type { DatabasePool } from '../db/pool.js';
import { requireSession } from '../auth/session.js';
import { requireCsrf } from '../auth/csrf.js';
import { insertMessageEnvelope, listMessageEnvelopesAfter } from './repository.js';
import type { RealtimeHub } from '../realtime/hub.js';

async function authorizeChat(pool:DatabasePool,input:{chatId:string;familyId:string;memberId:string;deviceId:string;keyVersion?:number}){
  const r=await pool.query<{key_version:number|null}>(`SELECT (SELECT max(key_version) FROM conversation_key_versions WHERE chat_id=c.id) key_version FROM chats c JOIN chat_members cm ON cm.chat_id=c.id WHERE c.id=$1 AND c.family_id=$2 AND cm.member_id=$3`,[input.chatId,input.familyId,input.memberId]);
  const row=r.rows[0]; if(!row) return null; if(input.keyVersion!==undefined&&row.key_version!==input.keyVersion) return {allowed:false,currentKeyVersion:row.key_version}; return {allowed:true,currentKeyVersion:row.key_version};
}

export async function registerMessageRoutes(app:FastifyInstance,pool:DatabasePool,hub:RealtimeHub){
  app.post<{Params:{chatId:string}}>('/v1/chats/:chatId/messages',async(request,reply)=>{
    const p=await requireSession(request,pool);requireCsrf(request,p);if(p.deviceStatus!=='active')return reply.code(403).send({error:'device_not_active'});
    const envelope=EncryptedMessageEnvelopeSchema.parse(request.body);
    if(envelope.chatId!==request.params.chatId||envelope.senderDeviceId!==p.deviceId)return reply.code(400).send({error:'message_identity_mismatch'});
    const auth=await authorizeChat(pool,{chatId:request.params.chatId,familyId:p.familyId,memberId:p.memberId,deviceId:p.deviceId,keyVersion:envelope.keyVersion});
    if(!auth)return reply.code(404).send({error:'chat_not_found'});if(!auth.allowed)return reply.code(409).send({error:'key_version_mismatch',currentKeyVersion:auth.currentKeyVersion});
    const tx=await pool.connect();try{
      await tx.query('BEGIN');
      const result=await insertMessageEnvelope(tx,envelope);
      if(result.kind==='conflict'){await tx.query('ROLLBACK');return reply.code(409).send({error:'message_id_conflict'});}
      await tx.query('COMMIT');
      if(result.kind==='inserted')hub.publish(p.familyId,{type:'reconcile.required',chatId:envelope.chatId,latestSequence:result.stored.sequence});
      return reply.code(result.kind==='inserted'?201:200).send(result.stored);
    }catch(error){await tx.query('ROLLBACK').catch(()=>{});throw error;}finally{tx.release();}
  });

  app.get<{Params:{chatId:string};Querystring:{after?:string;limit?:string}}>('/v1/chats/:chatId/messages',async(request,reply)=>{
    const p=await requireSession(request,pool);if(p.deviceStatus!=='active')return reply.code(403).send({error:'device_not_active'});
    const auth=await authorizeChat(pool,{chatId:request.params.chatId,familyId:p.familyId,memberId:p.memberId,deviceId:p.deviceId});if(!auth)return reply.code(404).send({error:'chat_not_found'});
    const after=/^\d+$/.test(request.query.after??'0')?request.query.after??'0':'0';const parsed=Number.parseInt(request.query.limit??'100',10);const limit=Math.max(1,Math.min(100,Number.isFinite(parsed)?parsed:100));
    const tx=await pool.connect();try{const items=await listMessageEnvelopesAfter(tx,request.params.chatId,after,limit);return {items,nextCursor:items.at(-1)?.sequence??after};}finally{tx.release();}
  });
}
