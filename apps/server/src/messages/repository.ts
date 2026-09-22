import type { PoolClient } from 'pg';
import type { EncryptedMessageEnvelope, StoredMessageEnvelope } from '@family-messenger/protocol';

export async function insertMessageEnvelope(tx:PoolClient,envelope:EncryptedMessageEnvelope):Promise<{sequence:string;acceptedAt:string;inserted:boolean}>{
  const existing=await tx.query<{sequence:string;accepted_at:Date}>(`SELECT sequence::text,accepted_at FROM message_envelopes WHERE message_id=$1`,[envelope.messageId]);
  if(existing.rows[0]) return {sequence:existing.rows[0].sequence,acceptedAt:existing.rows[0].accepted_at.toISOString(),inserted:false};
  const r=await tx.query<{sequence:string;accepted_at:Date}>(`INSERT INTO message_envelopes(message_id,chat_id,sender_device_id,key_version,nonce,ciphertext,mutation_kind,target_message_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(message_id) DO NOTHING RETURNING sequence::text,accepted_at`,[envelope.messageId,envelope.chatId,envelope.senderDeviceId,envelope.keyVersion,envelope.nonce,envelope.ciphertext,envelope.mutation?.kind??null,envelope.mutation?.targetMessageId??null]);
  if(r.rows[0]) return {sequence:r.rows[0].sequence,acceptedAt:r.rows[0].accepted_at.toISOString(),inserted:true};
  const retry=await tx.query<{sequence:string;accepted_at:Date}>(`SELECT sequence::text,accepted_at FROM message_envelopes WHERE message_id=$1`,[envelope.messageId]);
  return {sequence:retry.rows[0]!.sequence,acceptedAt:retry.rows[0]!.accepted_at.toISOString(),inserted:false};
}

export async function listMessageEnvelopesAfter(tx:PoolClient,chatId:string,afterSequence:string,limit:number):Promise<StoredMessageEnvelope[]>{
  const r=await tx.query<{message_id:string;chat_id:string;sender_device_id:string;key_version:number;nonce:string;ciphertext:string;sequence:string;accepted_at:Date;mutation_kind:'edit'|'delete'|null;target_message_id:string|null}>(`SELECT message_id,chat_id,sender_device_id,key_version,nonce,ciphertext,sequence::text,accepted_at,mutation_kind,target_message_id FROM message_envelopes WHERE chat_id=$1 AND sequence>$2::bigint ORDER BY sequence LIMIT $3`,[chatId,afterSequence,limit]);
  return r.rows.map(row=>({
    messageId:row.message_id,chatId:row.chat_id,senderDeviceId:row.sender_device_id,keyVersion:row.key_version,
    nonce:row.nonce,ciphertext:row.ciphertext,sequence:row.sequence,acceptedAt:row.accepted_at.toISOString(),
    ...(row.mutation_kind&&row.target_message_id?{mutation:{kind:row.mutation_kind,targetMessageId:row.target_message_id}}:{})
  }));
}
