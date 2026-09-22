// @vitest-environment node
import 'fake-indexeddb/auto';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {encryptAttachmentBytes,toBase64} from '@family-messenger/crypto';
import {clearLocalData,resetDbHandleForTests} from '../src/local/db.js';
import {saveProfile} from '../src/local/session.js';
import {fetchAttachmentBlob} from '../src/flows/attachments.js';

afterEach(async()=>{
  vi.unstubAllGlobals();
  await clearLocalData();
  resetDbHandleForTests();
});

describe('encrypted photo viewing',()=>{
  it('downloads, decrypts, and returns the original JPEG bytes with the correct MIME type',async()=>{
    const chatId='11111111-1111-4111-8111-111111111111';
    const attachmentId='22222222-2222-4222-8222-222222222222';
    const original=new Uint8Array([0xff,0xd8,0xff,0xe0,1,2,3,4,0xff,0xd9]);
    const encrypted=await encryptAttachmentBytes({attachmentId,chatId,bytes:original});

    await saveProfile({
      familyId:'family-1',memberId:'member-1',deviceId:'device-1',familyChatId:chatId,
      status:'active',csrfToken:'csrf',memberDisplayName:'Папа',familyDisplayName:'Наша семья'
    });

    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({
      attachmentId,chatId,nonce:encrypted.nonce,ciphertext:encrypted.ciphertext
    }),{status:200,headers:{'content-type':'application/json'}})));

    const blob=await fetchAttachmentBlob({
      chatId,attachmentId,attachmentKey:toBase64(encrypted.key),mimeType:'image/jpeg'
    });

    expect(blob.type).toBe('image/jpeg');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(original);
  });
});
