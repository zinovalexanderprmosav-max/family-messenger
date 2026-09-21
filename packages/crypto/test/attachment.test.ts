import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {
  decryptAttachmentBytes,
  decryptMessagePayload,
  encryptAttachmentBytes,
  encryptMessagePayload,
  generateConversationKey,
  toBase64
} from '../src/index.js';

it('round-trips attachment bytes with a random per-file key',async()=>{
  const chatId=randomUUID(),attachmentId=randomUUID();
  const bytes=new TextEncoder().encode('private photo bytes');
  const encrypted=await encryptAttachmentBytes({attachmentId,chatId,bytes});
  const opened=await decryptAttachmentBytes({attachmentId,chatId,nonce:encrypted.nonce,ciphertext:encrypted.ciphertext,key:encrypted.key});
  expect(Array.from(opened)).toEqual(Array.from(bytes));
  const wrong=await generateConversationKey();
  await expect(decryptAttachmentBytes({attachmentId,chatId,nonce:encrypted.nonce,ciphertext:encrypted.ciphertext,key:wrong}))
    .rejects.toThrow('attachment_decryption_failed');
});

it('keeps attachment filename metadata and file key inside the E2EE message',async()=>{
  const chatKey=await generateConversationKey(),fileKey=await generateConversationKey();
  const messageId=randomUUID(),chatId=randomUUID(),senderDeviceId=randomUUID(),attachmentId=randomUUID();
  const envelope=await encryptMessagePayload({
    messageId,chatId,senderDeviceId,keyVersion:2,key:chatKey,
    payload:{
      kind:'attachment',attachmentId,attachmentKey:toBase64(fileKey),
      fileName:'secret-photo.jpg',mimeType:'image/jpeg',size:1234,mediaKind:'image',
      sentAt:'2026-09-21T12:00:00.000Z'
    }
  });
  const serialized=JSON.stringify(envelope);
  expect(serialized).not.toContain('secret-photo.jpg');
  expect(serialized).not.toContain(toBase64(fileKey));
  const opened=await decryptMessagePayload(envelope,chatKey);
  expect(opened).toMatchObject({kind:'attachment',attachmentId,fileName:'secret-photo.jpg',mimeType:'image/jpeg',size:1234});
});
