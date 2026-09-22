import {randomUUID} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {decryptMessagePayload,encryptMessagePayload,generateConversationKey} from '../src/index.js';

describe('encrypted voice messages',()=>{
  it('round-trips audio metadata only inside the encrypted message payload',async()=>{
    const key=await generateConversationKey();
    const messageId=randomUUID(),chatId=randomUUID(),senderDeviceId=randomUUID();
    const payload={
      kind:'attachment' as const,
      attachmentId:randomUUID(),
      attachmentKey:'secret-file-key',
      fileName:'voice-1.m4a',
      mimeType:'audio/mp4',
      size:2048,
      mediaKind:'audio' as const,
      sentAt:'2026-09-22T12:00:00.000Z'
    };
    const envelope=await encryptMessagePayload({messageId,chatId,senderDeviceId,keyVersion:1,key,payload});
    const serialized=JSON.stringify(envelope);
    expect(serialized).not.toContain('voice-1.m4a');
    expect(serialized).not.toContain('secret-file-key');
    expect(await decryptMessagePayload(envelope,key)).toEqual(payload);
  });
});
