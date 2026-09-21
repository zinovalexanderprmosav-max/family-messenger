import type {FastifyInstance} from 'fastify';
import type {DatabasePool} from '../db/pool.js';
import {requireSession} from '../auth/session.js';
import {requireCsrf} from '../auth/csrf.js';
import {Id} from '@family-messenger/protocol';
import type {RealtimeHub} from '../realtime/hub.js';
import {removeFamilyMember} from './repository.js';
export async function registerMemberRoutes(app:FastifyInstance,pool:DatabasePool,hub:RealtimeHub){
 app.post<{Params:{memberId:string}}>('/v1/family/members/:memberId/remove',async(req,reply)=>{
  const p=await requireSession(req,pool);requireCsrf(req,p);const memberId=Id.parse(req.params.memberId),tx=await pool.connect();let ids:string[];
  try{await tx.query('BEGIN');ids=await removeFamilyMember(tx,p,memberId);await tx.query('COMMIT');}catch(e){await tx.query('ROLLBACK');throw e;}finally{tx.release();}
  for(const id of ids)hub.disconnectDevice(id,1008,'revoked');return reply.code(204).send();
 });
}
