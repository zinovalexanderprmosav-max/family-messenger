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

async function decodeImage(file:File):Promise<{source:CanvasImageSource;width:number;height:number;close:()=>void}|null>{
  if(typeof createImageBitmap==='function'){
    try{
      const bitmap=await createImageBitmap(file);
      return {source:bitmap,width:bitmap.width,height:bitmap.height,close:()=>bitmap.close()};
    }catch{}
  }

  if(typeof document==='undefined'||typeof Image==='undefined'||typeof URL==='undefined')return null;
  const url=URL.createObjectURL(file);
  try{
    const image=new Image();
    image.decoding='async';
    await new Promise<void>((resolve,reject)=>{
      image.onload=()=>resolve();
      image.onerror=()=>reject(new Error('image_decode_failed'));
      image.src=url;
    });
    const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height;
    if(!width||!height)return null;
    return {source:image,width,height,close:()=>URL.revokeObjectURL(url)};
  }catch{
    URL.revokeObjectURL(url);
    return null;
  }
}

function shouldNormalizeImage(file:File){
  const type=file.type.toLowerCase();
  const name=file.name.toLowerCase();
  return file.size>IMAGE_COMPRESS_THRESHOLD
    ||type==='image/heic'||type==='image/heif'
    ||name.endsWith('.heic')||name.endsWith('.heif');
}

export async function compressImageIfNeeded(file:File):Promise<File>{
  if(!file.type.startsWith('image/')&&!/\.(heic|heif)$/i.test(file.name))return file;
  if(!shouldNormalizeImage(file))return file;

  const decoded=await decodeImage(file);
  if(!decoded)return file;

  try{
    const scale=Math.min(1,IMAGE_MAX_EDGE/Math.max(decoded.width,decoded.height));
    const width=Math.max(1,Math.round(decoded.width*scale));
    const height=Math.max(1,Math.round(decoded.height*scale));
    const canvas=document.createElement('canvas');
    canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d');
    if(!ctx)return file;
    ctx.drawImage(decoded.source,0,0,width,height);
    const blob=await canvasBlob(canvas,'image/jpeg',.84);
    if(!blob)return file;

    const base=file.name.replace(/\.[^.]+$/,'')||'photo';
    const normalized=new File([blob],base+'.jpg',{type:'image/jpeg',lastModified:Date.now()});
    if(file.type==='image/heic'||file.type==='image/heif'||/\.(heic|heif)$/i.test(file.name))return normalized;
    return normalized.size<file.size?normalized:file;
  }finally{
    decoded.close();
  }
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
    mediaKind:mediaKind(prepared.type||file.type)
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
  const buffer=new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer],{type:input.mimeType||'application/octet-stream'});
}
