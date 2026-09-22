import {decryptAttachmentBytes,encryptAttachmentBytes,fromBase64,toBase64,type AttachmentMessagePayload} from '@family-messenger/crypto';
import type {EncryptedAttachment} from '@family-messenger/protocol';
import {api} from '../api/client.js';

const MAX_SOURCE_BYTES=20*1024*1024;
const IMAGE_COMPRESS_THRESHOLD=2*1024*1024;
const IMAGE_MAX_EDGE=1600;

function mediaKind(mimeType:string):'image'|'video'|'audio'|'file'{
  if(mimeType.startsWith('image/'))return 'image';
  if(mimeType.startsWith('video/'))return 'video';
  if(mimeType.startsWith('audio/'))return 'audio';
  return 'file';
}

async function canvasBlob(canvas:HTMLCanvasElement,type:string,quality:number){
  return new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,type,quality));
}

export async function compressImageIfNeeded(file:File):Promise<File>{
  if(!file.type.startsWith('image/')||file.size<=IMAGE_COMPRESS_THRESHOLD||typeof createImageBitmap!=='function')return file;
  try{
    const bitmap=await createImageBitmap(file);
    const scale=Math.min(1,IMAGE_MAX_EDGE/Math.max(bitmap.width,bitmap.height));
    const width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d');if(!ctx){bitmap.close();return file;}
    ctx.drawImage(bitmap,0,0,width,height);bitmap.close();
    const outputType=file.type==='image/webp'?'image/webp':'image/jpeg';
    const blob=await canvasBlob(canvas,outputType,.82);
    if(!blob||blob.size>=file.size)return file;
    const base=file.name.replace(/\.[^.]+$/,'');
    const ext=outputType==='image/webp'?'.webp':'.jpg';
    return new File([blob],base+ext,{type:outputType,lastModified:Date.now()});
  }catch{return file;}
}

export async function prepareAttachmentFile(file:File){
  const prepared=await compressImageIfNeeded(file);
  if(prepared.size>MAX_SOURCE_BYTES)throw new Error(prepared.type.startsWith('video/')?'video_too_large':'attachment_too_large');
  return prepared;
}

export async function uploadEncryptedAttachment(file:File,chatId:string){
  const prepared=await prepareAttachmentFile(file);
  const attachmentId=crypto.randomUUID();
  const bytes=new Uint8Array(await prepared.arrayBuffer());
  const encrypted=await encryptAttachmentBytes({attachmentId,chatId,bytes});
  const envelope:EncryptedAttachment={attachmentId,chatId,nonce:encrypted.nonce,ciphertext:encrypted.ciphertext};
  await api<{attachmentId:string;chatId:string;ciphertextBytes:number}>(`/v1/chats/${chatId}/attachments`,{
    method:'POST',body:JSON.stringify(envelope)
  });
  return {
    attachmentId,
    attachmentKey:toBase64(encrypted.key),
    fileName:prepared.name||'file',
    mimeType:prepared.type||'application/octet-stream',
    size:prepared.size,
    mediaKind:mediaKind(prepared.type)
  } satisfies Omit<AttachmentMessagePayload,'kind'|'sentAt'>;
}

export async function fetchAttachmentBlob(input:{
  chatId:string;attachmentId:string;attachmentKey:string;mimeType:string;
}){
  const stored=await api<{attachmentId:string;chatId:string;nonce:string;ciphertext:string}>(`/v1/attachments/${encodeURIComponent(input.attachmentId)}`);
  if(stored.chatId!==input.chatId||stored.attachmentId!==input.attachmentId)throw new Error('attachment_identity_mismatch');
  const bytes=await decryptAttachmentBytes({
    attachmentId:input.attachmentId,chatId:input.chatId,nonce:stored.nonce,ciphertext:stored.ciphertext,
    key:fromBase64(input.attachmentKey)
  });
  const buffer=new ArrayBuffer(bytes.byteLength);new Uint8Array(buffer).set(bytes);
  return new Blob([buffer],{type:input.mimeType||'application/octet-stream'});
}
