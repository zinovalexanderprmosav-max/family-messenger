// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { generateDeviceIdentity } from '@family-messenger/crypto';
import { clearLocalData,resetDbHandleForTests } from '../src/local/db.js';
import { createLockedDeviceProfile,saveChatKey } from '../src/local/keystore.js';
import { saveProfile } from '../src/local/session.js';
import { sendTextMessage } from '../src/flows/messages.js';

const pin='246824';
const familyChatId='11111111-1111-4111-8111-111111111111';
const directChatId='22222222-2222-4222-8222-222222222222';
const deviceId='33333333-3333-4333-8333-333333333333';

afterEach(async()=>{
  vi.unstubAllGlobals();
  await clearLocalData();
  resetDbHandleForTests();
});

describe('message chat target',()=>{
  it('encrypts and posts a text message to the requested direct chat',async()=>{
    const identity=await generateDeviceIdentity();
    await createLockedDeviceProfile(identity,pin);
    await saveChatKey(directChatId,1,new Uint8Array(32).fill(7),pin);
    await saveProfile({familyId:'family-1',memberId:'member-me',deviceId,familyChatId,status:'active',csrfToken:'csrf',memberDisplayName:'Alex',familyDisplayName:'Family'});

    let postedPath='';
    let postedChatId='';
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      postedPath=String(input);
      const body=JSON.parse(String(init?.body)) as {chatId:string};
      postedChatId=body.chatId;
      return new Response(JSON.stringify({...body,sequence:'1',acceptedAt:new Date().toISOString()}),{status:200,headers:{'content-type':'application/json'}});
    });
    vi.stubGlobal('fetch',fetchMock);

    const sent=await sendTextMessage('Привет',pin,directChatId);
    expect(sent.text).toBe('Привет');
    expect(postedPath).toBe(`/v1/chats/${directChatId}/messages`);
    expect(postedChatId).toBe(directChatId);
  });
});
