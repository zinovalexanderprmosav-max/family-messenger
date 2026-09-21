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

describe('device approval key version',()=>{
  it('rejects stale envelopes and activates only on the current chat key version',async()=>{
    const f=await seed(pool),chatId=randomUUID();
    await pool.query(`INSERT INTO chats(id,family_id,kind) VALUES($1,$2,'family')`,[chatId,f.family]);
    await pool.query(`INSERT INTO chat_members(chat_id,member_id) SELECT $1,member_id FROM family_memberships WHERE family_id=$2`,[chatId,f.family]);
    await pool.query(`INSERT INTO conversation_key_versions(chat_id,key_version) VALUES($1,1),($1,2)`,[chatId]);
    await pool.query(`UPDATE devices SET status='pending_key' WHERE id=$1`,[f.other.device]);
    const headers={cookie:`fm_session=${f.primary.token}`,'x-csrf-token':f.primary.csrf};

    const stale=await app.inject({
      method:'POST',url:`/v1/devices/${f.other.device}/approve`,headers,
      payload:{chatId,keyVersion:1,sealedKeyEnvelope:'stale-envelope'}
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({error:'key_version_stale'});
    expect((await pool.query('SELECT status FROM devices WHERE id=$1',[f.other.device])).rows[0]?.status).toBe('pending_key');

    const current=await app.inject({
      method:'POST',url:`/v1/devices/${f.other.device}/approve`,headers,
      payload:{chatId,keyVersion:2,sealedKeyEnvelope:'current-envelope'}
    });
    expect(current.statusCode).toBe(204);
    expect((await pool.query('SELECT status FROM devices WHERE id=$1',[f.other.device])).rows[0]?.status).toBe('active');
    expect((await pool.query('SELECT key_version,sealed_key_envelope FROM device_key_envelopes WHERE device_id=$1',[f.other.device])).rows)
      .toEqual([{key_version:2,sealed_key_envelope:'current-envelope'}]);
  });
});
