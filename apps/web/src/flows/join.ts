import { generateDeviceIdentity, toBase64 } from '@family-messenger/crypto';
import { api } from '../api/client.js';
import type { AcceptResponse } from '../api/types.js';
import { createLockedDeviceProfile } from '../local/keystore.js';
import { loadProfile, saveProfile, setUnlockedPin } from '../local/session.js';
import { syncAllDeviceKeys } from './key-provisioning.js';

export function consumeJoinTokenFromHash(locationLike:Pick<Location,'hash'>=window.location){
  const hash=locationLike.hash;const match=hash.match(/^#\/join\?token=([^&]+)/);if(!match)return null;
  const token=decodeURIComponent(match[1]!);if(typeof history!=='undefined')history.replaceState(null,'','/#/join');return token;
}
export async function inspectJoinToken(joinToken:string){return api<{invitationId:string;familyId:string;familyDisplayName:string;expiresAt:string}>('/v1/invitations/inspect',{method:'POST',body:JSON.stringify({joinToken})});}
export async function acceptInvitation(input:{joinToken:string;memberDisplayName:string;deviceName:string;pin:string;familyDisplayName?:string}){
  const identity=await generateDeviceIdentity();
  const response=await api<AcceptResponse>('/v1/invitations/accept',{method:'POST',body:JSON.stringify({joinToken:input.joinToken,memberDisplayName:input.memberDisplayName,deviceName:input.deviceName,encryptionPublicKey:toBase64(identity.encryptionPublicKey),signingPublicKey:toBase64(identity.signingPublicKey)})});
  await createLockedDeviceProfile(identity,input.pin);
  await saveProfile({familyId:response.familyId,memberId:response.memberId,deviceId:response.deviceId,familyChatId:response.familyChatId,status:'pending_key',csrfToken:response.csrfToken,memberDisplayName:input.memberDisplayName,...(input.familyDisplayName!==undefined?{familyDisplayName:input.familyDisplayName}:{})});
  setUnlockedPin(input.pin);return response;
}
export async function completePendingApproval(pin:string){
  const profile=await loadProfile();if(!profile)throw new Error('profile_not_found');
  await syncAllDeviceKeys(pin);
  const active={...profile,status:'active' as const};await saveProfile(active);setUnlockedPin(pin);return active;
}
