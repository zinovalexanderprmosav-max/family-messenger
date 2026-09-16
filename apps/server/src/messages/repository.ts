import type { PoolClient } from 'pg';
import type { EncryptedMessageEnvelope, StoredMessageEnvelope } from '@family-messenger/protocol';
import { sameEnvelope } from './idempotency.js';

type MessageRow={message_id:string;chat_id:string;sender_device_id:string;key_version:number;nonce:string;ciphertext:string;sequence:string;accepted_at:Date};
function rowToStored(row:MessageRow):StoredMessageEnvelope{return {messageId:row.message_id,chatId:row.chat_id,senderDeviceId:row.sender_device_id,keyVersion:row.key_version,nonce:row.nonce,ciphertext:row.ciphertext,sequence:row.sequence,acceptedAt:row.accepted_at.toISOString()};}

export async function insertMessageEnvelope(tx:PoolClient,envelope:EncryptedMessageEnvelope):Promise<{kind:'inserted'|'replayed';stored:StoredMessageEnvelope}|{kind:'conflict'}>{
  const existing=await tx.query<MessageRow>(`SELECT message_id,chat_id,sender_device_id,key_version,nonce,ciphertext,sequence::text,accepted_at FROM message_envelopes WHERE message_id=$1`,[envelope.messageId]);
  if(existing.rows[0]){const stored=rowToStored(existing.rows[0]);return sameEnvelope(stored,envelope)?{kind:'replayed',stored}:{kind:'conflict'};}
  const r=await tx.query<MessageRow>(`INSERT INTO message_envelopes(message_id,chat_id,sender_device_id,key_version,nonce,ciphertext) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(message_id) DO NOTHING RETURNING message_id,chat_id,sender_device_id,key_version,nonce,ciphertext,sequence::text,accepted_at`,[envelope.messageId,envelope.chatId,envelope.senderDeviceId,envelope.keyVersion,envelope.nonce,envelope.ciphertext]);
  if(r.rows[0])return {kind:'inserted',stored:rowToStored(r.rows[0])};
  const retry=await tx.query<MessageRow>(`SELECT message_id,chat_id,sender_device_id,key_version,nonce,ciphertext,sequence::text,accepted_at FROM message_envelopes WHERE message_id=$1`,[envelope.messageId]);
  const retryRow=retry.rows[0];if(!retryRow)throw new Error('message_insert_race_missing');const stored=rowToStored(retryRow);return sameEnvelope(stored,envelope)?{kind:'replayed',stored}:{kind:'conflict'};
}

export async function listMessageEnvelopesAfter(tx:PoolClient,chatId:string,afterSequence:string,limit:number):Promise<StoredMessageEnvelope[]>{
  const r=await tx.query<MessageRow>(`SELECT message_id,chat_id,sender_device_id,key_version,nonce,ciphertext,sequence::text,accepted_at FROM message_envelopes WHERE chat_id=$1 AND sequence>$2::bigint ORDER BY sequence LIMIT $3`,[chatId,afterSequence,limit]);
  return r.rows.map(rowToStored);
}
