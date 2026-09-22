import {fromBase64,openConversationKey} from '@family-messenger/crypto';
import {api} from '../api/client.js';
import {saveChatKey,unlockDeviceProfile} from '../local/keystore.js';

export type DeviceKeyEnvelope={chatId:string;keyVersion:number;sealedKeyEnvelope:string};

export async function syncAllDeviceKeys(pin:string){
  const response=await api<{items:DeviceKeyEnvelope[]}>('/v1/keys/device/envelopes');
  const plain=await unlockDeviceProfile(pin);
  const opened=await Promise.all(response.items.map(async item=>({
    chatId:item.chatId,
    keyVersion:item.keyVersion,
    key:await openConversationKey(
      item.sealedKeyEnvelope,
      fromBase64(plain.encryptionPublicKey),
      fromBase64(plain.encryptionPrivateKey)
    )
  })));
  opened.sort((a,b)=>a.chatId.localeCompare(b.chatId)||a.keyVersion-b.keyVersion);
  for(const item of opened)await saveChatKey(item.chatId,item.keyVersion,item.key,pin);
  return opened;
}
