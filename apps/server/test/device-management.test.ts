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

describe('device management listing',()=>{
  it('shows ordinary members only their devices and marks the current one',async()=>{
    const f=await seed(pool);
    const ownSecond=(await pool.query<{id:string}>(`
      INSERT INTO devices(family_id,member_id,device_name,encryption_public_key,signing_public_key,status)
      VALUES($1,$2,'Tablet',$3,$4,'pending_key') RETURNING id
    `,[f.family,f.member.id,randomUUID(),randomUUID()])).rows[0]!.id;
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

  it('lets a member rename own current or secondary device but not someone elses device',async()=>{
    const f=await seed(pool);
    const ownSecond=(await pool.query<{id:string}>(`
      INSERT INTO devices(family_id,member_id,device_name,encryption_public_key,signing_public_key,status)
      VALUES($1,$2,'Tablet',$3,$4,'active') RETURNING id
    `,[f.family,f.member.id,randomUUID(),randomUUID()])).rows[0]!.id;

    const current=await app.inject({method:'POST',url:`/v1/family/devices/${f.member.device}/rename`,headers:headers(f.member),payload:{deviceName:'My iPhone'}});
    expect(current.statusCode).toBe(204);
    const second=await app.inject({method:'POST',url:`/v1/family/devices/${ownSecond}/rename`,headers:headers(f.member),payload:{deviceName:'Work tablet'}});
    expect(second.statusCode).toBe(204);
    expect((await pool.query('SELECT device_name FROM devices WHERE id=$1',[f.member.device])).rows[0]?.device_name).toBe('My iPhone');
    expect((await pool.query('SELECT device_name FROM devices WHERE id=$1',[ownSecond])).rows[0]?.device_name).toBe('Work tablet');

    const forbidden=await app.inject({method:'POST',url:`/v1/family/devices/${f.other.device}/rename`,headers:headers(f.member),payload:{deviceName:'Nope'}});
    expect(forbidden.statusCode).toBe(403);expect(forbidden.json()).toEqual({error:'device_owner_required'});
    expect((await pool.query(`SELECT * FROM audit_events WHERE event_type='device.renamed'`)).rowCount).toBe(2);
  });

  it('rejects a stale removed membership',async()=>{
    const f=await seed(pool);
    await pool.query(`UPDATE family_memberships SET status='removed' WHERE family_id=$1 AND member_id=$2`,[f.family,f.member.id]);
    const r=await app.inject({method:'GET',url:'/v1/family/devices',headers:{cookie:`fm_session=${f.member.token}`}});
    expect(r.statusCode).toBe(401);
  });
});
