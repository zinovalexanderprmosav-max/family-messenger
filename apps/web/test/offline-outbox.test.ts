// @vitest-environment node
import 'fake-indexeddb/auto';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {generateDeviceIdentity} from '@family-messenger/crypto';
import {clearLocalData,getDb,resetDbHandleForTests} from '../src/local/db.js';
import {createLockedDeviceProfile,saveChatKey} from '../src/local/keystore.js';
import {saveProfile} from '../src/local/session.js';
import {flushOutbox,readLocalVisibleMessages,sendAttachmentMessage,sendTextMessage} from '../src/flows/messages.js';

const pin='246824';
const chatId='11111111-1111-4111-8111-111111111111';
const deviceId='33333333-3333-4333-8333-333333333333';

afterEach(async()=>{
  vi.unstubAllGlobals();
  await clearLocalData();
  resetDbHandleForTests();
  it('stores offline attachments as raw bytes and sends them after reconnect',async()=>{
    await setup();
    vi.stubGlobal('fetch',vi.fn(async()=>{throw new TypeError('Failed to fetch');}));

    const file=new File([new Uint8Array([1,2,3,4,5])],'voice-test.webm',{type:'audio/webm'});
    const queued=await sendAttachmentMessage(file,pin,chatId);
    expect(queued.kind).toBe('attachment');
    expect(queued.deliveryStatus).toBe('queued');

    const db=await getDb();
    const pending=await db.getAll('outbox');
    expect(pending).toHaveLength(1);
    const item=pending[0];
    expect(item?.kind).toBe('attachment');
    if(!item||item.kind!=='attachment')throw new Error('missing_attachment_outbox_item');
    expect(item.bytes).toBeInstanceOf(ArrayBuffer);
    expect(item.bytes.byteLength).toBe(5);
    expect('blob' in item).toBe(false);

    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      if(url.includes('/attachments')){
        const body=JSON.parse(String(init?.body)) as {attachmentId:string;chatId:string;ciphertext:string};
        return new Response(JSON.stringify({
          attachmentId:body.attachmentId,chatId:body.chatId,ciphertextBytes:body.ciphertext.length
        }),{status:201,headers:{'content-type':'application/json'}});
      }
      const body=JSON.parse(String(init?.body)) as Record<string,unknown>;
      return new Response(JSON.stringify({...body,sequence:'2',acceptedAt:'2026-09-22T12:00:01.000Z'}),{
        status:201,headers:{'content-type':'application/json'}
      });
    }));

    await flushOutbox(pin,chatId);
    expect(await db.getAll('outbox')).toHaveLength(0);
    const messages=await readLocalVisibleMessages(chatId,pin);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({kind:'attachment',deliveryStatus:'sent',mediaKind:'audio'});
  });
});

async function setup(){
  const identity=await generateDeviceIdentity();
  await createLockedDeviceProfile(identity,pin);
  await saveChatKey(chatId,1,new Uint8Array(32).fill(7),pin);
  await saveProfile({
    familyId:'family-1',memberId:'member-me',deviceId,familyChatId:chatId,status:'active',
    csrfToken:'csrf',memberDisplayName:'Alex',familyDisplayName:'Family'
  });
}

describe('offline outbox',()=>{
  it('queues an encrypted message offline and flushes it without duplicates after reconnect',async()=>{
    await setup();
    vi.stubGlobal('fetch',vi.fn(async()=>{throw new TypeError('Failed to fetch');}));

    const queued=await sendTextMessage('Сообщение без сети',pin,chatId);
    expect(queued.kind).toBe('text');
    expect(queued.deliveryStatus).toBe('queued');

    const db=await getDb();
    const pending=await db.getAll('outbox');
    expect(pending).toHaveLength(1);
    expect(pending[0]?.kind).toBe('text');
    expect(JSON.stringify(pending[0])).not.toContain('Сообщение без сети');

    vi.stubGlobal('fetch',vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body)) as Record<string,unknown>;
      return new Response(JSON.stringify({...body,sequence:'1',acceptedAt:'2026-09-22T12:00:00.000Z'}),{
        status:201,headers:{'content-type':'application/json'}
      });
    }));

    await flushOutbox(pin,chatId);
    expect(await db.getAll('outbox')).toHaveLength(0);
    const messages=await readLocalVisibleMessages(chatId,pin);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({kind:'text',deliveryStatus:'sent'});
  });
});
