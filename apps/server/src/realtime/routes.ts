import type {FastifyInstance} from 'fastify';
import type {DatabasePool} from '../db/pool.js';
import {requireSession} from '../auth/session.js';
import {lockFamily,assertActiveActor} from '../families/access.js';
import type {RealtimeHub} from './hub.js';
export async function registerRealtimeRoutes(app:FastifyInstance,pool:DatabasePool,hub:RealtimeHub){
 app.get('/v1/ws',{websocket:true},async(socket,request)=>{
  let unregister=()=>{};
  socket.on('close',()=>unregister());
  try{
   const p=await requireSession(request,pool),tx=await pool.connect();
   try{await tx.query('BEGIN');await lockFamily(tx,p.familyId);await assertActiveActor(tx,p);
    if(socket.readyState===1)unregister=hub.register(p,socket);
    await tx.query('COMMIT');
   }catch(e){await tx.query('ROLLBACK');unregister();throw e;}finally{tx.release();}
  }catch{socket.close(1008,'unauthorized');}
 });
}
