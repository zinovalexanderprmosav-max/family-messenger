import type { EncryptedMessageEnvelope, MessageMutation } from '@family-messenger/protocol';
import { fromBase64, text, toBase64, utf8 } from './encoding.js';
import { getSodium } from './sodium.js';

export type ReplyReference={messageId:string;preview:string};
export type TextMessagePayload = { kind:'text'; text:string; sentAt:string; replyTo?:ReplyReference };
export type AttachmentMessagePayload = {
  kind:'attachment';
  attachmentId:string;
  attachmentKey:string;
  fileName:string;
  mimeType:string;
  size:number;
  mediaKind:'image'|'video'|'audio'|'file';
  sentAt:string;
  replyTo?:ReplyReference;
};
export type EditMessagePayload={kind:'edit';text:string;sentAt:string};
export type DeleteMessagePayload={kind:'delete';sentAt:string};
export type ReactionMessagePayload={kind:'reaction';emoji:string;action:'add'|'remove';sentAt:string};
export type MessagePayload=TextMessagePayload|AttachmentMessagePayload|EditMessagePayload|DeleteMessagePayload|ReactionMessagePayload;

export function messageAad(input: {messageId:string;chatId:string;senderDeviceId:string;keyVersion:number;mutation?:MessageMutation|undefined}) {
  const base=`fm:v1|${input.messageId}|${input.chatId}|${input.senderDeviceId}|${input.keyVersion}`;
  return utf8(input.mutation?`${base}|mutation:${input.mutation.kind}:${input.mutation.targetMessageId}`:base);
}

export async function encryptMessagePayload(input: {
  messageId: string;
  chatId: string;
  senderDeviceId: string;
  keyVersion: number;
  key: Uint8Array;
  payload: MessagePayload;
  mutation?: MessageMutation|undefined;
}): Promise<EncryptedMessageEnvelope> {
  const sodium = await getSodium();
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const aad = messageAad(input);
  const plaintext = utf8(JSON.stringify(input.payload));
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, aad, null, nonce, input.key);
  return {
    messageId: input.messageId,
    chatId: input.chatId,
    senderDeviceId: input.senderDeviceId,
    keyVersion: input.keyVersion,
    nonce: toBase64(nonce),
    ciphertext: toBase64(ciphertext),
    ...(input.mutation?{mutation:input.mutation}:{})
  };
}

export async function encryptTextMessage(input: {
  messageId: string;
  chatId: string;
  senderDeviceId: string;
  keyVersion: number;
  key: Uint8Array;
  payload: TextMessagePayload;
}): Promise<EncryptedMessageEnvelope> {
  return encryptMessagePayload(input);
}

export async function decryptMessagePayload(envelope:EncryptedMessageEnvelope,key:Uint8Array):Promise<MessagePayload>{
  const sodium = await getSodium();
  const aad = messageAad(envelope);
  try {
    const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      fromBase64(envelope.ciphertext),
      aad,
      fromBase64(envelope.nonce),
      key
    );
    const parsed = JSON.parse(text(plaintext)) as Partial<MessagePayload>;
    if(parsed.kind==='text'&&typeof parsed.text==='string'&&typeof parsed.sentAt==='string'){
      if(parsed.replyTo!==undefined&&(
        typeof parsed.replyTo!=='object'||parsed.replyTo===null||
        typeof (parsed.replyTo as ReplyReference).messageId!=='string'||
        typeof (parsed.replyTo as ReplyReference).preview!=='string'
      ))throw new Error('invalid_message_payload');
      return parsed as TextMessagePayload;
    }
    if(parsed.kind==='edit'&&typeof parsed.text==='string'&&typeof parsed.sentAt==='string')return parsed as EditMessagePayload;
    if(parsed.kind==='delete'&&typeof parsed.sentAt==='string')return parsed as DeleteMessagePayload;
    if(parsed.kind==='reaction'&&typeof parsed.emoji==='string'&&(parsed.action==='add'||parsed.action==='remove')&&typeof parsed.sentAt==='string')return parsed as ReactionMessagePayload;
    if(
      parsed.kind==='attachment'
      &&typeof parsed.attachmentId==='string'
      &&typeof parsed.attachmentKey==='string'
      &&typeof parsed.fileName==='string'
      &&typeof parsed.mimeType==='string'
      &&typeof parsed.size==='number'
      &&Number.isFinite(parsed.size)
      &&parsed.size>=0
      &&(parsed.mediaKind==='image'||parsed.mediaKind==='video'||parsed.mediaKind==='audio'||parsed.mediaKind==='file')
      &&typeof parsed.sentAt==='string'
      &&(parsed.replyTo===undefined||(
        typeof parsed.replyTo==='object'&&parsed.replyTo!==null&&
        typeof (parsed.replyTo as ReplyReference).messageId==='string'&&
        typeof (parsed.replyTo as ReplyReference).preview==='string'
      ))
    )return parsed as AttachmentMessagePayload;
    throw new Error('invalid_message_payload');
  } catch (error) {
    if (error instanceof Error && error.message === 'invalid_message_payload') throw error;
    throw new Error('message_decryption_failed');
  }
}

export async function decryptTextMessage(envelope: EncryptedMessageEnvelope, key: Uint8Array): Promise<TextMessagePayload> {
  const payload=await decryptMessagePayload(envelope,key);
  if(payload.kind!=='text')throw new Error('invalid_message_payload');
  return payload;
}
