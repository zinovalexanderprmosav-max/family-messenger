import { decryptMessagePayload, encryptMessagePayload } from '@family-messenger/crypto';
import type { EncryptedMessageEnvelope,StoredMessageEnvelope } from '@family-messenger/protocol';
import { api } from '../api/client.js';
import { getDb,type OutboxAttachmentItem,type OutboxItem,type OutboxTextItem } from '../local/db.js';
import { loadChatKey } from '../local/keystore.js';
import { loadProfile } from '../local/session.js';
import { prepareAttachmentFile,uploadEncryptedAttachment } from './attachments.js';
import { rotateChatKey, syncCurrentChatKey } from './key-rotation.js';

export type DeliveryStatus='queued'|'sending'|'failed'|'sent';
type VisibleBase={
  messageId:string;sentAt:string;senderDeviceId:string;sequence:string;chatId:string;deliveryStatus?:DeliveryStatus;
};
export type VisibleTextMessage=VisibleBase&{kind:'text';text:string};
export type VisibleAttachmentMessage=VisibleBase&{
  kind:'attachment';attachmentId:string;attachmentKey:string;fileName:string;mimeType:string;
  size:number;mediaKind:'image'|'video'|'audio'|'file';localBlob?:Blob;
};
export type VisibleMessage=VisibleTextMessage|VisibleAttachmentMessage;

async function persist(items:StoredMessageEnvelope[]){
  const db=await getDb();const tx=db.transaction('messages','readwrite');
  for(const item of items)await tx.store.put(item);await tx.done;
}

async function keyForEnvelope(chatId:string,pin:string,item:EncryptedMessageEnvelope){
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

async function visibleFromEnvelope(item:StoredMessageEnvelope|EncryptedMessageEnvelope,pin:string,status:DeliveryStatus='sent'):Promise<VisibleMessage>{
  const key=await keyForEnvelope(item.chatId,pin,item);
  const payload=await decryptMessagePayload(item,key.key);
  const base={
    messageId:item.messageId,sentAt:payload.sentAt,senderDeviceId:item.senderDeviceId,
    sequence:'sequence' in item?item.sequence:`local-${payload.sentAt}-${item.messageId}`,
    chatId:item.chatId,deliveryStatus:status
  };
  if(payload.kind==='text')return {...base,kind:'text',text:payload.text};
  return {
    ...base,kind:'attachment',attachmentId:payload.attachmentId,attachmentKey:payload.attachmentKey,
    fileName:payload.fileName,mimeType:payload.mimeType,size:payload.size,mediaKind:payload.mediaKind
  };
}

function isNetworkError(error:unknown){
  if(typeof navigator!=='undefined'&&navigator.onLine===false)return true;
  return error instanceof TypeError
    ||(error instanceof Error&&/Failed to fetch|NetworkError|Load failed|fetch/i.test(error.message));
}

async function putOutbox(item:OutboxItem){const db=await getDb();await db.put('outbox',item);}
async function deleteOutbox(messageId:string){const db=await getDb();await db.delete('outbox',messageId);}

async function postEnvelope(envelope:EncryptedMessageEnvelope){
  return api<StoredMessageEnvelope>(`/v1/chats/${envelope.chatId}/messages`,{
    method:'POST',body:JSON.stringify(envelope)
  });
}

async function reencryptAfterRotation(item:OutboxTextItem,pin:string){
  const old=await loadChatKey(item.chatId,pin,item.envelope.keyVersion);
  const payload=await decryptMessagePayload(item.envelope,old.key);
  if(payload.kind!=='text')throw new Error('invalid_message_payload');
  await rotateChatKey(item.chatId,pin);
  const current=await loadChatKey(item.chatId,pin);
  const envelope=await encryptMessagePayload({
    messageId:item.messageId,chatId:item.chatId,senderDeviceId:item.envelope.senderDeviceId,
    keyVersion:current.keyVersion,key:current.key,payload
  });
  const next={...item,envelope};
  await putOutbox(next);
  return next;
}

async function sendTextOutbox(item:OutboxTextItem,pin:string){
  let current=item;
  try{
    const stored=await postEnvelope(current.envelope);
    await persist([stored]);await deleteOutbox(item.messageId);
    const visible=await visibleFromEnvelope(stored,pin,'sent');
    if(visible.kind!=='text')throw new Error('invalid_message_payload');
    return visible;
  }catch(error){
    if(error instanceof Error&&error.message==='key_rotation_required'){
      current=await reencryptAfterRotation(current,pin);
      const stored=await postEnvelope(current.envelope);
      await persist([stored]);await deleteOutbox(item.messageId);
      const visible=await visibleFromEnvelope(stored,pin,'sent');
      if(visible.kind!=='text')throw new Error('invalid_message_payload');
      return visible;
    }
    throw error;
  }
}

async function ensureAttachmentPrepared(item:OutboxAttachmentItem,pin:string){
  if(item.attachment)return item;
  const file=new File([item.bytes],item.fileName,{type:item.mimeType,lastModified:Date.now()});
  let attachment;
  try{attachment=await uploadEncryptedAttachment(file,item.chatId);}
  catch(error){
    if(!(error instanceof Error)||error.message!=='key_rotation_required')throw error;
    await rotateChatKey(item.chatId,pin);
    attachment=await uploadEncryptedAttachment(file,item.chatId);
  }
  const next={...item,attachment};
  await putOutbox(next);
  return next;
}

async function ensureAttachmentEnvelope(item:OutboxAttachmentItem,pin:string,deviceId:string){
  const prepared=await ensureAttachmentPrepared(item,pin);
  if(prepared.envelope)return prepared;
  const current=await loadChatKey(item.chatId,pin);
  const envelope=await encryptMessagePayload({
    messageId:item.messageId,chatId:item.chatId,senderDeviceId:deviceId,keyVersion:current.keyVersion,key:current.key,
    payload:{kind:'attachment',...prepared.attachment!,sentAt:item.sentAt}
  });
  const next={...prepared,envelope};
  await putOutbox(next);
  return next;
}

async function sendAttachmentOutbox(item:OutboxAttachmentItem,pin:string,deviceId:string){
  let current=await ensureAttachmentEnvelope(item,pin,deviceId);
  try{
    const stored=await postEnvelope(current.envelope!);
    await persist([stored]);await deleteOutbox(item.messageId);
    const visible=await visibleFromEnvelope(stored,pin,'sent');
    if(visible.kind!=='attachment')throw new Error('invalid_message_payload');
    return visible;
  }catch(error){
    if(error instanceof Error&&error.message==='key_rotation_required'){
      const old=await loadChatKey(item.chatId,pin,current.envelope!.keyVersion);
      const payload=await decryptMessagePayload(current.envelope!,old.key);
      if(payload.kind!=='attachment')throw new Error('invalid_message_payload');
      await rotateChatKey(item.chatId,pin);
      const key=await loadChatKey(item.chatId,pin);
      const envelope=await encryptMessagePayload({
        messageId:item.messageId,chatId:item.chatId,senderDeviceId:deviceId,
        keyVersion:key.keyVersion,key:key.key,payload
      });
      current={...current,envelope};await putOutbox(current);
      const stored=await postEnvelope(envelope);
      await persist([stored]);await deleteOutbox(item.messageId);
      const visible=await visibleFromEnvelope(stored,pin,'sent');
      if(visible.kind!=='attachment')throw new Error('invalid_message_payload');
      return visible;
    }
    throw error;
  }
}

async function markRetry(item:OutboxItem,error:unknown){
  const next:OutboxItem={...item,status:isNetworkError(error)?'queued':'failed',attempts:item.attempts+1,lastError:error instanceof Error?error.message:'Ошибка отправки'};
  await putOutbox(next);return next;
}

export async function sendTextMessage(text:string,pin:string,chatId?:string){
  const profile=await loadProfile();if(!profile||profile.status!=='active')throw new Error('active_profile_required');
  const targetChatId=chatId??profile.familyChatId;
  const current=await loadChatKey(targetChatId,pin);
  const sentAt=new Date().toISOString();
  const messageId=crypto.randomUUID();
  const envelope=await encryptMessagePayload({
    messageId,chatId:targetChatId,senderDeviceId:profile.deviceId,keyVersion:current.keyVersion,key:current.key,
    payload:{kind:'text',text,sentAt}
  });
  let item:OutboxTextItem={messageId,chatId:targetChatId,kind:'text',envelope,sentAt,status:'sending',attempts:0};
  await putOutbox(item);
  try{return await sendTextOutbox(item,pin);}
  catch(error){
    item=await markRetry(item,error) as OutboxTextItem;
    if(!isNetworkError(error)&&!(error instanceof Error&&error.message==='key_rotation_required'))throw error;
    const visible=await visibleFromEnvelope(item.envelope,pin,item.status);
    if(visible.kind!=='text')throw new Error('invalid_message_payload');
    return visible;
  }
}

export async function sendAttachmentMessage(file:File,pin:string,chatId?:string){
  const profile=await loadProfile();if(!profile||profile.status!=='active')throw new Error('active_profile_required');
  const targetChatId=chatId??profile.familyChatId;
  const prepared=await prepareAttachmentFile(file);
  let item:OutboxAttachmentItem={
    messageId:crypto.randomUUID(),chatId:targetChatId,kind:'attachment',
    bytes:await prepared.arrayBuffer(),fileName:prepared.name||'file',mimeType:prepared.type||'application/octet-stream',
    sentAt:new Date().toISOString(),status:'sending',attempts:0
  };
  await putOutbox(item);
  try{return await sendAttachmentOutbox(item,pin,profile.deviceId);}
  catch(error){
    item=await markRetry(item,error) as OutboxAttachmentItem;
    if(!isNetworkError(error)&&!(error instanceof Error&&error.message==='key_rotation_required'))throw error;
    return {
      messageId:item.messageId,chatId:item.chatId,senderDeviceId:profile.deviceId,
      sequence:`local-${item.sentAt}-${item.messageId}`,sentAt:item.sentAt,kind:'attachment' as const,
      attachmentId:item.attachment?.attachmentId??'',attachmentKey:item.attachment?.attachmentKey??'',
      fileName:item.fileName,mimeType:item.mimeType,size:item.bytes.byteLength,
      mediaKind:item.mimeType.startsWith('image/')?'image':item.mimeType.startsWith('video/')?'video':item.mimeType.startsWith('audio/')?'audio':'file',
      localBlob:new Blob([item.bytes],{type:item.mimeType}),deliveryStatus:item.status
    };
  }
}

export async function flushOutbox(pin:string,chatId?:string){
  const profile=await loadProfile();if(!profile||profile.status!=='active')return;
  const db=await getDb();
  const items=chatId?await db.getAllFromIndex('outbox','chatId',chatId):await db.getAll('outbox');
  items.sort((a,b)=>a.sentAt.localeCompare(b.sentAt));
  for(const original of items){
    const sending={...original,status:'sending' as const};await putOutbox(sending);
    try{
      if(sending.kind==='text')await sendTextOutbox(sending,pin);
      else await sendAttachmentOutbox(sending,pin,profile.deviceId);
    }catch(error){await markRetry(sending,error);}
  }
}

async function visibleOutbox(chatId:string,pin:string,deviceId:string){
  const db=await getDb();const items=await db.getAllFromIndex('outbox','chatId',chatId);
  const out:VisibleMessage[]=[];
  for(const item of items){
    if(item.kind==='text'){
      out.push(await visibleFromEnvelope(item.envelope,pin,item.status));
    }else{
      out.push({
        messageId:item.messageId,chatId:item.chatId,senderDeviceId:deviceId,
        sequence:`local-${item.sentAt}-${item.messageId}`,sentAt:item.sentAt,kind:'attachment',
        attachmentId:item.attachment?.attachmentId??'',attachmentKey:item.attachment?.attachmentKey??'',
        fileName:item.fileName,mimeType:item.mimeType,size:item.bytes.byteLength,
        mediaKind:item.mimeType.startsWith('image/')?'image':item.mimeType.startsWith('video/')?'video':item.mimeType.startsWith('audio/')?'audio':'file',
        localBlob:new Blob([item.bytes],{type:item.mimeType}),deliveryStatus:item.status
      });
    }
  }
  return out;
}

export async function reconcileChat(chatId:string,pin:string){
  await flushOutbox(pin,chatId);
  const db=await getDb();const cursor=(await db.get('sync',chatId))?.cursor??'0';
  const result=await api<{items:StoredMessageEnvelope[];nextCursor:string}>(`/v1/chats/${chatId}/messages?after=${encodeURIComponent(cursor)}&limit=100`);
  await persist(result.items);await db.put('sync',{chatId,cursor:result.nextCursor});
  const visible:VisibleMessage[]=[];
  for(const item of result.items)visible.push(await visibleFromEnvelope(item,pin,'sent'));
  return visible;
}

export async function readLocalVisibleMessages(chatId:string,pin:string){
  const profile=await loadProfile();if(!profile)return[];
  const db=await getDb();const items=await db.getAllFromIndex('messages','chatId',chatId);
  const out:VisibleMessage[]=[];
  for(const item of items)out.push(await visibleFromEnvelope(item,pin,'sent'));
  out.push(...await visibleOutbox(chatId,pin,profile.deviceId));
  out.sort((a,b)=>a.sentAt.localeCompare(b.sentAt)||a.messageId.localeCompare(b.messageId));
  return out;
}
