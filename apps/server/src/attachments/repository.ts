import type {PoolClient} from 'pg';
import type {EncryptedAttachment} from '@family-messenger/protocol';

export async function insertAttachment(tx:PoolClient,input:EncryptedAttachment&{uploaderDeviceId:string;ciphertextBytes:number}){
  const existing=await tx.query<{
    attachment_id:string;chat_id:string;uploader_device_id:string;nonce:string;ciphertext:string;ciphertext_bytes:number;
  }>(`
    SELECT attachment_id,chat_id,uploader_device_id,nonce,ciphertext,ciphertext_bytes
    FROM message_attachments WHERE attachment_id=$1
  `,[input.attachmentId]);
  const row=existing.rows[0];
  if(row){
    const same=row.chat_id===input.chatId
      &&row.uploader_device_id===input.uploaderDeviceId
      &&row.nonce===input.nonce
      &&row.ciphertext===input.ciphertext
      &&row.ciphertext_bytes===input.ciphertextBytes;
    if(!same)throw Object.assign(new Error('attachment_id_conflict'),{statusCode:409});
    return {inserted:false};
  }
  await tx.query(`
    INSERT INTO message_attachments(attachment_id,chat_id,uploader_device_id,nonce,ciphertext,ciphertext_bytes)
    VALUES($1,$2,$3,$4,$5,$6)
  `,[input.attachmentId,input.chatId,input.uploaderDeviceId,input.nonce,input.ciphertext,input.ciphertextBytes]);
  return {inserted:true};
}

export async function getAttachment(tx:PoolClient,input:{attachmentId:string;familyId:string;memberId:string}){
  const r=await tx.query<{
    attachment_id:string;chat_id:string;nonce:string;ciphertext:string;ciphertext_bytes:number;
  }>(`
    SELECT a.attachment_id,a.chat_id,a.nonce,a.ciphertext,a.ciphertext_bytes
    FROM message_attachments a
    JOIN chats c ON c.id=a.chat_id AND c.family_id=$2
    JOIN chat_members cm ON cm.chat_id=c.id AND cm.member_id=$3
    JOIN family_memberships fm ON fm.family_id=c.family_id AND fm.member_id=cm.member_id AND fm.status='active'
    WHERE a.attachment_id=$1
  `,[input.attachmentId,input.familyId,input.memberId]);
  const row=r.rows[0];
  return row?{
    attachmentId:row.attachment_id,chatId:row.chat_id,nonce:row.nonce,ciphertext:row.ciphertext,ciphertextBytes:row.ciphertext_bytes
  }:null;
}
