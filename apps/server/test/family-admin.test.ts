import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/db/migrate.js';
import { hashOpaqueToken } from '../src/auth/session.js';

const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl) throw new Error('DATABASE_URL_required_for_family_admin_tests');
const pool=new Pool({connectionString:databaseUrl});
let app:FastifyInstance;

beforeAll(async()=>{app=await buildApp({pool});});
afterAll(async()=>{await app.close();await pool.end();});
beforeEach(async()=>{await pool.query(`TRUNCATE audit_events,auth_challenges,sessions,message_envelopes,device_key_envelopes,conversation_key_versions,chat_members,chats,invitations,devices,family_memberships,members,families RESTART IDENTITY CASCADE`);});

async function readPrimaryAdmin(familyId:string){
  const stored=await pool.query<{primary_admin_member_id:string|null}>(`
    SELECT to_jsonb(families)->>'primary_admin_member_id' AS primary_admin_member_id
    FROM families
    WHERE id=$1
  `,[familyId]);
  return stored.rows[0]?.primary_admin_member_id ?? null;
}

async function bootstrapFamily(){
  const response=await app.inject({
    method:'POST',
    url:'/v1/families/bootstrap',
    payload:{
      familyDisplayName:'Family',
      memberDisplayName:'Alex',
      deviceName:'iPhone Alex',
      encryptionPublicKey:'enc-alex',
      signingPublicKey:'sig-alex',
      initialFamilyChatKeyEnvelope:'sealed-family-key'
    }
  });
  expect(response.statusCode).toBe(201);
  const setCookie=response.headers['set-cookie'];
  const cookieHeader=(Array.isArray(setCookie)?setCookie[0]:setCookie)?.split(';')[0] ?? '';
  return {...(response.json() as {familyId:string;memberId:string}),cookieHeader};
}

async function addActiveDeviceSession(input:{familyId:string;memberId:string;name:string;token:string;csrf:string}){
  const device=(await pool.query<{id:string}>(`
    INSERT INTO devices(family_id,member_id,device_name,encryption_public_key,signing_public_key,status)
    VALUES($1,$2,$3,$4,$5,'active')
    RETURNING id
  `,[input.familyId,input.memberId,input.name,`enc-${input.name}`,`sig-${input.name}`])).rows[0]!;
  await pool.query(`
    INSERT INTO sessions(token_hash,device_id,member_id,family_id,csrf_token,expires_at)
    VALUES($1,$2,$3,$4,$5,now()+interval '1 day')
  `,[hashOpaqueToken(input.token),device.id,input.memberId,input.familyId,input.csrf]);
  return {deviceId:device.id,token:input.token,csrf:input.csrf};
}

async function seedAdministratorFamily(){
  const family=(await pool.query<{id:string}>(`INSERT INTO families(display_name) VALUES('Admin Family') RETURNING id`)).rows[0]!;
  const alex=(await pool.query<{id:string}>(`INSERT INTO members(display_name) VALUES('Alex') RETURNING id`)).rows[0]!;
  const mama=(await pool.query<{id:string}>(`INSERT INTO members(display_name) VALUES('Мама') RETURNING id`)).rows[0]!;
  const vika=(await pool.query<{id:string}>(`INSERT INTO members(display_name) VALUES('Вика') RETURNING id`)).rows[0]!;
  await pool.query(`
    INSERT INTO family_memberships(family_id,member_id,role,status)
    VALUES($1,$2,'admin','active'),($1,$3,'member','active'),($1,$4,'member','active')
  `,[family.id,alex.id,mama.id,vika.id]);
  await pool.query(`UPDATE families SET primary_admin_member_id=$1 WHERE id=$2`,[alex.id,family.id]);
  const alexAuth=await addActiveDeviceSession({familyId:family.id,memberId:alex.id,name:'alex-phone',token:'alex-session',csrf:'alex-csrf'});
  const mamaAuth=await addActiveDeviceSession({familyId:family.id,memberId:mama.id,name:'mama-phone',token:'mama-session',csrf:'mama-csrf'});
  const vikaAuth=await addActiveDeviceSession({familyId:family.id,memberId:vika.id,name:'vika-phone',token:'vika-session',csrf:'vika-csrf'});
  return {familyId:family.id,alexId:alex.id,mamaId:mama.id,vikaId:vika.id,alexAuth,mamaAuth,vikaAuth};
}

function adminHeaders(auth:{token:string;csrf:string}){
  return {cookie:`fm_session=${auth.token}`,'x-csrf-token':auth.csrf};
}

async function promote(memberId:string,auth:{token:string;csrf:string}){
  return app.inject({method:'POST',url:`/v1/family/admins/${memberId}/promote`,headers:adminHeaders(auth)});
}

describe('primary family administrator persistence',()=>{
  it('stores the family creator as primary administrator during bootstrap',async()=>{
    const created=await bootstrapFamily();
    expect(await readPrimaryAdmin(created.familyId)).toBe(created.memberId);
  });

  it('backfills the earliest active administrator for an existing family',async()=>{
    const family=(await pool.query<{id:string}>(`INSERT INTO families(display_name) VALUES('Legacy Family') RETURNING id`)).rows[0]!;
    const newer=(await pool.query<{id:string}>(`INSERT INTO members(display_name) VALUES('Newer Admin') RETURNING id`)).rows[0]!;
    const older=(await pool.query<{id:string}>(`INSERT INTO members(display_name) VALUES('Older Admin') RETURNING id`)).rows[0]!;
    await pool.query(`
      INSERT INTO family_memberships(family_id,member_id,role,status,created_at)
      VALUES
        ($1,$2,'admin','active','2026-02-01T00:00:00Z'),
        ($1,$3,'admin','active','2026-01-01T00:00:00Z')
    `,[family.id,newer.id,older.id]);

    await migrate(pool);

    expect(await readPrimaryAdmin(family.id)).toBe(older.id);
  });

  it('uses member id as a deterministic tie breaker during backfill',async()=>{
    const family=(await pool.query<{id:string}>(`INSERT INTO families(display_name) VALUES('Tie Family') RETURNING id`)).rows[0]!;
    const smallerId='00000000-0000-4000-8000-000000000001';
    const largerId='00000000-0000-4000-8000-000000000002';
    await pool.query(`INSERT INTO members(id,display_name) VALUES($1,'Admin A'),($2,'Admin B')`,[smallerId,largerId]);
    await pool.query(`
      INSERT INTO family_memberships(family_id,member_id,role,status,created_at)
      VALUES
        ($1,$2,'admin','active','2026-01-01T00:00:00Z'),
        ($1,$3,'admin','active','2026-01-01T00:00:00Z')
    `,[family.id,largerId,smallerId]);

    await migrate(pool);

    expect(await readPrimaryAdmin(family.id)).toBe(smallerId);
  });

  it('returns the primary administrator id in the family summary',async()=>{
    const created=await bootstrapFamily();
    const response=await app.inject({method:'GET',url:'/v1/family',headers:{cookie:created.cookieHeader}});

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id:created.familyId,
      primaryAdminMemberId:created.memberId
    });
  });
});

describe('primary administrator promotion permissions',()=>{
  it('allows the primary administrator to promote one secondary administrator and audits it',async()=>{
    const seeded=await seedAdministratorFamily();
    const response=await promote(seeded.mamaId,seeded.alexAuth);

    expect(response.statusCode).toBe(204);
    const membership=await pool.query<{role:string}>(`SELECT role FROM family_memberships WHERE family_id=$1 AND member_id=$2`,[seeded.familyId,seeded.mamaId]);
    expect(membership.rows[0]?.role).toBe('admin');
    const audit=await pool.query<{event_type:string;member_id:string}>(`
      SELECT event_type,details->>'memberId' AS member_id
      FROM audit_events
      WHERE family_id=$1 AND event_type='family.admin.promoted'
    `,[seeded.familyId]);
    expect(audit.rows).toEqual([{event_type:'family.admin.promoted',member_id:seeded.mamaId}]);
  });

  it('rejects promotion by the secondary administrator before evaluating the administrator limit',async()=>{
    const seeded=await seedAdministratorFamily();
    expect((await promote(seeded.mamaId,seeded.alexAuth)).statusCode).toBe(204);

    const response=await promote(seeded.vikaId,seeded.mamaAuth);

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({error:'primary_administrator_required'});
  });

  it('rejects a third active administrator even when requested by the primary administrator',async()=>{
    const seeded=await seedAdministratorFamily();
    expect((await promote(seeded.mamaId,seeded.alexAuth)).statusCode).toBe(204);

    const response=await promote(seeded.vikaId,seeded.alexAuth);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({error:'administrator_limit_reached'});
  });

  it('rejects privileged promotion when the family has no configured primary administrator',async()=>{
    const seeded=await seedAdministratorFamily();
    await pool.query(`UPDATE families SET primary_admin_member_id=NULL WHERE id=$1`,[seeded.familyId]);

    const response=await promote(seeded.mamaId,seeded.alexAuth);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({error:'primary_administrator_not_configured'});
  });

  it('protects the primary administrator from being promoted again',async()=>{
    const seeded=await seedAdministratorFamily();

    const response=await promote(seeded.alexId,seeded.alexAuth);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({error:'primary_administrator_protected'});
    const membership=await pool.query<{role:string;status:string}>(`SELECT role,status FROM family_memberships WHERE family_id=$1 AND member_id=$2`,[seeded.familyId,seeded.alexId]);
    expect(membership.rows[0]).toEqual({role:'admin',status:'active'});
    const audit=await pool.query<{count:string}>(`SELECT count(*)::text count FROM audit_events WHERE family_id=$1 AND event_type='family.admin.promoted'`,[seeded.familyId]);
    expect(audit.rows[0]?.count).toBe('0');
  });
});
