import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {Pool} from 'pg';
import type {FastifyInstance} from 'fastify';
import {buildApp} from '../src/app.js';
import {seed} from './helpers/family.js';

const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl)throw new Error('DATABASE_URL_required_for_message_mutation_tests');
const pool=new Pool({connectionString:databaseUrl});
let app:FastifyInstance;

beforeAll(async()=>{app=await buildApp({pool});});
afterAll(async()=>{await app.close();await pool.end();});
beforeEach(async()=>{
  await pool.query(`TRUNCATE audit_events,auth_challenges,sessions,message_envelopes,device_key_envelopes,conversation_key_versions,chat_members,chats,invitations,devices,family_memberships,members,families RESTART IDENTITY CASCADE`);
});

async function seedChat(){
  const actors=await seed(pool);
  const chat=(await pool.query<{id:string}>(`INSERT INTO chats(family_id,kind) VALUES($1,'family') RETURNING id`,[actors.family])).rows[0]!;
  await pool.query(`INSERT INTO chat_members(chat_id,member_id) SELECT $1,member_id FROM family_memberships WHERE family_id=$2 AND status='active'`,[chat.id,actors.family]);
  await pool.query(`INSERT INTO conversation_key_versions(chat_id,key_version) VALUES($1,1)`,[chat.id]);
  const target='77777777-7777-4777-8777-777777777777';
  await pool.query(
    `INSERT INTO message_envelopes(message_id,chat_id,sender_device_id,key_version,nonce,ciphertext) VALUES($1,$2,$3,1,'nonce','cipher')`,
    [target,chat.id,actors.primary.device]
  );
  return {...actors,chatId:chat.id,target};
}

describe('message mutation authorization',()=>{
  it('allows the original member to edit a message',async()=>{
    const s=await seedChat();
    const response=await app.inject({
      method:'POST',url:`/v1/chats/${s.chatId}/messages`,
      headers:{cookie:`fm_session=${s.primary.token}`,'x-csrf-token':s.primary.csrf},
      payload:{
        messageId:'88888888-8888-4888-8888-888888888888',chatId:s.chatId,senderDeviceId:s.primary.device,
        keyVersion:1,nonce:'n',ciphertext:'c',mutation:{kind:'edit',targetMessageId:s.target}
      }
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({mutation:{kind:'edit',targetMessageId:s.target}});
  });

  it('allows a family member to react to another member message',async()=>{
    const s=await seedChat();
    const response=await app.inject({
      method:'POST',url:`/v1/chats/${s.chatId}/messages`,
      headers:{cookie:`fm_session=${s.member.token}`,'x-csrf-token':s.member.csrf},
      payload:{
        messageId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',chatId:s.chatId,senderDeviceId:s.member.device,
        keyVersion:1,nonce:'n',ciphertext:'c',mutation:{kind:'reaction',targetMessageId:s.target}
      }
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({mutation:{kind:'reaction',targetMessageId:s.target}});
  });

  it('rejects editing another member message',async()=>{
    const s=await seedChat();
    const response=await app.inject({
      method:'POST',url:`/v1/chats/${s.chatId}/messages`,
      headers:{cookie:`fm_session=${s.member.token}`,'x-csrf-token':s.member.csrf},
      payload:{
        messageId:'99999999-9999-4999-8999-999999999999',chatId:s.chatId,senderDeviceId:s.member.device,
        keyVersion:1,nonce:'n',ciphertext:'c',mutation:{kind:'delete',targetMessageId:s.target}
      }
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({error:'message_not_owned'});
  });
});
