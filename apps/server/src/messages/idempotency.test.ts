import { describe, expect, it } from 'vitest';
import { sameEnvelope } from './idempotency.js';

const base={
  messageId:'11111111-1111-4111-8111-111111111111',
  chatId:'22222222-2222-4222-8222-222222222222',
  senderDeviceId:'33333333-3333-4333-8333-333333333333',
  keyVersion:1,
  nonce:'bm9uY2U=',
  ciphertext:'Y2lwaGVydGV4dA=='
};

describe('message idempotency',()=>{
  it('accepts an exact encrypted replay',()=>expect(sameEnvelope(base,{...base})).toBe(true));
  it('rejects conflicting ciphertext reuse',()=>expect(sameEnvelope(base,{...base,ciphertext:'ZGlmZmVyZW50'})).toBe(false));
  it('rejects conflicting routing reuse',()=>expect(sameEnvelope(base,{...base,chatId:'44444444-4444-4444-8444-444444444444'})).toBe(false));
});
