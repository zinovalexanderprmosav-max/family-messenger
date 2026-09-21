import { fromBase64, sealConversationKey } from '@family-messenger/crypto';
import { api } from '../api/client.js';
import type { PendingDevice } from '../api/types.js';
import { loadProfile } from '../local/session.js';
import { syncCurrentChatKey } from './key-rotation.js';

export async function listPendingDevices(){return (await api<{items:PendingDevice[]}>('/v1/devices/pending')).items;}
export async function approvePendingDevice(device:PendingDevice,pin:string){const profile=await loadProfile();if(!profile)throw new Error('profile_not_found');const current=await syncCurrentChatKey(profile.familyChatId,pin);const sealedKeyEnvelope=await sealConversationKey(current.key,fromBase64(device.encryptionPublicKey));await api<void>(`/v1/devices/${device.deviceId}/approve`,{method:'POST',body:JSON.stringify({chatId:profile.familyChatId,keyVersion:current.keyVersion,sealedKeyEnvelope})});}
export async function deviceFingerprint(publicKeyBase64:string){const bytes=Uint8Array.from(fromBase64(publicKeyBase64));const digest=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest).slice(0,6),b=>b.toString(16).padStart(2,'0')).join(':').toUpperCase();}
