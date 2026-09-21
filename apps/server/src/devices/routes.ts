import type {FastifyInstance} from 'fastify';
import type {DatabasePool} from '../db/pool.js';
import {requireSession} from '../auth/session.js';
import {requireCsrf} from '../auth/csrf.js';
import type {RealtimeHub} from '../realtime/hub.js';
import {revokeDevice} from './repository.js';
import {Id} from '@family-messenger/protocol';
export async function registerDeviceRoutes(app:FastifyInstance,pool:DatabasePool,hub:RealtimeHub){
 app.post<{Params:{deviceId:string}}>('/v1/family/devices/:deviceId/revoke',async(req,reply)=>{
  const p=await requireSession(req,pool);requireCsrf(req,p);const deviceId=Id.parse(req.params.deviceId);
  const tx=await pool.connect();try{
   await tx.query('BEGIN');await revokeDevice(tx,p,deviceId);await tx.query('COMMIT');
  }catch(e){await tx.query('ROLLBACK');throw e;}finally{tx.release();}
  hub.disconnectDevice(deviceId,1008,'revoked');return reply.code(204).send();
 });
}
