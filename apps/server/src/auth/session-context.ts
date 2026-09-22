import type {FastifyInstance} from 'fastify';
import type {DatabasePool} from '../db/pool.js';
import {requireSession} from './session.js';

export async function registerSessionContextRoutes(app:FastifyInstance,pool:DatabasePool){
  app.get('/v1/session/context',async(request,reply)=>{
    const principal=await requireSession(request,pool);
    if(principal.deviceStatus==='revoked')return reply.code(401).send({error:'authentication_required'});
    const r=await pool.query<{
      family_display_name:string;
      member_display_name:string;
      device_name:string;
      family_chat_id:string|null;
    }>(`
      SELECT
        f.display_name AS family_display_name,
        m.display_name AS member_display_name,
        d.device_name,
        (
          SELECT c.id
          FROM chats c
          WHERE c.family_id=f.id AND c.kind='family'
          ORDER BY c.created_at
          LIMIT 1
        ) AS family_chat_id
      FROM devices d
      JOIN members m ON m.id=d.member_id
      JOIN families f ON f.id=d.family_id
      WHERE d.id=$1 AND d.member_id=$2 AND d.family_id=$3
    `,[principal.deviceId,principal.memberId,principal.familyId]);
    const row=r.rows[0];
    if(!row||!row.family_chat_id)return reply.code(404).send({error:'session_context_not_found'});
    return {
      familyId:principal.familyId,
      memberId:principal.memberId,
      deviceId:principal.deviceId,
      familyChatId:row.family_chat_id,
      status:principal.deviceStatus,
      csrfToken:principal.csrfToken,
      familyDisplayName:row.family_display_name,
      memberDisplayName:row.member_display_name,
      deviceName:row.device_name
    };
  });
}
