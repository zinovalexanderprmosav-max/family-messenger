// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptKeystore, encryptTextMessage, toBase64, type EncryptedKeystoreBlob } from '@family-messenger/crypto';
import { clearLocalData, getDb } from '../local/db.js';
import { enqueueOutbox, listOutbox } from '../local/outbox.js';
import { flushOutbox, readLocalVisibleMessages, sendTextMessage } from './messages.js';

const PIN='123456';
const FAMILY_ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEMBER_ID='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DEVICE_ID='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CHAT_ID='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DIRECT_CHAT_ID='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const KEY=new Uint8Array(32).fill(7);
const DIRECT_KEY=new Uint8Array(32).fill(13);
let keystoreBlob:EncryptedKeystoreBlob;

beforeAll(async()=>{
  keystoreBlob=await encryptKeystore({
    encryptionPublicKey:'public',
    encryptionPrivateKey:'private',
    signingPublicKey:'sign-public',
    signingPrivateKey:'sign-private',
    chatKeys:{
      [CHAT_ID]:{keyVersion:1,key:toBase64(KEY)},
      [DIRECT_CHAT_ID]:{keyVersion:1,key:toBase64(DIRECT_KEY)}
    }
  },PIN);
});

beforeEach(async()=>{
  vi.restoreAllMocks();
  vi.stubGlobal('navigator',{onLine:true});
  await clearLocalData();
  const db=await getDb();
  await db.put('profile',{id:'current',profile:{familyId:FAMILY_ID,memberId:MEMBER_ID,deviceId:DEVICE_ID,familyChatId:CHAT_ID,status:'active',csrfToken:'csrf',memberDisplayName:'Alex',familyDisplayName:'Наша семья'}});
  await db.put('keystore',{id:'device',blob:keystoreBlob});
});

async function makeQueued(messageId:string,text:string,createdAt:string,chatId=CHAT_ID,key=KEY){
  const envelope=await encryptTextMessage({messageId,chatId,senderDeviceId:DEVICE_ID,keyVersion:1,key,payload:{kind:'text',text,sentAt:createdAt}});
  await enqueueOutbox({messageId,chatId,senderDeviceId:DEVICE_ID,envelope,createdAt,state:'queued',attemptCount:0});
  return envelope;
}

function canonicalResponse(body:string,sequence:string){
  const envelope=JSON.parse(body) as Record<string,unknown>;
  return new Response(JSON.stringify({...envelope,sequence,acceptedAt:'2026-09-16T10:10:00.000Z'}),{status:201,headers:{'content-type':'application/json'}});
}

describe('multi-chat offline message outbox',()=>{
  it('keeps an encrypted queued message when the network request fails',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>{throw new TypeError('offline');}));
    const visible=await sendTextMessage(CHAT_ID,'secret plaintext',PIN);
    const queued=await listOutbox(CHAT_ID);
    expect(visible.sendState).toBe('queued');
    expect(queued).toHaveLength(1);
    expect(queued[0]?.envelope.ciphertext).toBeTruthy();
    expect(JSON.stringify(queued[0])).not.toContain('secret plaintext');
    expect((await readLocalVisibleMessages(CHAT_ID,PIN)).map(x=>x.text)).toContain('secret plaintext');
  });

  it('sends into the explicitly selected direct chat instead of the family chat',async()=>{
    vi.stubGlobal('navigator',{onLine:false});
    await sendTextMessage(DIRECT_CHAT_ID,'private hello',PIN);
    expect(await listOutbox(CHAT_ID)).toHaveLength(0);
    const direct=await listOutbox(DIRECT_CHAT_ID);
    expect(direct).toHaveLength(1);
    expect(direct[0]?.chatId).toBe(DIRECT_CHAT_ID);
    expect(direct[0]?.envelope.chatId).toBe(DIRECT_CHAT_ID);
    expect(JSON.stringify(direct[0])).not.toContain('private hello');
  });

  it('flushes queued messages in FIFO order inside one chat',async()=>{
    await makeQueued('11111111-1111-4111-8111-111111111111','one','2026-09-16T10:00:00.000Z');
    await makeQueued('22222222-2222-4222-8222-222222222222','two','2026-09-16T10:00:01.000Z');
    const sent:string[]=[];
    vi.stubGlobal('fetch',vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{
      const body=String(init?.body??'');sent.push((JSON.parse(body) as {messageId:string}).messageId);
      return canonicalResponse(body,String(sent.length));
    }));
    await flushOutbox(CHAT_ID,PIN);
    expect(sent).toEqual(['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222']);
    expect(await listOutbox(CHAT_ID)).toHaveLength(0);
    await expect((await getDb()).count('messages')).resolves.toBe(2);
  });

  it('returns a failed transport attempt to queued state',async()=>{
    await makeQueued('33333333-3333-4333-8333-333333333333','later','2026-09-16T10:00:02.000Z');
    vi.stubGlobal('fetch',vi.fn(async()=>{throw new TypeError('offline');}));
    await flushOutbox(CHAT_ID,PIN);
    const [item]=await listOutbox(CHAT_ID);
    expect(item?.state).toBe('queued');
    expect(item?.attemptCount).toBe(1);
  });

  it('serializes concurrent flush triggers for the same chat',async()=>{
    await makeQueued('44444444-4444-4444-8444-444444444444','once','2026-09-16T10:00:03.000Z');
    let releaseFetch:(()=>void)|undefined;
    let calls=0;
    vi.stubGlobal('fetch',vi.fn((_input:RequestInfo|URL,init?:RequestInit)=>{
      calls+=1;const body=String(init?.body??'');
      return new Promise<void>(resolve=>{releaseFetch=resolve;}).then(()=>canonicalResponse(body,'1'));
    }));
    const first=flushOutbox(CHAT_ID,PIN);
    const second=flushOutbox(CHAT_ID,PIN);
    await vi.waitFor(()=>expect(calls).toBe(1));
    releaseFetch?.();
    await Promise.all([first,second]);
    expect(calls).toBe(1);
  });

  it('lets different chats flush concurrently while preserving per-chat serialization',async()=>{
    await makeQueued('55555555-5555-4555-8555-555555555555','family','2026-09-16T10:00:04.000Z');
    await makeQueued('66666666-6666-4666-8666-666666666666','direct','2026-09-16T10:00:05.000Z',DIRECT_CHAT_ID,DIRECT_KEY);
    const releases:Array<()=>void>=[];
    const urls:string[]=[];
    vi.stubGlobal('fetch',vi.fn((input:RequestInfo|URL,init?:RequestInit)=>{
      urls.push(String(input));const body=String(init?.body??'');
      return new Promise<void>(resolve=>{releases.push(resolve);}).then(()=>canonicalResponse(body,String(urls.length)));
    }));
    const family=flushOutbox(CHAT_ID,PIN);
    const direct=flushOutbox(DIRECT_CHAT_ID,PIN);
    await vi.waitFor(()=>expect(urls).toHaveLength(2));
    expect(urls).toEqual(expect.arrayContaining([`/v1/chats/${CHAT_ID}/messages`,`/v1/chats/${DIRECT_CHAT_ID}/messages`]));
    releases.forEach(release=>release());
    await Promise.all([family,direct]);
  });

  it('replaces the queued copy with one canonical visible message after ack',async()=>{
    vi.stubGlobal('fetch',vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>canonicalResponse(String(init?.body??''),'9')));
    await sendTextMessage(CHAT_ID,'confirmed once',PIN);
    const visible=await readLocalVisibleMessages(CHAT_ID,PIN);
    expect(visible.filter(x=>x.text==='confirmed once')).toHaveLength(1);
    expect(visible[0]?.sendState).toBe('sent');
    expect(await listOutbox(CHAT_ID)).toHaveLength(0);
  });
});
