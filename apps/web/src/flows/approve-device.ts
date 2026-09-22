import { fromBase64, sealConversationKey } from '@family-messenger/crypto';
import { api } from '../api/client.js';
import type { PendingDevice } from '../api/types.js';
import { listStoredChatKeys,loadChatKey } from '../local/keystore.js';
import { loadProfile } from '../local/session.js';
import { syncAllDeviceKeys } from './key-provisioning.js';
import { syncCurrentChatKey } from './key-rotation.js';

export async function listPendingDevices(){return (await api<{items:PendingDevice[]}>('/v1/devices/pending')).items;}

export async function approvePendingDevice(device:PendingDevice,pin:string){
  const profile=await loadProfile();if(!profile)throw new Error('profile_not_found');
  const ownDevice=device.memberId===profile.memberId;
  if(ownDevice)await syncAllDeviceKeys(pin);
  else await syncCurrentChatKey(profile.familyChatId,pin);

  const current=await loadChatKey(profile.familyChatId,pin);
  const sealedKeyEnvelope=await sealConversationKey(current.key,fromBase64(device.encryptionPublicKey));
  const provisionedKeys=ownDevice
    ?await Promise.all((await listStoredChatKeys(pin))
      .filter(item=>!(item.chatId===profile.familyChatId&&item.keyVersion===current.keyVersion))
      .map(async item=>({
        chatId:item.chatId,
        keyVersion:item.keyVersion,
        sealedKeyEnvelope:await sealConversationKey(item.key,fromBase64(device.encryptionPublicKey))
      })))
    :undefined;

  await api<void>(`/v1/devices/${device.deviceId}/approve`,{
    method:'POST',
    body:JSON.stringify({
      chatId:profile.familyChatId,keyVersion:current.keyVersion,sealedKeyEnvelope,
      ...(provisionedKeys!==undefined?{provisionedKeys}:{})
    })
  });
}

export async function deviceFingerprint(publicKeyBase64:string){const bytes=Uint8Array.from(fromBase64(publicKeyBase64));const digest=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest).slice(0,6),b=>b.toString(16).padStart(2,'0')).join(':').toUpperCase();}
