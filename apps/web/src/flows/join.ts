import { generateDeviceIdentity, toBase64 } from '@family-messenger/crypto';
import { api } from '../api/client.js';
import type { AcceptResponse } from '../api/types.js';
import { createLockedDeviceProfile } from '../local/keystore.js';
import { getNativeDeviceName, loadProfile, saveProfile, setUnlockedPin } from '../local/session.js';
import { syncAllDeviceKeys } from './key-provisioning.js';
import { ensureRecoveryBackup } from './recovery-backup.js';

export function consumeJoinTokenFromHash(locationLike:Pick<Location,'hash'>=window.location){
  const hash=locationLike.hash;const match=hash.match(/^#\/join\?token=([^&]+)/);if(!match)return null;
  const token=decodeURIComponent(match[1]!);if(typeof history!=='undefined')history.replaceState(null,'','/#/join');return token;
}
export async function inspectJoinToken(joinToken:string){
  return api<{invitationId:string;familyId:string;familyDisplayName:string;intendedMemberDisplayName:string|null;expiresAt:string}>(
    '/v1/invitations/inspect',{method:'POST',body:JSON.stringify({joinToken})}
  );
}
export async function acceptInvitation(input:{joinToken:string;memberDisplayName?:string;deviceName?:string;pin:string;familyDisplayName?:string}){
  const identity=await generateDeviceIdentity();
  const deviceName=input.deviceName?.trim()||getNativeDeviceName()||'Мой телефон';
  const body={
    joinToken:input.joinToken,
    ...(input.memberDisplayName?{memberDisplayName:input.memberDisplayName}:{}),
    deviceName,
    encryptionPublicKey:toBase64(identity.encryptionPublicKey),
    signingPublicKey:toBase64(identity.signingPublicKey)
  };
  const response=await api<AcceptResponse&{memberDisplayName?:string}>('/v1/invitations/accept',{method:'POST',body:JSON.stringify(body)});
  const memberDisplayName=response.memberDisplayName??input.memberDisplayName??'Участник';
  await createLockedDeviceProfile(identity,input.pin);
  await saveProfile({familyId:response.familyId,memberId:response.memberId,deviceId:response.deviceId,familyChatId:response.familyChatId,status:'pending_key',csrfToken:response.csrfToken,memberDisplayName,...(input.familyDisplayName!==undefined?{familyDisplayName:input.familyDisplayName}:{})});
  setUnlockedPin(input.pin);return response;
}
export async function completePendingApproval(pin:string){
  const profile=await loadProfile();if(!profile)throw new Error('profile_not_found');
  await syncAllDeviceKeys(pin);
  const active={...profile,status:'active' as const};await saveProfile(active);setUnlockedPin(pin);await ensureRecoveryBackup();return active;
}
