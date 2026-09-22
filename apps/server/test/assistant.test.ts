import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {Pool} from 'pg';
import type {FastifyInstance} from 'fastify';
import {buildApp} from '../src/app.js';
import {seed} from './helpers/family.js';

const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl)throw new Error('DATABASE_URL_required_for_assistant_tests');
const pool=new Pool({connectionString:databaseUrl});
let app:FastifyInstance;

beforeAll(async()=>{
  delete process.env.OPENROUTER_API_KEY;
  app=await buildApp({pool});
});
afterAll(async()=>{await app.close();await pool.end();});
beforeEach(async()=>{
  await pool.query(`TRUNCATE audit_events,auth_challenges,sessions,message_envelopes,device_key_envelopes,conversation_key_versions,chat_members,chats,invitations,devices,family_memberships,members,families RESTART IDENTITY CASCADE`);
});

describe('assistant API',()=>{
  it('reports configured state without exposing secrets',async()=>{
    const actors=await seed(pool);
    const response=await app.inject({
      method:'GET',url:'/v1/assistant/status',
      headers:{cookie:`fm_session=${actors.primary.token}`}
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      providers:{
        openrouter:{configured:false,model:'openrouter/free'}
      }
    });
    expect(response.body).not.toContain('API_KEY');
  });

  it('returns a safe error when no assistant provider is configured',async()=>{
    const actors=await seed(pool);
    const response=await app.inject({
      method:'POST',url:'/v1/assistant/chat',
      headers:{cookie:`fm_session=${actors.primary.token}`,'x-csrf-token':actors.primary.csrf},
      payload:{messages:[{role:'user',content:'Привет'}]}
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({error:'openrouter_not_configured'});
  });
});
