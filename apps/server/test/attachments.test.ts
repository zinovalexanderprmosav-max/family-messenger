import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {Pool} from 'pg';
import type {FastifyInstance} from 'fastify';
import {buildApp} from '../src/app.js';
import {seed} from './helpers/family.js';

const pool=new Pool({connectionString:process.env.DATABASE_URL});
let app:FastifyInstance;
beforeAll(async()=>{app=await buildApp({pool});});
afterAll(async()=>{await app.close();await pool.end();});
beforeEach(async()=>{await pool.query('TRUNCATE families,members CASCADE');});

const headers=(a:{token:string;csrf:string})=>({cookie:`fm_session=${a.token}`,'x-csrf-token':a.csrf});

async function setup(){
  const f=await seed(pool),chatId=randomUUID();
  await pool.query(`INSERT INTO chats(id,family_id,kind) VALUES($1,$2,'family')`,[chatId,f.family]);
  await pool.query(`INSERT INTO chat_members(chat_id,member_id) SELECT $1,member_id FROM family_memberships WHERE family_id=$2`,[chatId,f.family]);
  await pool.query(`INSERT INTO conversation_key_versions(chat_id,key_version) VALUES($1,1)`,[chatId]);
  const envelope={attachmentId:randomUUID(),chatId,nonce:Buffer.from('nonce').toString('base64'),ciphertext:Buffer.from('encrypted bytes').toString('base64')};
  return {...f,chatId,envelope};
}

describe('encrypted attachments',()=>{
  it('stores only opaque encrypted bytes and returns them to an active chat member',async()=>{
    const f=await setup();
    const uploaded=await app.inject({method:'POST',url:`/v1/chats/${f.chatId}/attachments`,headers:headers(f.member),payload:f.envelope});
    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json()).toMatchObject({attachmentId:f.envelope.attachmentId,chatId:f.chatId});
    const row=(await pool.query('SELECT nonce,ciphertext,ciphertext_bytes FROM message_attachments WHERE attachment_id=$1',[f.envelope.attachmentId])).rows[0];
    expect(row.nonce).toBe(f.envelope.nonce);expect(row.ciphertext).toBe(f.envelope.ciphertext);
    expect(JSON.stringify(row)).not.toContain('filename');

    const downloaded=await app.inject({method:'GET',url:`/v1/attachments/${f.envelope.attachmentId}`,headers:{cookie:`fm_session=${f.primary.token}`}});
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.json()).toMatchObject(f.envelope);
  });

  it('is idempotent for the same ciphertext and rejects conflicting attachment ids',async()=>{
    const f=await setup();
    expect((await app.inject({method:'POST',url:`/v1/chats/${f.chatId}/attachments`,headers:headers(f.member),payload:f.envelope})).statusCode).toBe(201);
    expect((await app.inject({method:'POST',url:`/v1/chats/${f.chatId}/attachments`,headers:headers(f.member),payload:f.envelope})).statusCode).toBe(200);
    const conflict=await app.inject({method:'POST',url:`/v1/chats/${f.chatId}/attachments`,headers:headers(f.member),payload:{...f.envelope,ciphertext:Buffer.from('different').toString('base64')}});
    expect(conflict.statusCode).toBe(409);expect(conflict.json()).toEqual({error:'attachment_id_conflict'});
    expect((await pool.query('SELECT * FROM message_attachments WHERE attachment_id=$1',[f.envelope.attachmentId])).rowCount).toBe(1);
  });

  it('does not reveal an attachment to another family',async()=>{
    const f=await setup(),other=await seed(pool);
    await app.inject({method:'POST',url:`/v1/chats/${f.chatId}/attachments`,headers:headers(f.member),payload:f.envelope});
    const r=await app.inject({method:'GET',url:`/v1/attachments/${f.envelope.attachmentId}`,headers:{cookie:`fm_session=${other.member.token}`}});
    expect(r.statusCode).toBe(404);expect(r.json()).toEqual({error:'attachment_not_found'});
  });

  it('blocks uploads to read-only chats and while key rotation is pending',async()=>{
    const readOnly=await setup();
    await pool.query(`UPDATE chats SET write_disabled_at=now(),write_disabled_reason='member_removed' WHERE id=$1`,[readOnly.chatId]);
    const ro=await app.inject({method:'POST',url:`/v1/chats/${readOnly.chatId}/attachments`,headers:headers(readOnly.member),payload:readOnly.envelope});
    expect(ro.statusCode).toBe(409);expect(ro.json()).toEqual({error:'chat_read_only'});

    const rotating=await setup();
    await pool.query(`INSERT INTO chat_key_rotations(chat_id,from_key_version,status) VALUES($1,1,'required')`,[rotating.chatId]);
    const rr=await app.inject({method:'POST',url:`/v1/chats/${rotating.chatId}/attachments`,headers:headers(rotating.member),payload:rotating.envelope});
    expect(rr.statusCode).toBe(409);expect(rr.json()).toEqual({error:'key_rotation_required'});
  });
});
