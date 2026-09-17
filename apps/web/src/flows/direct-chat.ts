import {
  fromBase64,
  generateConversationKey,
  openConversationKey,
  sealConversationKey
} from '@family-messenger/crypto';
import { api } from '../api/client.js';
import { loadChatKey,saveChatKey,unlockDeviceProfile } from '../local/keystore.js';
import {
  ensureDirectChat,
  type DirectChatPreparation,
  type DirectChatReady
} from './direct-chat-core.js';

export async function openDirectChat(memberId:string,pin:string):Promise<{chatId:string;keyVersion:number}>{
  const plain=await unlockDeviceProfile(pin);
  return ensureDirectChat(memberId,{
    prepare:id=>api<DirectChatPreparation>(`/v1/members/${encodeURIComponent(id)}/direct-chat`),
    localKeyExists:async chatId=>{
      try{
        await loadChatKey(chatId,pin);
        return true;
      }catch(error){
        if(error instanceof Error&&error.message==='chat_key_not_found')return false;
        throw error;
      }
    },
    restoreExistingKey:async ready=>{
      if(!ready.sealedKeyEnvelope)throw new Error('direct_chat_key_envelope_missing');
      const key=await openConversationKey(
        ready.sealedKeyEnvelope,
        fromBase64(plain.encryptionPublicKey),
        fromBase64(plain.encryptionPrivateKey)
      );
      await saveChatKey(ready.chatId,ready.keyVersion,key,pin);
    },
    createConversationMaterial:async devices=>{
      const key=await generateConversationKey();
      const envelopes=await Promise.all(devices.map(async device=>({
        deviceId:device.deviceId,
        sealedKeyEnvelope:await sealConversationKey(key,fromBase64(device.encryptionPublicKey))
      })));
      return {key,envelopes};
    },
    createRemote:(id,envelopes)=>api<DirectChatReady>(`/v1/members/${encodeURIComponent(id)}/direct-chat`,{
      method:'POST',
      body:JSON.stringify({envelopes})
    }),
    saveCreatedKey:(chatId,keyVersion,key)=>saveChatKey(chatId,keyVersion,key,pin)
  });
}
