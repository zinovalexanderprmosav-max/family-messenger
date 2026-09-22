import type { PoolClient } from 'pg';
import { assertDeviceCapacity } from '../families/repository.js';
import { lockFamily } from '../families/access.js';

export type InvitationRecord={
  id:string;familyId:string;expiresAt:string;consumedAt:string|null;revokedAt:string|null;
  intendedMemberDisplayName:string|null;
};

export async function createInvitation(tx:PoolClient,input:{
  familyId:string;createdByDeviceId:string;tokenHash:string;expiresAt:Date;intendedMemberDisplayName?:string;
}):Promise<InvitationRecord>{
  const r=await tx.query<{
    id:string;family_id:string;expires_at:Date;consumed_at:Date|null;revoked_at:Date|null;intended_member_display_name:string|null;
  }>(
    'INSERT INTO invitations(family_id,created_by_device_id,token_hash,expires_at,intended_member_display_name) VALUES($1,$2,$3,$4,$5) RETURNING id,family_id,expires_at,consumed_at,revoked_at,intended_member_display_name',
    [input.familyId,input.createdByDeviceId,input.tokenHash,input.expiresAt,input.intendedMemberDisplayName??null]
  );
  const row=r.rows[0]!;
  return {
    id:row.id,familyId:row.family_id,expiresAt:row.expires_at.toISOString(),
    consumedAt:null,revokedAt:null,intendedMemberDisplayName:row.intended_member_display_name
  };
}

function assertInvitationState(row:{expires_at:Date;consumed_at:Date|null;revoked_at:Date|null}){
  if(row.revoked_at)throw new Error('invitation_revoked');
  if(row.consumed_at)throw new Error('invitation_consumed');
  if(row.expires_at.getTime()<=Date.now())throw new Error('invitation_expired');
}

export async function inspectInvitation(tx:PoolClient,tokenHash:string){
  const r=await tx.query<{
    id:string;family_id:string;display_name:string;expires_at:Date;consumed_at:Date|null;revoked_at:Date|null;
    intended_member_display_name:string|null;
  }>(
    'SELECT i.id,i.family_id,f.display_name,i.expires_at,i.consumed_at,i.revoked_at,i.intended_member_display_name FROM invitations i JOIN families f ON f.id=i.family_id WHERE i.token_hash=$1',
    [tokenHash]
  );
  const row=r.rows[0];if(!row)throw new Error('invitation_invalid');
  assertInvitationState(row);
  return {
    invitationId:row.id,familyId:row.family_id,familyDisplayName:row.display_name,
    intendedMemberDisplayName:row.intended_member_display_name,expiresAt:row.expires_at.toISOString()
  };
}

export async function consumeInvitation(tx:PoolClient,tokenHash:string,deviceInput:{
  memberDisplayName?:string;deviceName:string;encryptionPublicKey:string;signingPublicKey:string;
}){
  const family=(await tx.query<{family_id:string}>('SELECT family_id FROM invitations WHERE token_hash=$1',[tokenHash])).rows[0];
  if(!family)throw new Error('invitation_invalid');
  await lockFamily(tx,family.family_id);

  const r=await tx.query<{
    id:string;family_id:string;expires_at:Date;consumed_at:Date|null;revoked_at:Date|null;intended_member_display_name:string|null;
  }>(
    'SELECT id,family_id,expires_at,consumed_at,revoked_at,intended_member_display_name FROM invitations WHERE token_hash=$1 FOR UPDATE',
    [tokenHash]
  );
  const invite=r.rows[0];if(!invite)throw new Error('invitation_invalid');
  assertInvitationState(invite);

  const memberDisplayName=invite.intended_member_display_name??deviceInput.memberDisplayName?.trim();
  if(!memberDisplayName)throw Object.assign(new Error('member_display_name_required'),{statusCode:400});

  const member=await tx.query<{id:string}>('INSERT INTO members(display_name) VALUES($1) RETURNING id',[memberDisplayName]);
  const memberId=member.rows[0]!.id;
  await tx.query("INSERT INTO family_memberships(family_id,member_id,role,status) VALUES($1,$2,'member','active')",[invite.family_id,memberId]);
  await assertDeviceCapacity(tx,memberId);
  const device=await tx.query<{id:string}>(
    "INSERT INTO devices(family_id,member_id,device_name,encryption_public_key,signing_public_key,status) VALUES($1,$2,$3,$4,$5,'pending_key') RETURNING id",
    [invite.family_id,memberId,deviceInput.deviceName,deviceInput.encryptionPublicKey,deviceInput.signingPublicKey]
  );
  const chat=await tx.query<{id:string}>("SELECT id FROM chats WHERE family_id=$1 AND kind='family'",[invite.family_id]);
  if(!chat.rows[0])throw new Error('family_chat_not_found');
  await tx.query('INSERT INTO chat_members(chat_id,member_id) VALUES($1,$2)',[chat.rows[0].id,memberId]);
  await tx.query('UPDATE invitations SET consumed_at=now() WHERE id=$1',[invite.id]);

  return {
    familyId:invite.family_id,memberId,memberDisplayName,deviceId:device.rows[0]!.id,
    familyChatId:chat.rows[0].id,status:'pending_key' as const
  };
}
