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

describe('device management listing',()=>{
  it('shows ordinary members only their devices and marks the current one',async()=>{
    const f=await seed(pool);
    const ownSecond=(await pool.query<{id:string}>(`
      INSERT INTO devices(family_id,member_id,device_name,encryption_public_key,signing_public_key,status)
      VALUES($1,$2,'Tablet',$3,$4,'pending_key') RETURNING id
    `,[f.family,f.member.id,crypto.randomUUID(),crypto.randomUUID()])).rows[0]!.id;
    const r=await app.inject({method:'GET',url:'/v1/family/devices',headers:{cookie:`fm_session=${f.member.token}`}});
    expect(r.statusCode).toBe(200);
    expect(r.json().items.map((d:{deviceId:string})=>d.deviceId).sort()).toEqual([f.member.device,ownSecond].sort());
    expect(r.json().items.find((d:{deviceId:string})=>d.deviceId===f.member.device)).toMatchObject({current:true,status:'active'});
    expect(r.json().items.find((d:{deviceId:string})=>d.deviceId===ownSecond)).toMatchObject({current:false,status:'pending_key'});
  });

  it('shows administrators all family devices including revoked history',async()=>{
    const f=await seed(pool);
    await pool.query(`UPDATE devices SET status='revoked',revoked_at=now() WHERE id=$1`,[f.other.device]);
    const r=await app.inject({method:'GET',url:'/v1/family/devices',headers:{cookie:`fm_session=${f.primary.token}`}});
    expect(r.statusCode).toBe(200);
    expect(r.json().items).toHaveLength(4);
    expect(r.json().items.find((d:{deviceId:string})=>d.deviceId===f.other.device)).toMatchObject({
      memberDisplayName:'other',status:'revoked',current:false
    });
  });

  it('rejects a stale removed membership',async()=>{
    const f=await seed(pool);
    await pool.query(`UPDATE family_memberships SET status='removed' WHERE family_id=$1 AND member_id=$2`,[f.family,f.member.id]);
    const r=await app.inject({method:'GET',url:'/v1/family/devices',headers:{cookie:`fm_session=${f.member.token}`}});
    expect(r.statusCode).toBe(401);
  });
});
