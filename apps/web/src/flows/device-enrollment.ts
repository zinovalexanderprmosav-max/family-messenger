import {generateDeviceIdentity,toBase64} from '@family-messenger/crypto';
import {api} from '../api/client.js';
import type {AcceptDeviceEnrollmentResponse,DeviceEnrollmentInspectResponse,DeviceEnrollmentResponse} from '../api/types.js';
import {createLockedDeviceProfile} from '../local/keystore.js';
import {saveProfile,setUnlockedPin} from '../local/session.js';

export function consumeDeviceEnrollmentTokenFromHash(locationLike:Pick<Location,'hash'>=window.location){
  const match=locationLike.hash.match(/^#\/device\?token=([^&]+)/);if(!match)return null;
  const token=decodeURIComponent(match[1]!);
  if(typeof history!=='undefined')history.replaceState(null,'','/#/device');
  return token;
}

export async function createOwnDeviceEnrollment(){
  return api<DeviceEnrollmentResponse>('/v1/device-enrollments',{method:'POST',body:'{}'});
}

export async function inspectOwnDeviceEnrollment(enrollmentToken:string){
  return api<DeviceEnrollmentInspectResponse>('/v1/device-enrollments/inspect',{method:'POST',body:JSON.stringify({enrollmentToken})});
}

export async function acceptOwnDeviceEnrollment(input:{
  enrollmentToken:string;deviceName:string;pin:string;
  memberDisplayName:string;familyDisplayName:string;
}){
  const identity=await generateDeviceIdentity();
  const response=await api<AcceptDeviceEnrollmentResponse>('/v1/device-enrollments/accept',{method:'POST',body:JSON.stringify({
    enrollmentToken:input.enrollmentToken,
    deviceName:input.deviceName,
    encryptionPublicKey:toBase64(identity.encryptionPublicKey),
    signingPublicKey:toBase64(identity.signingPublicKey)
  })});
  await createLockedDeviceProfile(identity,input.pin);
  await saveProfile({
    familyId:response.familyId,memberId:response.memberId,deviceId:response.deviceId,
    familyChatId:response.familyChatId,status:'pending_key',csrfToken:response.csrfToken,
    memberDisplayName:input.memberDisplayName,familyDisplayName:input.familyDisplayName
  });
  setUnlockedPin(input.pin);
  return response;
}
