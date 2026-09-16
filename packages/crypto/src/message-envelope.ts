import type { EncryptedMessageEnvelope } from '@family-messenger/protocol';
import { fromBase64, text, toBase64, utf8 } from './encoding.js';
import { getSodium } from './sodium.js';

export type TextMessagePayload = { kind: 'text'; text: string; sentAt: string };

export function messageAad(input: {messageId:string;chatId:string;senderDeviceId:string;keyVersion:number}) {
  return utf8(`fm:v1|${input.messageId}|${input.chatId}|${input.senderDeviceId}|${input.keyVersion}`);
}

export async function encryptTextMessage(input: {
  messageId: string;
  chatId: string;
  senderDeviceId: string;
  keyVersion: number;
  key: Uint8Array;
  payload: TextMessagePayload;
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
    ciphertext: toBase64(ciphertext)
  };
}

export async function decryptTextMessage(envelope: EncryptedMessageEnvelope, key: Uint8Array): Promise<TextMessagePayload> {
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
    const parsed = JSON.parse(text(plaintext)) as TextMessagePayload;
    if (parsed.kind !== 'text' || typeof parsed.text !== 'string' || typeof parsed.sentAt !== 'string') {
      throw new Error('invalid_message_payload');
    }
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message === 'invalid_message_payload') throw error;
    throw new Error('message_decryption_failed');
  }
}
