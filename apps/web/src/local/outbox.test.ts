import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDbHandleForTests } from './db.js';
import { enqueueOutbox, listOutbox } from './outbox.js';

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('family-messenger');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
  resetDbHandleForTests();
});

describe('outbox', () => {
  it('creates the outbox store in database version 2', async () => {
    const db = await getDb();
    expect(db.version).toBe(2);
    expect(db.objectStoreNames.contains('outbox')).toBe(true);
    db.close();
    resetDbHandleForTests();
  });

  it('persists encrypted envelopes without a plaintext field', async () => {
    const chatId = '22222222-2222-4222-8222-222222222222';
    const entry = {
      messageId: '11111111-1111-4111-8111-111111111111',
      chatId,
      senderDeviceId: '33333333-3333-4333-8333-333333333333',
      envelope: {
        messageId: '11111111-1111-4111-8111-111111111111',
        chatId,
        senderDeviceId: '33333333-3333-4333-8333-333333333333',
        keyVersion: 1,
        nonce: 'bm9uY2U=',
        ciphertext: 'Y2lwaGVydGV4dA=='
      },
      createdAt: '2026-09-16T10:00:00.000Z',
      state: 'queued' as const,
      attemptCount: 0
    };

    await enqueueOutbox(entry);
    const [stored] = await listOutbox(chatId);

    expect(stored?.envelope.ciphertext).toBe('Y2lwaGVydGV4dA==');
    expect(stored && 'text' in stored).toBe(false);
    expect(JSON.stringify(stored)).not.toContain('secret plaintext');

    const db = await getDb();
    db.close();
    resetDbHandleForTests();
  });
});
