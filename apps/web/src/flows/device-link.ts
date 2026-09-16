import { generateDeviceIdentity, toBase64 } from '@family-messenger/crypto';
import { api } from '../api/client.js';
import type { AcceptResponse } from '../api/types.js';
import { createLockedDeviceProfile } from '../local/keystore.js';
import { saveProfile, setUnlockedPin } from '../local/session.js';

export type DeviceLinkInspection={
  deviceLinkId:string;
  familyId:string;
  memberId:string;
  familyDisplayName:string;
  memberDisplayName:string;
  expiresAt:string;
};

export type CreatedDeviceLink={deviceLinkId:string;linkToken:string;expiresAt:string};

export function consumeDeviceLinkTokenFromHash(
  locationLike:Pick<Location,'hash'>=window.location,
  historyLike:Pick<History,'replaceState'>=history
){
  const match=locationLike.hash.match(/^#\/device-link\?token=([^&]+)/);
  if(!match)return null;
  const token=decodeURIComponent(match[1]!);
  historyLike.replaceState(null,'','/#/device-link');
  return token;
}

export async function createDeviceLink(){
  return api<CreatedDeviceLink>('/v1/device-links',{method:'POST',body:'{}'});
}

export async function inspectDeviceLinkToken(linkToken:string){
  return api<DeviceLinkInspection>('/v1/device-links/inspect',{method:'POST',body:JSON.stringify({linkToken})});
}

export async function acceptDeviceLink(input:{
  linkToken:string;
  deviceName:string;
  pin:string;
  memberDisplayName:string;
  familyDisplayName?:string;
}){
  const identity=await generateDeviceIdentity();
  const response=await api<AcceptResponse>('/v1/device-links/accept',{method:'POST',body:JSON.stringify({
    linkToken:input.linkToken,
    deviceName:input.deviceName,
    encryptionPublicKey:toBase64(identity.encryptionPublicKey),
    signingPublicKey:toBase64(identity.signingPublicKey)
  })});
  await createLockedDeviceProfile(identity,input.pin);
  await saveProfile({
    familyId:response.familyId,
    memberId:response.memberId,
    deviceId:response.deviceId,
    familyChatId:response.familyChatId,
    status:'pending_key',
    csrfToken:response.csrfToken,
    memberDisplayName:input.memberDisplayName,
    ...(input.familyDisplayName===undefined?{}:{familyDisplayName:input.familyDisplayName})
  });
  setUnlockedPin(input.pin);
  return response;
}
