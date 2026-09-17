import type { FastifyInstance } from 'fastify';
import type { DatabasePool } from '../db/pool.js';
import { requireSession } from '../auth/session.js';

export async function registerDirectChatRoutes(app:FastifyInstance,pool:DatabasePool){
  app.get<{Params:{memberId:string}}>('/v1/members/:memberId/direct-chat',async(request,reply)=>{
    const principal=await requireSession(request,pool);
    if(principal.deviceStatus!=='active') return reply.code(403).send({error:'device_not_active'});

    const members=await pool.query<{member_id:string}>(`
      SELECT member_id
      FROM family_memberships
      WHERE family_id=$1 AND member_id=ANY($2::uuid[]) AND status='active'
    `,[principal.familyId,[principal.memberId,request.params.memberId]]);
    if(members.rowCount!==2) return reply.code(404).send({error:'member_not_found'});

    const devices=await pool.query<{id:string;member_id:string;encryption_public_key:string}>(`
      SELECT id,member_id,encryption_public_key
      FROM devices
      WHERE family_id=$1 AND member_id=ANY($2::uuid[]) AND status='active'
      ORDER BY created_at,id
    `,[principal.familyId,[principal.memberId,request.params.memberId]]);

    return {
      status:'needs_key' as const,
      devices:devices.rows.map(row=>({deviceId:row.id,memberId:row.member_id,encryptionPublicKey:row.encryption_public_key}))
    };
  });
}
