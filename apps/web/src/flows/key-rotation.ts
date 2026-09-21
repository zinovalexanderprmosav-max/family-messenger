import {fromBase64,generateConversationKey,sealConversationKey} from '@family-messenger/crypto';
import {KeyRotationStatusResponseSchema,type CompleteKeyRotationRequest,type KeyRotationStatusResponse} from '@family-messenger/protocol';
import {api} from '../api/client.js';
import {loadChatKey,saveChatKey} from '../local/keystore.js';
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
