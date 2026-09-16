import { fromBase64, toBase64 } from './encoding.js';
import { getSodium } from './sodium.js';

export async function generateConversationKey(): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.randombytes_buf(32);
}

export async function sealConversationKey(key: Uint8Array, recipientPublicKey: Uint8Array): Promise<string> {
  const sodium = await getSodium();
  return toBase64(sodium.crypto_box_seal(key, recipientPublicKey));
}

export async function openConversationKey(
  envelope: string,
  recipientPublicKey: Uint8Array,
  recipientPrivateKey: Uint8Array
): Promise<Uint8Array> {
  const sodium = await getSodium();
  try {
    return sodium.crypto_box_seal_open(fromBase64(envelope), recipientPublicKey, recipientPrivateKey);
  } catch {
    throw new Error('conversation_key_unwrap_failed');
  }
}
