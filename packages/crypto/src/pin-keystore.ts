import { fromBase64, text, toBase64, utf8 } from './encoding.js';
import { getSodium } from './sodium.js';

export type StoredChatKey = {
  keyVersion: number;
  key: string;
  previous?: Record<string,string>;
};

export type PlainKeystore = {
  encryptionPublicKey: string;
  encryptionPrivateKey: string;
  signingPublicKey: string;
  signingPrivateKey: string;
  chatKeys: Record<string, StoredChatKey>;
};

export type EncryptedKeystoreBlob = {
  version: 1;
  kdf: 'argon2id13';
  salt: string;
  opslimit: 3;
  memlimitBytes: 67108864;
  nonce: string;
  ciphertext: string;
};

const AAD = utf8('family-messenger:keystore:v1');
const OPSLIMIT = 3;
const MEMLIMIT = 67108864 as const;

function validatePin(pin: string) {
  if (!/^\d{6,}$/.test(pin)) throw new Error('pin_must_be_at_least_6_digits');
}

async function deriveKey(pin: string, salt: Uint8Array): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.crypto_pwhash(
    32,
    pin,
    salt,
    OPSLIMIT,
    MEMLIMIT,
    sodium.crypto_pwhash_ALG_ARGON2ID13
  );
}

export async function encryptKeystore(plain: PlainKeystore, pin: string): Promise<EncryptedKeystoreBlob> {
  validatePin(pin);
  const sodium = await getSodium();
  const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const key = await deriveKey(pin, salt);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    utf8(JSON.stringify(plain)), AAD, null, nonce, key
  );
  sodium.memzero(key);
  return { version:1, kdf:'argon2id13', salt:toBase64(salt), opslimit:3, memlimitBytes:MEMLIMIT, nonce:toBase64(nonce), ciphertext:toBase64(ciphertext) };
}

export async function decryptKeystore(blob: EncryptedKeystoreBlob, pin: string): Promise<PlainKeystore> {
  validatePin(pin);
  const sodium = await getSodium();
  const key = await deriveKey(pin, fromBase64(blob.salt));
  try {
    const plain = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null, fromBase64(blob.ciphertext), AAD, fromBase64(blob.nonce), key
    );
    return JSON.parse(text(plain)) as PlainKeystore;
  } catch {
    throw new Error('pin_invalid_or_keystore_corrupt');
  } finally {
    sodium.memzero(key);
  }
}
