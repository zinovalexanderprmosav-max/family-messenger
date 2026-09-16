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
const KEY=new Uint8Array(32).fill(7);
let keystoreBlob:EncryptedKeystoreBlob;

beforeAll(async()=>{
  keystoreBlob=await encryptKeystore({
    encryptionPublicKey:'public',
    encryptionPrivateKey:'private',
    signingPublicKey:'sign-public',
    signingPrivateKey:'sign-private',
    chatKeys:{[CHAT_ID]:{keyVersion:1,key:toBase64(KEY)}}
  },PIN);
});

beforeEach(async()=>{
  vi.restoreAllMocks();
  Object.defineProperty(navigator,'onLine',{configurable:true,value:true});
  await clearLocalData();
  const db=await getDb();
  await db.put('profile',{id:'current',profile:{familyId:FAMILY_ID,memberId:MEMBER_ID,deviceId:DEVICE_ID,familyChatId:CHAT_ID,status:'active',csrfToken:'csrf',memberDisplayName:'Alex',familyDisplayName:'Наша семья'}});
  await db.put('keystore',{id:'device',blob:keystoreBlob});
});

async function makeQueued(messageId:string,text:string,createdAt:string){
  const envelope=await encryptTextMessage({messageId,chatId:CHAT_ID,senderDeviceId:DEVICE_ID,keyVersion:1,key:KEY,payload:{kind:'text',text,sentAt:createdAt}});
  await enqueueOutbox({messageId,chatId:CHAT_ID,senderDeviceId:DEVICE_ID,envelope,createdAt,state:'queued',attemptCount:0});
  return envelope;
}

function canonicalResponse(body:string,sequence:string){
  const envelope=JSON.parse(body) as Record<string,unknown>;
  return new Response(JSON.stringify({...envelope,sequence,acceptedAt:'2026-09-16T10:10:00.000Z'}),{status:201,headers:{'content-type':'application/json'}});
}

describe('offline message outbox',()=>{
  it('keeps an encrypted queued message when the network request fails',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>{throw new TypeError('offline');}));
    const visible=await sendTextMessage('secret plaintext',PIN);
    const queued=await listOutbox(CHAT_ID);
    expect(visible.sendState).toBe('queued');
    expect(queued).toHaveLength(1);
    expect(queued[0]?.envelope.ciphertext).toBeTruthy();
    expect(JSON.stringify(queued[0])).not.toContain('secret plaintext');
    expect((await readLocalVisibleMessages(CHAT_ID,PIN)).map(x=>x.text)).toContain('secret plaintext');
  });

  it('flushes queued messages in FIFO order',async()=>{
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
    expect((await getDb()).count('messages')).resolves.toBe(2);
  });

  it('returns a failed transport attempt to queued state',async()=>{
    await makeQueued('33333333-3333-4333-8333-333333333333','later','2026-09-16T10:00:02.000Z');
    vi.stubGlobal('fetch',vi.fn(async()=>{throw new TypeError('offline');}));
    await flushOutbox(CHAT_ID,PIN);
    const [item]=await listOutbox(CHAT_ID);
    expect(item?.state).toBe('queued');
    expect(item?.attemptCount).toBe(1);
  });

  it('serializes concurrent flush triggers',async()=>{
    await makeQueued('44444444-4444-4444-8444-444444444444','once','2026-09-16T10:00:03.000Z');
    let resolveFetch:((response:Response)=>void)|undefined;
    let calls=0;
    vi.stubGlobal('fetch',vi.fn((_input:RequestInfo|URL,init?:RequestInit)=>{
      calls+=1;const body=String(init?.body??'');
      return new Promise<Response>(resolve=>{resolveFetch=response=>resolve(response);}).then(()=>canonicalResponse(body,'1'));
    }));
    const first=flushOutbox(CHAT_ID,PIN);
    const second=flushOutbox(CHAT_ID,PIN);
    await Promise.resolve();
    expect(calls).toBe(1);
    resolveFetch?.(new Response());
    await Promise.all([first,second]);
    expect(calls).toBe(1);
  });

  it('replaces the queued copy with one canonical visible message after ack',async()=>{
    vi.stubGlobal('fetch',vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>canonicalResponse(String(init?.body??''),'9')));
    await sendTextMessage('confirmed once',PIN);
    const visible=await readLocalVisibleMessages(CHAT_ID,PIN);
    expect(visible.filter(x=>x.text==='confirmed once')).toHaveLength(1);
    expect(visible[0]?.sendState).toBe('sent');
    expect(await listOutbox(CHAT_ID)).toHaveLength(0);
  });
});
