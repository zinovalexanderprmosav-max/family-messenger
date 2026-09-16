import type { PoolClient } from 'pg';
export async function appendAuditEvent(tx: PoolClient, input: {
  familyId:string; actorDeviceId?:string|null; eventType:string; details?:Record<string,unknown>;
}) {
  await tx.query(
    `INSERT INTO audit_events(family_id,actor_device_id,event_type,details) VALUES($1,$2,$3,$4::jsonb)`,
    [input.familyId,input.actorDeviceId ?? null,input.eventType,JSON.stringify(input.details ?? {})]
  );
}
