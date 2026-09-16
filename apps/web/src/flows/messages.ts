import { decryptTextMessage, encryptTextMessage } from '@family-messenger/crypto';
import type { StoredMessageEnvelope } from '@family-messenger/protocol';
import { api } from '../api/client.js';
import { getDb } from '../local/db.js';
import { loadChatKey } from '../local/keystore.js';
import { enqueueOutbox, listOutbox, markOutboxQueued, markOutboxSending, removeOutbox } from '../local/outbox.js';
import { loadProfile } from '../local/session.js';

export type SendState='queued'|'sending'|'sent';
export type VisibleMessage={messageId:string;text:string;sentAt:string;senderDeviceId:string;sequence?:string;sendState:SendState};

async function persist(items:StoredMessageEnvelope[]){const db=await getDb();const tx=db.transaction('messages','readwrite');for(const item of items)await tx.store.put(item);await tx.done;}

let flushPromise:Promise<void>|null=null;
async function flushOutboxInner(chatId:string){
  while(true){
    const [item]=await listOutbox(chatId);if(!item)return;
    await markOutboxSending(item.messageId,new Date().toISOString());
    try{
      const stored=await api<StoredMessageEnvelope>(`/v1/chats/${chatId}/messages`,{method:'POST',body:JSON.stringify(item.envelope)});
      await persist([stored]);
      await removeOutbox(item.messageId);
    }catch(error){
      await markOutboxQueued(item.messageId);
      if(error instanceof TypeError)return;
      throw error;
    }
  }
}
export function flushOutbox(chatId:string,pin:string){
  void pin;
  if(flushPromise)return flushPromise;
  flushPromise=flushOutboxInner(chatId).finally(()=>{flushPromise=null;});
  return flushPromise;
}

export async function sendTextMessage(text:string,pin:string):Promise<VisibleMessage>{
  const profile=await loadProfile();if(!profile||profile.status!=='active')throw new Error('active_profile_required');
  const current=await loadChatKey(profile.familyChatId,pin);
  const messageId=crypto.randomUUID();const sentAt=new Date().toISOString();
  const envelope=await encryptTextMessage({messageId,chatId:profile.familyChatId,senderDeviceId:profile.deviceId,keyVersion:current.keyVersion,key:current.key,payload:{kind:'text',text,sentAt}});
  await enqueueOutbox({messageId,chatId:profile.familyChatId,senderDeviceId:profile.deviceId,envelope,createdAt:sentAt,state:'queued',attemptCount:0});
  if(typeof navigator==='undefined'||navigator.onLine!==false)await flushOutbox(profile.familyChatId,pin);
  const visible=await readLocalVisibleMessages(profile.familyChatId,pin);const result=visible.find(item=>item.messageId===messageId);if(!result)throw new Error('local_message_missing');return result;
}

export async function reconcileChat(chatId:string,pin:string){
  const db=await getDb();const cursor=(await db.get('sync',chatId))?.cursor??'0';
  const result=await api<{items:StoredMessageEnvelope[];nextCursor:string}>(`/v1/chats/${chatId}/messages?after=${encodeURIComponent(cursor)}&limit=100`);
  await persist(result.items);await db.put('sync',{chatId,cursor:result.nextCursor});
  const current=await loadChatKey(chatId,pin);const visible:VisibleMessage[]=[];
  for(const item of result.items){const payload=await decryptTextMessage(item,current.key);visible.push({messageId:item.messageId,text:payload.text,sentAt:payload.sentAt,senderDeviceId:item.senderDeviceId,sequence:item.sequence,sendState:'sent'});}
  return visible;
}

export async function readLocalVisibleMessages(chatId:string,pin:string){
  const db=await getDb();const items=await db.getAllFromIndex('messages','chatId',chatId);
  items.sort((a,b)=>{const av=BigInt(a.sequence),bv=BigInt(b.sequence);return av<bv?-1:av>bv?1:0;});
  const current=await loadChatKey(chatId,pin);const confirmed:VisibleMessage[]=[];const confirmedIds=new Set<string>();
  for(const item of items){const payload=await decryptTextMessage(item,current.key);confirmedIds.add(item.messageId);confirmed.push({messageId:item.messageId,text:payload.text,sentAt:payload.sentAt,senderDeviceId:item.senderDeviceId,sequence:item.sequence,sendState:'sent'});}
  const pending:VisibleMessage[]=[];
  for(const item of await listOutbox(chatId)){if(confirmedIds.has(item.messageId))continue;const payload=await decryptTextMessage(item.envelope,current.key);pending.push({messageId:item.messageId,text:payload.text,sentAt:payload.sentAt,senderDeviceId:item.senderDeviceId,sendState:item.state});}
  return [...confirmed,...pending];
}
