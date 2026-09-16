import type { PoolClient } from 'pg';
import { assertDeviceCapacity } from '../families/repository.js';

export type DeviceLinkRecord={id:string;familyId:string;memberId:string;expiresAt:string};

export async function createDeviceLink(tx:PoolClient,input:{familyId:string;memberId:string;createdByDeviceId:string;tokenHash:string;expiresAt:Date}):Promise<DeviceLinkRecord>{
  const r=await tx.query<{id:string;family_id:string;member_id:string;expires_at:Date}>(`
    INSERT INTO device_links(family_id,member_id,created_by_device_id,token_hash,expires_at)
    VALUES($1,$2,$3,$4,$5)
    RETURNING id,family_id,member_id,expires_at`,[input.familyId,input.memberId,input.createdByDeviceId,input.tokenHash,input.expiresAt]);
  const row=r.rows[0]!;
  return {id:row.id,familyId:row.family_id,memberId:row.member_id,expiresAt:row.expires_at.toISOString()};
}

function assertUsable(row:{expires_at:Date;consumed_at:Date|null;revoked_at:Date|null}|undefined){
  if(!row) throw new Error('device_link_invalid');
  if(row.revoked_at) throw new Error('device_link_revoked');
  if(row.consumed_at) throw new Error('device_link_consumed');
  if(row.expires_at.getTime()<=Date.now()) throw new Error('device_link_expired');
}

export async function inspectDeviceLink(tx:PoolClient,tokenHash:string){
  const r=await tx.query<{
    id:string;family_id:string;member_id:string;expires_at:Date;consumed_at:Date|null;revoked_at:Date|null;
    family_display_name:string;member_display_name:string;
  }>(`
    SELECT dl.id,dl.family_id,dl.member_id,dl.expires_at,dl.consumed_at,dl.revoked_at,
           f.display_name family_display_name,m.display_name member_display_name
    FROM device_links dl
    JOIN families f ON f.id=dl.family_id
    JOIN members m ON m.id=dl.member_id
    JOIN family_memberships fm ON fm.family_id=dl.family_id AND fm.member_id=dl.member_id
    WHERE dl.token_hash=$1 AND fm.status='active'`,[tokenHash]);
  const row=r.rows[0];assertUsable(row);
  return {deviceLinkId:row!.id,familyId:row!.family_id,memberId:row!.member_id,familyDisplayName:row!.family_display_name,memberDisplayName:row!.member_display_name,expiresAt:row!.expires_at.toISOString()};
}

export async function consumeDeviceLink(tx:PoolClient,tokenHash:string,input:{deviceName:string;encryptionPublicKey:string;signingPublicKey:string}){
  const r=await tx.query<{
    id:string;family_id:string;member_id:string;expires_at:Date;consumed_at:Date|null;revoked_at:Date|null;
  }>(`SELECT id,family_id,member_id,expires_at,consumed_at,revoked_at FROM device_links WHERE token_hash=$1 FOR UPDATE`,[tokenHash]);
  const link=r.rows[0];assertUsable(link);
  const membership=await tx.query(`SELECT 1 FROM family_memberships WHERE family_id=$1 AND member_id=$2 AND status='active'`,[link!.family_id,link!.member_id]);
  if(!membership.rowCount) throw new Error('device_link_invalid');
  await assertDeviceCapacity(tx,link!.member_id);
  const device=await tx.query<{id:string}>(`
    INSERT INTO devices(family_id,member_id,device_name,encryption_public_key,signing_public_key,status)
    VALUES($1,$2,$3,$4,$5,'pending_key') RETURNING id`,[link!.family_id,link!.member_id,input.deviceName,input.encryptionPublicKey,input.signingPublicKey]);
  const chat=await tx.query<{id:string}>(`SELECT id FROM chats WHERE family_id=$1 AND kind='family'`,[link!.family_id]);
  if(!chat.rows[0]) throw new Error('family_chat_not_found');
  await tx.query(`UPDATE device_links SET consumed_at=now() WHERE id=$1`,[link!.id]);
  return {familyId:link!.family_id,memberId:link!.member_id,deviceId:device.rows[0]!.id,familyChatId:chat.rows[0].id,status:'pending_key' as const};
}
