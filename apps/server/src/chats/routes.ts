import type { FastifyInstance } from 'fastify';
import { InitializeChatKeysRequest } from '@family-messenger/protocol';
import type { DatabasePool } from '../db/pool.js';
import { requireSession } from '../auth/session.js';
import { requireCsrf } from '../auth/csrf.js';
import { initializeDirectChatKeys,listChats,prepareDirectChat } from './repository.js';

export async function registerChatRoutes(app:FastifyInstance,pool:DatabasePool){
  app.get('/v1/chats',async(request,reply)=>{
    const principal=await requireSession(request,pool);
    if(principal.deviceStatus!=='active')return reply.code(403).send({error:'device_not_active'});
    const tx=await pool.connect();
    try{return {items:await listChats(tx,{familyId:principal.familyId,memberId:principal.memberId})};}
    finally{tx.release();}
  });

  app.post<{Params:{memberId:string}}>('/v1/direct-chats/:memberId/prepare',async(request,reply)=>{
    const principal=await requireSession(request,pool);
    requireCsrf(request,principal);
    if(principal.deviceStatus!=='active') return reply.code(403).send({error:'device_not_active'});

    const tx=await pool.connect();
    try{
      await tx.query('BEGIN');
      const prepared=await prepareDirectChat(tx,{familyId:principal.familyId,actorMemberId:principal.memberId,targetMemberId:request.params.memberId});
      await tx.query('COMMIT');
      const {created,...body}=prepared;
      return reply.code(created?201:200).send(body);
    }catch(error){
      await tx.query('ROLLBACK');
      throw error;
    }finally{
      tx.release();
    }
  });

  app.post<{Params:{chatId:string}}>('/v1/chats/:chatId/keys/initialize',async(request,reply)=>{
    const principal=await requireSession(request,pool);
    requireCsrf(request,principal);
    if(principal.deviceStatus!=='active') return reply.code(403).send({error:'device_not_active'});
    const input=InitializeChatKeysRequest.parse(request.body);

    const tx=await pool.connect();
    try{
      await tx.query('BEGIN');
      const result=await initializeDirectChatKeys(tx,{
        familyId:principal.familyId,
        actorMemberId:principal.memberId,
        chatId:request.params.chatId,
        keyVersion:input.keyVersion,
        envelopes:input.envelopes
      });
      await tx.query('COMMIT');
      return reply.code(201).send(result);
    }catch(error){
      await tx.query('ROLLBACK');
      throw error;
    }finally{
      tx.release();
    }
  });
}
