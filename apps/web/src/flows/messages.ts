import { decryptMessagePayload, encryptMessagePayload } from '@family-messenger/crypto';
import type { EncryptedMessageEnvelope,StoredMessageEnvelope } from '@family-messenger/protocol';
import { api } from '../api/client.js';
import { getDb,type OutboxAttachmentItem,type OutboxItem,type OutboxTextItem } from '../local/db.js';
import { loadChatKey } from '../local/keystore.js';
import { loadProfile } from '../local/session.js';
import { prepareAttachmentFile,uploadEncryptedAttachment } from './attachments.js';
import { rotateChatKey, syncCurrentChatKey } from './key-rotation.js';

export type DeliveryStatus='queued'|'sending'|'failed'|'sent';
export type ReplyReference={messageId:string;preview:string};
export type VisibleReaction={emoji:string;senderDeviceIds:string[]};
type VisibleBase={
  messageId:string;sentAt:string;senderDeviceId:string;sequence:string;chatId:string;
  deliveryStatus?:DeliveryStatus;editedAt?:string;replyTo?:ReplyReference;reactions?:VisibleReaction[];
};
export type VisibleTextMessage=VisibleBase&{kind:'text';text:string};
export type VisibleAttachmentMessage=VisibleBase&{
  kind:'attachment';attachmentId:string;attachmentKey:string;fileName:string;mimeType:string;
  size:number;mediaKind:'image'|'video'|'audio'|'file';localBlob?:Blob;
};
export type VisibleDeletedMessage=VisibleBase&{kind:'deleted';deletedAt:string};
export type VisibleMessage=VisibleTextMessage|VisibleAttachmentMessage|VisibleDeletedMessage;

type DecryptedMutation={
  kind:'mutation';mutationKind:'edit'|'delete'|'reaction';targetMessageId:string;text?:string;emoji?:string;
  action?:'add'|'remove';actorDeviceId:string;mutatedAt:string;sequence:string;
};
type DecryptedEvent={kind:'message';message:VisibleMessage}|DecryptedMutation;

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

async function decryptEvent(item:StoredMessageEnvelope|EncryptedMessageEnvelope,pin:string,status:DeliveryStatus='sent'):Promise<DecryptedEvent>{
  const key=await keyForEnvelope(item.chatId,pin,item);
  const payload=await decryptMessagePayload(item,key.key);
  const sequence='sequence' in item?item.sequence:`local-${payload.sentAt}-${item.messageId}`;

  if(item.mutation){
    if(item.mutation.kind==='edit'&&payload.kind==='edit'){
      return {kind:'mutation',mutationKind:'edit',targetMessageId:item.mutation.targetMessageId,text:payload.text,actorDeviceId:item.senderDeviceId,mutatedAt:payload.sentAt,sequence};
    }
    if(item.mutation.kind==='delete'&&payload.kind==='delete'){
      return {kind:'mutation',mutationKind:'delete',targetMessageId:item.mutation.targetMessageId,actorDeviceId:item.senderDeviceId,mutatedAt:payload.sentAt,sequence};
    }
    if(item.mutation.kind==='reaction'&&payload.kind==='reaction'){
      return {kind:'mutation',mutationKind:'reaction',targetMessageId:item.mutation.targetMessageId,emoji:payload.emoji,action:payload.action,actorDeviceId:item.senderDeviceId,mutatedAt:payload.sentAt,sequence};
    }
    throw new Error('invalid_message_mutation');
  }

  const base={
    messageId:item.messageId,sentAt:payload.sentAt,senderDeviceId:item.senderDeviceId,
    sequence,chatId:item.chatId,deliveryStatus:status,reactions:[],
    ...(('replyTo' in payload&&payload.replyTo)?{replyTo:payload.replyTo}:{})
  };
  if(payload.kind==='text')return {kind:'message',message:{...base,kind:'text',text:payload.text}};
  if(payload.kind==='attachment')return {kind:'message',message:{
    ...base,kind:'attachment',attachmentId:payload.attachmentId,attachmentKey:payload.attachmentKey,
    fileName:payload.fileName,mimeType:payload.mimeType,size:payload.size,mediaKind:payload.mediaKind
  }};
  throw new Error('invalid_message_payload');
}

async function visibleFromEnvelope(item:StoredMessageEnvelope|EncryptedMessageEnvelope,pin:string,status:DeliveryStatus='sent'):Promise<VisibleMessage>{
  const event=await decryptEvent(item,pin,status);
  if(event.kind!=='message')throw new Error('invalid_message_payload');
  return event.message;
}

async function applyStoredEvents(items:StoredMessageEnvelope[],pin:string){
  const ordered=[...items].sort((a,b)=>{
    const left=BigInt(a.sequence),right=BigInt(b.sequence);
    return left<right?-1:left>right?1:0;
  });
  const byId=new Map<string,VisibleMessage>();
  for(const item of ordered){
    const event=await decryptEvent(item,pin,'sent');
    if(event.kind==='message'){
      byId.set(event.message.messageId,event.message);
      continue;
    }
    const target=byId.get(event.targetMessageId);
    if(!target)continue;
    if(event.mutationKind==='edit'){
      if(target.kind==='text'&&typeof event.text==='string'){
        byId.set(target.messageId,{...target,text:event.text,editedAt:event.mutatedAt});
      }
      continue;
    }
    if(event.mutationKind==='reaction'){
      if(target.kind==='deleted'||!event.emoji||!event.action)continue;
      const reactions=(target.reactions??[]).map(reaction=>({emoji:reaction.emoji,senderDeviceIds:[...reaction.senderDeviceIds]}));
      const existing=reactions.find(reaction=>reaction.emoji===event.emoji);
      if(event.action==='add'){
        if(existing){
          if(!existing.senderDeviceIds.includes(event.actorDeviceId))existing.senderDeviceIds.push(event.actorDeviceId);
        }else reactions.push({emoji:event.emoji,senderDeviceIds:[event.actorDeviceId]});
      }else if(existing){
        existing.senderDeviceIds=existing.senderDeviceIds.filter(id=>id!==event.actorDeviceId);
      }
      byId.set(target.messageId,{...target,reactions:reactions.filter(reaction=>reaction.senderDeviceIds.length>0)});
      continue;
    }
    byId.set(target.messageId,{
      messageId:target.messageId,chatId:target.chatId,senderDeviceId:target.senderDeviceId,
      sequence:target.sequence,sentAt:target.sentAt,deliveryStatus:'sent',kind:'deleted',deletedAt:event.mutatedAt
    });
  }
  return [...byId.values()];
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

export async function sendTextMessage(text:string,pin:string,chatId?:string,replyTo?:ReplyReference){
  const profile=await loadProfile();if(!profile||profile.status!=='active')throw new Error('active_profile_required');
  const targetChatId=chatId??profile.familyChatId;
  const current=await loadChatKey(targetChatId,pin);
  const sentAt=new Date().toISOString();
  const messageId=crypto.randomUUID();
  const envelope=await encryptMessagePayload({
    messageId,chatId:targetChatId,senderDeviceId:profile.deviceId,keyVersion:current.keyVersion,key:current.key,
    payload:{kind:'text',text,sentAt,...(replyTo?{replyTo}:{})}
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

async function sendMutation(input:{chatId:string;targetMessageId:string;kind:'edit'|'delete'|'reaction';text?:string;emoji?:string;action?:'add'|'remove'},pin:string){
  const profile=await loadProfile();if(!profile||profile.status!=='active')throw new Error('active_profile_required');
  const sentAt=new Date().toISOString();
  const send=async()=>{
    const current=await loadChatKey(input.chatId,pin);
    const envelope=await encryptMessagePayload({
      messageId:crypto.randomUUID(),chatId:input.chatId,senderDeviceId:profile.deviceId,
      keyVersion:current.keyVersion,key:current.key,
      payload:input.kind==='edit'
        ?{kind:'edit',text:input.text??'',sentAt}
        :input.kind==='reaction'
          ?{kind:'reaction',emoji:input.emoji??'',action:input.action??'add',sentAt}
          :{kind:'delete',sentAt},
      mutation:{kind:input.kind,targetMessageId:input.targetMessageId}
    });
    const stored=await postEnvelope(envelope);
    await persist([stored]);
    return stored;
  };
  try{return await send();}
  catch(error){
    if(error instanceof Error&&error.message==='key_rotation_required'){
      await rotateChatKey(input.chatId,pin);
      return send();
    }
    throw error;
  }
}

export async function editTextMessage(chatId:string,targetMessageId:string,text:string,pin:string){
  const normalized=text.trim();if(!normalized)throw new Error('message_text_required');
  return sendMutation({chatId,targetMessageId,kind:'edit',text:normalized},pin);
}

export async function deleteMessage(chatId:string,targetMessageId:string,pin:string){
  return sendMutation({chatId,targetMessageId,kind:'delete'},pin);
}

export async function reactToMessage(chatId:string,targetMessageId:string,emoji:string,action:'add'|'remove',pin:string){
  if(!emoji.trim())throw new Error('reaction_required');
  return sendMutation({chatId,targetMessageId,kind:'reaction',emoji,action},pin);
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
  return readLocalVisibleMessages(chatId,pin);
}

export async function readLocalVisibleMessages(chatId:string,pin:string){
  const profile=await loadProfile();if(!profile)return[];
  const db=await getDb();const items=await db.getAllFromIndex('messages','chatId',chatId);
  const out=await applyStoredEvents(items,pin);
  out.push(...await visibleOutbox(chatId,pin,profile.deviceId));
  out.sort((a,b)=>a.sentAt.localeCompare(b.sentAt)||a.messageId.localeCompare(b.messageId));
  return out;
}
