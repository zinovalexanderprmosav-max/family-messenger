import type { PoolClient } from 'pg';

export async function scheduleRotationsForMember(tx:PoolClient,memberId:string,reason:'device_revoked'|'member_removed'){
  await tx.query(`
    WITH current_versions AS (
      SELECT chat_id,max(key_version)::int AS key_version
      FROM conversation_key_versions
      GROUP BY chat_id
    ), affected AS (
      SELECT DISTINCT cm.chat_id,cv.key_version
      FROM chat_members cm
      JOIN current_versions cv ON cv.chat_id=cm.chat_id
      WHERE cm.member_id=$1
    )
    INSERT INTO chat_key_rotation_requests(chat_id,from_key_version,to_key_version,reason,state,created_at,completed_at)
    SELECT chat_id,key_version,key_version+1,$2,'pending',now(),NULL
    FROM affected
    ON CONFLICT(chat_id) DO UPDATE SET
      from_key_version=EXCLUDED.from_key_version,
      to_key_version=EXCLUDED.to_key_version,
      reason=EXCLUDED.reason,
      state='pending',
      created_at=now(),
      completed_at=NULL
  `,[memberId,reason]);
}
