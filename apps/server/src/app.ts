import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { createPool, type DatabasePool } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { loadConfig } from './config.js';
import { registerDeviceAuthRoutes } from './auth/device-auth.js';
import { registerFamilyRoutes } from './families/routes.js';
import { registerInvitationRoutes } from './invitations/routes.js';
import { registerKeyRoutes } from './keys/routes.js';
import { registerMessageRoutes } from './messages/routes.js';
import { RealtimeHub } from './realtime/hub.js';
import { registerRealtimeRoutes } from './realtime/routes.js';

export async function buildApp(options:{skipDatabase?:boolean;pool?:DatabasePool}={}){
  const config=loadConfig(process.env);
  const app=Fastify({logger:true});
  await app.register(cookie);
  await app.register(helmet,{contentSecurityPolicy:false});
  await app.register(rateLimit,{max:120,timeWindow:'1 minute'});
  await app.register(websocket);
  app.get('/health',async()=>({status:'ok' as const,service:'family-messenger-server' as const}));
  if(!options.skipDatabase){
    const pool=options.pool??createPool(config.databaseUrl); if(!options.pool)app.addHook('onClose',async()=>{await pool.end();});
    await migrate(pool);
    const hub=new RealtimeHub();
    await registerDeviceAuthRoutes(app,pool,config.nodeEnv==='production');
    await registerFamilyRoutes(app,pool,config.nodeEnv==='production');
    await registerInvitationRoutes(app,pool,config.nodeEnv==='production');
    await registerKeyRoutes(app,pool);
    await registerMessageRoutes(app,pool,hub);
    await registerRealtimeRoutes(app,pool,hub);
  }
  app.setErrorHandler((error,_request,reply)=>{const typed=error as Error&{statusCode?:number};const status=typed.statusCode??500;reply.code(status).send({error:status>=500?'internal_error':typed.message});});
  return app;
}
