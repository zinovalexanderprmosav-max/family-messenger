import { getSodium } from './sodium.js';

export type DeviceIdentity = {
  encryptionPublicKey: Uint8Array;
  encryptionPrivateKey: Uint8Array;
  signingPublicKey: Uint8Array;
  signingPrivateKey: Uint8Array;
};

export async function generateDeviceIdentity(): Promise<DeviceIdentity> {
  const sodium = await getSodium();
  const box = sodium.crypto_box_keypair();
  const sign = sodium.crypto_sign_keypair();
  return {
    encryptionPublicKey: box.publicKey,
    encryptionPrivateKey: box.privateKey,
    signingPublicKey: sign.publicKey,
    signingPrivateKey: sign.privateKey
  };
}

export async function signDetached(message: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.crypto_sign_detached(message, privateKey);
}

export async function verifyDetached(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): Promise<boolean> {
  const sodium = await getSodium();
  return sodium.crypto_sign_verify_detached(signature, message, publicKey);
}
