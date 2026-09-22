import { decryptMessagePayload, encryptMessagePayload } from '@family-messenger/crypto';
import type { StoredMessageEnvelope } from '@family-messenger/protocol';
import { api } from '../api/client.js';
import { getDb } from '../local/db.js';
import { loadChatKey } from '../local/keystore.js';
import { loadProfile } from '../local/session.js';
import { uploadEncryptedAttachment } from './attachments.js';
import { rotateChatKey, syncCurrentChatKey } from './key-rotation.js';

type VisibleBase={messageId:string;sentAt:string;senderDeviceId:string;sequence:string;chatId:string};
export type VisibleTextMessage=VisibleBase&{kind:'text';text:string};
export type VisibleAttachmentMessage=VisibleBase&{
  kind:'attachment';attachmentId:string;attachmentKey:string;fileName:string;mimeType:string;
  size:number;mediaKind:'image'|'video'|'audio'|'file';
};
export type VisibleMessage=VisibleTextMessage|VisibleAttachmentMessage;

async function persist(items:StoredMessageEnvelope[]){
  const db=await getDb();const tx=db.transaction('messages','readwrite');
  for(const item of items)await tx.store.put(item);await tx.done;
}

async function keyForEnvelope(chatId:string,pin:string,item:StoredMessageEnvelope){
  try{return await loadChatKey(chatId,pin,item.keyVersion);}
  catch(error){
    const current=await loadChatKey(chatId,pin).catch(()=>null);
    if(!current||item.keyVersion>current.keyVersion){
      await syncCurrentChatKey(chatId,pin);
      return loadChatKey(chatId,pin,item.keyVersion);
    }
    throw error;
  }
}

async function visibleFromEnvelope(item:StoredMessageEnvelope,pin:string):Promise<VisibleMessage>{
  const key=await keyForEnvelope(item.chatId,pin,item);
  const payload=await decryptMessagePayload(item,key.key);
  const base={messageId:item.messageId,sentAt:payload.sentAt,senderDeviceId:item.senderDeviceId,sequence:item.sequence,chatId:item.chatId};
  if(payload.kind==='text')return {...base,kind:'text',text:payload.text};
  return {
    ...base,kind:'attachment',attachmentId:payload.attachmentId,attachmentKey:payload.attachmentKey,
    fileName:payload.fileName,mimeType:payload.mimeType,size:payload.size,mediaKind:payload.mediaKind
  };
}

async function sendTextOnce(text:string,pin:string,targetChatId:string,deviceId:string){
  const current=await loadChatKey(targetChatId,pin);
  const envelope=await encryptMessagePayload({
    messageId:crypto.randomUUID(),chatId:targetChatId,senderDeviceId:deviceId,keyVersion:current.keyVersion,key:current.key,
    payload:{kind:'text',text,sentAt:new Date().toISOString()}
  });
  const stored=await api<StoredMessageEnvelope>(`/v1/chats/${targetChatId}/messages`,{method:'POST',body:JSON.stringify(envelope)});
  await persist([stored]);const visible=await visibleFromEnvelope(stored,pin);if(visible.kind!=='text')throw new Error('invalid_message_payload');return visible;
}

export async function sendTextMessage(text:string,pin:string,chatId?:string){
  const profile=await loadProfile();if(!profile||profile.status!=='active')throw new Error('active_profile_required');
  const targetChatId=chatId??profile.familyChatId;
  try{return await sendTextOnce(text,pin,targetChatId,profile.deviceId);}
  catch(error){
    if(!(error instanceof Error)||error.message!=='key_rotation_required')throw error;
    await rotateChatKey(targetChatId,pin);
    return sendTextOnce(text,pin,targetChatId,profile.deviceId);
  }
}

async function uploadWithRotationRecovery(file:File,chatId:string,pin:string){
  try{return await uploadEncryptedAttachment(file,chatId);}
  catch(error){
    if(!(error instanceof Error)||error.message!=='key_rotation_required')throw error;
    await rotateChatKey(chatId,pin);
    return uploadEncryptedAttachment(file,chatId);
  }
}

async function sendAttachmentReferenceOnce(input:{
  targetChatId:string;deviceId:string;pin:string;
  attachment:Awaited<ReturnType<typeof uploadEncryptedAttachment>>;
  sentAt:string;
}){
  const current=await loadChatKey(input.targetChatId,input.pin);
  const envelope=await encryptMessagePayload({
    messageId:crypto.randomUUID(),chatId:input.targetChatId,senderDeviceId:input.deviceId,
    keyVersion:current.keyVersion,key:current.key,
    payload:{kind:'attachment',...input.attachment,sentAt:input.sentAt}
  });
  const stored=await api<StoredMessageEnvelope>(`/v1/chats/${input.targetChatId}/messages`,{
    method:'POST',body:JSON.stringify(envelope)
  });
  await persist([stored]);const visible=await visibleFromEnvelope(stored,input.pin);if(visible.kind!=='attachment')throw new Error('invalid_message_payload');return visible;
}

export async function sendAttachmentMessage(file:File,pin:string,chatId?:string){
  const profile=await loadProfile();if(!profile||profile.status!=='active')throw new Error('active_profile_required');
  const targetChatId=chatId??profile.familyChatId;
  const attachment=await uploadWithRotationRecovery(file,targetChatId,pin);
  const sentAt=new Date().toISOString();
  try{return await sendAttachmentReferenceOnce({targetChatId,deviceId:profile.deviceId,pin,attachment,sentAt});}
  catch(error){
    if(!(error instanceof Error)||error.message!=='key_rotation_required')throw error;
    await rotateChatKey(targetChatId,pin);
    return sendAttachmentReferenceOnce({targetChatId,deviceId:profile.deviceId,pin,attachment,sentAt});
  }
}

export async function reconcileChat(chatId:string,pin:string){
  const db=await getDb();const cursor=(await db.get('sync',chatId))?.cursor??'0';
  const result=await api<{items:StoredMessageEnvelope[];nextCursor:string}>(`/v1/chats/${chatId}/messages?after=${encodeURIComponent(cursor)}&limit=100`);
  await persist(result.items);await db.put('sync',{chatId,cursor:result.nextCursor});
  const visible:VisibleMessage[]=[];
  for(const item of result.items)visible.push(await visibleFromEnvelope(item,pin));
  return visible;
}

export async function readLocalVisibleMessages(chatId:string,pin:string){
  const db=await getDb();const items=await db.getAllFromIndex('messages','chatId',chatId);
  items.sort((a,b)=>{const av=BigInt(a.sequence),bv=BigInt(b.sequence);return av<bv?-1:av>bv?1:0;});
  const out:VisibleMessage[]=[];
  for(const item of items)out.push(await visibleFromEnvelope(item,pin));
  return out;
}
