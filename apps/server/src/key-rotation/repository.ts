import type {PoolClient} from 'pg';
import type {SessionPrincipal} from '../auth/session.js';
import {appendAuditEvent} from '../audit/repository.js';

export async function requireRotationsForRevokedDevices(
  tx:PoolClient,
  principal:SessionPrincipal,
  deviceIds:string[]
){
  if(deviceIds.length===0)return;
  const affected=await tx.query<{chat_id:string;key_version:number}>(`
    WITH current_versions AS (
      SELECT chat_id,max(key_version)::int AS key_version
      FROM conversation_key_versions
      GROUP BY chat_id
    )
    SELECT DISTINCT c.id AS chat_id,cv.key_version
    FROM chats c
    JOIN current_versions cv ON cv.chat_id=c.id
    JOIN device_key_envelopes dke
      ON dke.chat_id=c.id
     AND dke.key_version=cv.key_version
     AND dke.device_id=ANY($2::uuid[])
    WHERE c.family_id=$1
      AND c.write_disabled_at IS NULL
      AND EXISTS(
        SELECT 1
        FROM chat_members cm
        JOIN family_memberships fm
          ON fm.family_id=c.family_id
         AND fm.member_id=cm.member_id
         AND fm.status='active'
        JOIN devices d
          ON d.family_id=c.family_id
         AND d.member_id=cm.member_id
         AND d.status='active'
        WHERE cm.chat_id=c.id
      )
    ORDER BY c.id
  `,[principal.familyId,deviceIds]);

  for(const row of affected.rows){
    const inserted=await tx.query(`
      INSERT INTO chat_key_rotations(chat_id,from_key_version,status)
      VALUES($1,$2,'required')
      ON CONFLICT(chat_id,from_key_version) DO NOTHING
      RETURNING chat_id
    `,[row.chat_id,row.key_version]);
    if(inserted.rowCount){
      await appendAuditEvent(tx,{
        familyId:principal.familyId,
        actorDeviceId:principal.deviceId,
        eventType:'chat.key.rotation.required',
        details:{chatId:row.chat_id,keyVersion:row.key_version}
      });
    }
  }
}
