import {fromBase64,toBase64,utf8} from './encoding.js';
import {getSodium} from './sodium.js';

export function attachmentAad(input:{attachmentId:string;chatId:string}){
  return utf8(`fm:attachment:v1|${input.attachmentId}|${input.chatId}`);
}

export async function encryptAttachmentBytes(input:{attachmentId:string;chatId:string;bytes:Uint8Array}){
  const sodium=await getSodium();
  const key=sodium.randombytes_buf(32);
  const nonce=sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ciphertext=sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    input.bytes,attachmentAad(input),null,nonce,key
  );
  return {key,nonce:toBase64(nonce),ciphertext:toBase64(ciphertext)};
}

export async function decryptAttachmentBytes(input:{
  attachmentId:string;chatId:string;nonce:string;ciphertext:string;key:Uint8Array;
}){
  const sodium=await getSodium();
  try{
    return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,fromBase64(input.ciphertext),attachmentAad(input),fromBase64(input.nonce),input.key
    );
  }catch{
    throw new Error('attachment_decryption_failed');
  }
}
