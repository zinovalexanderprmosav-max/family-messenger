import { getDb, type OutboxEntry } from './db.js';

export type { OutboxEntry } from './db.js';

export async function enqueueOutbox(entry:OutboxEntry){const db=await getDb();await db.put('outbox',entry);}
export async function listOutbox(chatId:string){const db=await getDb();const items=await db.getAllFromIndex('outbox','chatId',chatId);items.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.messageId.localeCompare(b.messageId));return items;}
export async function markOutboxSending(messageId:string,at:string){const db=await getDb();const item=await db.get('outbox',messageId);if(!item)return;await db.put('outbox',{...item,state:'sending',attemptCount:item.attemptCount+1,lastAttemptAt:at});}
export async function markOutboxQueued(messageId:string){const db=await getDb();const item=await db.get('outbox',messageId);if(!item)return;await db.put('outbox',{...item,state:'queued'});}
export async function removeOutbox(messageId:string){const db=await getDb();await db.delete('outbox',messageId);}
