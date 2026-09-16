import type { FastifyInstance } from 'fastify';
import type { DatabasePool } from '../db/pool.js';
import { requireSession } from '../auth/session.js';
import type { RealtimeHub } from './hub.js';

export async function registerRealtimeRoutes(app:FastifyInstance,pool:DatabasePool,hub:RealtimeHub){
  app.get('/v1/ws',{websocket:true},async(socket,request)=>{
    try{const p=await requireSession(request,pool);const unregister=hub.register(p.familyId,socket);socket.on('close',unregister);}catch{socket.close(1008,'unauthorized');}
  });
}
