import { openDB, type DBSchema } from 'idb';
import type { EncryptedKeystoreBlob } from '@family-messenger/crypto';
import type { EncryptedMessageEnvelope,StoredMessageEnvelope } from '@family-messenger/protocol';

export type LocalProfile={familyId:string;memberId:string;deviceId:string;familyChatId:string;status:'pending_key'|'active';csrfToken:string;memberDisplayName:string;familyDisplayName?:string};
export type OutboxStatus='queued'|'sending'|'failed';
export type OutboxTextItem={
  messageId:string;chatId:string;kind:'text';envelope:EncryptedMessageEnvelope;sentAt:string;
  status:OutboxStatus;attempts:number;lastError?:string;
};
export type OutboxAttachmentRef={
  attachmentId:string;attachmentKey:string;fileName:string;mimeType:string;size:number;mediaKind:'image'|'video'|'audio'|'file';
};
export type OutboxAttachmentItem={
  messageId:string;chatId:string;kind:'attachment';bytes:ArrayBuffer;fileName:string;mimeType:string;sentAt:string;
  status:OutboxStatus;attempts:number;lastError?:string;attachment?:OutboxAttachmentRef;envelope?:EncryptedMessageEnvelope;
};
export type OutboxItem=OutboxTextItem|OutboxAttachmentItem;

interface FamilyDb extends DBSchema{
  keystore:{key:string;value:{id:'device';blob:EncryptedKeystoreBlob}};
  profile:{key:string;value:{id:'current';profile:LocalProfile}};
  messages:{key:string;value:StoredMessageEnvelope;indexes:{chatId:string;sequence:string}};
  sync:{key:string;value:{chatId:string;cursor:string}};
  outbox:{key:string;value:OutboxItem;indexes:{chatId:string;status:OutboxStatus}};
}
let dbPromise:ReturnType<typeof openDB<FamilyDb>>|undefined;
export function getDb(){
  dbPromise??=openDB<FamilyDb>('family-messenger',2,{upgrade(db){
    if(!db.objectStoreNames.contains('keystore'))db.createObjectStore('keystore',{keyPath:'id'});
    if(!db.objectStoreNames.contains('profile'))db.createObjectStore('profile',{keyPath:'id'});
    if(!db.objectStoreNames.contains('messages')){
      const messages=db.createObjectStore('messages',{keyPath:'messageId'});
      messages.createIndex('chatId','chatId');messages.createIndex('sequence','sequence');
    }
    if(!db.objectStoreNames.contains('sync'))db.createObjectStore('sync',{keyPath:'chatId'});
    if(!db.objectStoreNames.contains('outbox')){
      const outbox=db.createObjectStore('outbox',{keyPath:'messageId'});
      outbox.createIndex('chatId','chatId');outbox.createIndex('status','status');
    }
  }});
  return dbPromise;
}
export function resetDbHandleForTests(){dbPromise=undefined;}
export async function clearLocalData(){
  const db=await getDb();const tx=db.transaction(['keystore','profile','messages','sync','outbox'],'readwrite');
  await Promise.all([
    tx.objectStore('keystore').clear(),tx.objectStore('profile').clear(),tx.objectStore('messages').clear(),
    tx.objectStore('sync').clear(),tx.objectStore('outbox').clear(),tx.done
  ]);
}
