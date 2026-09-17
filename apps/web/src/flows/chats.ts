import { fromBase64,generateConversationKey,openConversationKey,sealConversationKey } from '@family-messenger/crypto';
import { api } from '../api/client.js';
import { loadChatKey,saveChatKey,unlockDeviceProfile } from '../local/keystore.js';

export type DirectChatRecipientDevice={deviceId:string;memberId:string;encryptionPublicKey:string};
export type PreparedDirectChat={chatId:string;kind:'direct';keyInitialized:boolean;recipientDevices:DirectChatRecipientDevice[]};

async function restoreCurrentChatKey(chatId:string,pin:string){
  const envelope=await api<{keyVersion:number;sealedKeyEnvelope:string}>(`/v1/keys/chat/${chatId}/current`);
  const identity=await unlockDeviceProfile(pin);
  const key=await openConversationKey(
    envelope.sealedKeyEnvelope,
    fromBase64(identity.encryptionPublicKey),
    fromBase64(identity.encryptionPrivateKey)
  );
  await saveChatKey(chatId,envelope.keyVersion,key,pin);
  return {chatId,keyVersion:envelope.keyVersion};
}

async function localKeyIfPresent(chatId:string,pin:string){
  try{return await loadChatKey(chatId,pin);}catch(error){
    if(error instanceof Error&&error.message==='chat_key_not_found')return null;
    throw error;
  }
}

export async function openOrCreateDirectChat(memberId:string,pin:string){
  const prepared=await api<PreparedDirectChat>(`/v1/direct-chats/${memberId}/prepare`,{method:'POST',body:'{}'});
  const existing=await localKeyIfPresent(prepared.chatId,pin);
  if(existing)return {chatId:prepared.chatId,keyVersion:existing.keyVersion};
  if(prepared.keyInitialized)return restoreCurrentChatKey(prepared.chatId,pin);

  const key=await generateConversationKey();
  const envelopes=await Promise.all(prepared.recipientDevices.map(async device=>({
    deviceId:device.deviceId,
    sealedKeyEnvelope:await sealConversationKey(key,fromBase64(device.encryptionPublicKey))
  })));

  try{
    await api<{chatId:string;keyVersion:number}>(`/v1/chats/${prepared.chatId}/keys/initialize`,{
      method:'POST',
      body:JSON.stringify({keyVersion:1,envelopes})
    });
    await saveChatKey(prepared.chatId,1,key,pin);
    return {chatId:prepared.chatId,keyVersion:1};
  }catch(error){
    if(error instanceof Error&&error.message==='chat_keys_already_initialized'){
      return restoreCurrentChatKey(prepared.chatId,pin);
    }
    throw error;
  }
}
