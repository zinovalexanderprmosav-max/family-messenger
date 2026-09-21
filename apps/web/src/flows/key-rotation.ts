import {fromBase64,generateConversationKey,openConversationKey,sealConversationKey} from '@family-messenger/crypto';
import {KeyRotationStatusResponseSchema,type CompleteKeyRotationRequest,type KeyRotationStatusResponse} from '@family-messenger/protocol';
import {api} from '../api/client.js';
import {loadChatKey,saveChatKey,unlockDeviceProfile} from '../local/keystore.js';
import {rotateChatKeyCore} from './key-rotation-core.js';

function isDeviceSetChanged(error:unknown){return error instanceof Error&&error.message==='device_key_set_changed';}

async function rotateOnce(chatId:string,pin:string){
  return rotateChatKeyCore(chatId,{
    getStatus:async id=>KeyRotationStatusResponseSchema.parse(await api<KeyRotationStatusResponse>(`/v1/chats/${id}/key-rotation`)),
    generateKey:generateConversationKey,
    sealKey:(key,publicKey)=>sealConversationKey(key,fromBase64(publicKey)),
    submit:(id,request:CompleteKeyRotationRequest)=>api<void>(`/v1/chats/${id}/key-rotation`,{method:'POST',body:JSON.stringify(request)}),
    save:(id,keyVersion,key)=>saveChatKey(id,keyVersion,key,pin),
    currentVersion:async id=>(await loadChatKey(id,pin)).keyVersion
  });
}

export async function rotateChatKey(chatId:string,pin:string):Promise<{keyVersion:number}>{
  try{
    const result=await rotateOnce(chatId,pin);
    return {keyVersion:result.keyVersion};
  }catch(error){
    if(!isDeviceSetChanged(error))throw error;
    const result=await rotateOnce(chatId,pin);
    return {keyVersion:result.keyVersion};
  }
}

export async function syncCurrentChatKey(chatId:string,pin:string){
  const envelope=await api<{keyVersion:number;sealedKeyEnvelope:string}>(`/v1/keys/chat/${chatId}/current`);
  const existing=await loadChatKey(chatId,pin).catch(()=>null);
  if(existing&&existing.keyVersion>=envelope.keyVersion)return existing;
  const plain=await unlockDeviceProfile(pin);
  const key=await openConversationKey(envelope.sealedKeyEnvelope,fromBase64(plain.encryptionPublicKey),fromBase64(plain.encryptionPrivateKey));
  await saveChatKey(chatId,envelope.keyVersion,key,pin);
  return {keyVersion:envelope.keyVersion,key};
}
