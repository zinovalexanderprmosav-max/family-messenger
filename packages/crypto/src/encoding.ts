export const utf8 = (value: string) => new TextEncoder().encode(value);
export const text = (value: Uint8Array) => new TextDecoder().decode(value);

export function toBase64(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function toHex(value: Uint8Array): string {
  return Array.from(value, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(value: string): Uint8Array {
  if (value.length % 2 !== 0) throw new Error('invalid_hex');
  return Uint8Array.from(value.match(/.{2}/g)?.map((part) => Number.parseInt(part, 16)) ?? []);
}
