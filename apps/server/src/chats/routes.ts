import type { FastifyInstance } from 'fastify';
import type { DatabasePool } from '../db/pool.js';
import { requireSession } from '../auth/session.js';
import { requireCsrf } from '../auth/csrf.js';
import { prepareDirectChat } from './repository.js';

export async function registerChatRoutes(app:FastifyInstance,pool:DatabasePool){
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
}
