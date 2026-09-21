import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {hashOpaqueToken} from '../../src/auth/session.js';
export async function seed(pool:Pool){
 const family=(await pool.query(`INSERT INTO families(display_name) VALUES('Test') RETURNING id`)).rows[0].id as string;
 const actors:Record<string,{id:string;device:string;token:string;csrf:string}>={};
 for(const [name,role] of [['primary','admin'],['secondary','admin'],['member','member'],['other','member']]){
  const id=randomUUID(),device=randomUUID(),token=randomUUID(),csrf=randomUUID();
  await pool.query(`INSERT INTO members(id,display_name) VALUES($1,$2)`,[id,name]);
  await pool.query(`INSERT INTO family_memberships(family_id,member_id,role) VALUES($1,$2,$3)`,[family,id,role]);
  await pool.query(`INSERT INTO devices(id,family_id,member_id,device_name,encryption_public_key,signing_public_key,status) VALUES($1,$2,$3,'phone',$4,$5,'active')`,[device,family,id,randomUUID(),randomUUID()]);
  await pool.query(`INSERT INTO sessions(token_hash,device_id,member_id,family_id,csrf_token,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 day')`,[hashOpaqueToken(token),device,id,family,csrf]);
  actors[name!]={id,device,token,csrf};
 }
 await pool.query('UPDATE families SET primary_admin_member_id=$1 WHERE id=$2',[actors.primary!.id,family]);
 return {family,...actors} as {family:string;primary:typeof actors[string];secondary:typeof actors[string];member:typeof actors[string];other:typeof actors[string]};
}
