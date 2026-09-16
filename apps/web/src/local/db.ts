import { openDB, type DBSchema } from 'idb';
import type { EncryptedKeystoreBlob } from '@family-messenger/crypto';
import type { StoredMessageEnvelope } from '@family-messenger/protocol';

export type LocalProfile={familyId:string;memberId:string;deviceId:string;familyChatId:string;status:'pending_key'|'active';csrfToken:string;memberDisplayName:string;familyDisplayName?:string};
interface FamilyDb extends DBSchema{
  keystore:{key:string;value:{id:'device';blob:EncryptedKeystoreBlob}};
  profile:{key:string;value:{id:'current';profile:LocalProfile}};
  messages:{key:string;value:StoredMessageEnvelope;indexes:{chatId:string;sequence:string}};
  sync:{key:string;value:{chatId:string;cursor:string}};
}
let dbPromise:ReturnType<typeof openDB<FamilyDb>>|undefined;
export function getDb(){dbPromise??=openDB<FamilyDb>('family-messenger',1,{upgrade(db){const ks=db.createObjectStore('keystore',{keyPath:'id'});void ks;db.createObjectStore('profile',{keyPath:'id'});const messages=db.createObjectStore('messages',{keyPath:'messageId'});messages.createIndex('chatId','chatId');messages.createIndex('sequence','sequence');db.createObjectStore('sync',{keyPath:'chatId'});}});return dbPromise;}
export function resetDbHandleForTests(){dbPromise=undefined;}
export async function clearLocalData(){const db=await getDb();const tx=db.transaction(['keystore','profile','messages','sync'],'readwrite');await Promise.all([tx.objectStore('keystore').clear(),tx.objectStore('profile').clear(),tx.objectStore('messages').clear(),tx.objectStore('sync').clear(),tx.done]);}
