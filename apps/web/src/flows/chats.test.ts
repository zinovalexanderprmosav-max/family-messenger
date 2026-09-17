// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';
import { generateDeviceIdentity,openConversationKey,sealConversationKey,toBase64,type DeviceIdentity } from '@family-messenger/crypto';
import { clearLocalData } from '../local/db.js';
import { createLockedDeviceProfile,loadChatKey } from '../local/keystore.js';
import { saveProfile } from '../local/session.js';
import { openOrCreateDirectChat } from './chats.js';

const PIN='123456';
const FAMILY_ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER_ID='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWNER_DEVICE_ID='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const FAMILY_CHAT_ID='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const MAMA_ID='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const MAMA_DEVICE_ID='ffffffff-ffff-4fff-8fff-ffffffffffff';
const DIRECT_CHAT_ID='11111111-1111-4111-8111-111111111111';
let ownerIdentity:DeviceIdentity;
let mamaIdentity:DeviceIdentity;

beforeAll(async()=>{
  ownerIdentity=await generateDeviceIdentity();
  mamaIdentity=await generateDeviceIdentity();
});

beforeEach(async()=>{
  vi.restoreAllMocks();
  await clearLocalData();
  await createLockedDeviceProfile(ownerIdentity,PIN);
  await saveProfile({familyId:FAMILY_ID,memberId:OWNER_ID,deviceId:OWNER_DEVICE_ID,familyChatId:FAMILY_CHAT_ID,status:'active',csrfToken:'csrf-owner',memberDisplayName:'Александр',familyDisplayName:'Наша семья'});
});

describe('browser direct chat key flow',()=>{
  it('creates the conversation key locally and sends only sealed copies for every active device',async()=>{
    let initializeBody='';
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const path=String(input);
      if(path===`/v1/direct-chats/${MAMA_ID}/prepare`){
        return new Response(JSON.stringify({
          chatId:DIRECT_CHAT_ID,kind:'direct',keyInitialized:false,
          recipientDevices:[
            {deviceId:OWNER_DEVICE_ID,memberId:OWNER_ID,encryptionPublicKey:toBase64(ownerIdentity.encryptionPublicKey)},
            {deviceId:MAMA_DEVICE_ID,memberId:MAMA_ID,encryptionPublicKey:toBase64(mamaIdentity.encryptionPublicKey)}
          ]
        }),{status:201,headers:{'content-type':'application/json'}});
      }
      if(path===`/v1/chats/${DIRECT_CHAT_ID}/keys/initialize`){
        initializeBody=String(init?.body??'');
        return new Response(JSON.stringify({chatId:DIRECT_CHAT_ID,keyVersion:1}),{status:201,headers:{'content-type':'application/json'}});
      }
      throw new Error(`unexpected_fetch:${path}`);
    }));

    const opened=await openOrCreateDirectChat(MAMA_ID,PIN);
    expect(opened).toEqual(expect.objectContaining({chatId:DIRECT_CHAT_ID,keyVersion:1}));
    const local=await loadChatKey(DIRECT_CHAT_ID,PIN);
    const payload=JSON.parse(initializeBody) as {keyVersion:number;envelopes:Array<{deviceId:string;sealedKeyEnvelope:string}>};
    expect(payload.keyVersion).toBe(1);
    expect(payload.envelopes.map(x=>x.deviceId).sort()).toEqual([OWNER_DEVICE_ID,MAMA_DEVICE_ID].sort());
    expect(initializeBody).not.toContain(toBase64(local.key));

    const ownerEnvelope=payload.envelopes.find(x=>x.deviceId===OWNER_DEVICE_ID)!;
    const mamaEnvelope=payload.envelopes.find(x=>x.deviceId===MAMA_DEVICE_ID)!;
    const openedForOwner=await openConversationKey(ownerEnvelope.sealedKeyEnvelope,ownerIdentity.encryptionPublicKey,ownerIdentity.encryptionPrivateKey);
    const openedForMama=await openConversationKey(mamaEnvelope.sealedKeyEnvelope,mamaIdentity.encryptionPublicKey,mamaIdentity.encryptionPrivateKey);
    expect(Array.from(openedForOwner)).toEqual(Array.from(local.key));
    expect(Array.from(openedForMama)).toEqual(Array.from(local.key));
  });

  it('restores an already initialized direct-chat key from this device sealed envelope',async()=>{
    const key=new Uint8Array(32).fill(23);
    const sealed=await sealConversationKey(key,ownerIdentity.encryptionPublicKey);
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{
      const path=String(input);
      if(path===`/v1/direct-chats/${MAMA_ID}/prepare`){
        return new Response(JSON.stringify({chatId:DIRECT_CHAT_ID,kind:'direct',keyInitialized:true,recipientDevices:[]}),{status:200,headers:{'content-type':'application/json'}});
      }
      if(path===`/v1/keys/chat/${DIRECT_CHAT_ID}/current`){
        return new Response(JSON.stringify({keyVersion:1,sealedKeyEnvelope:sealed}),{status:200,headers:{'content-type':'application/json'}});
      }
      throw new Error(`unexpected_fetch:${path}`);
    }));

    await openOrCreateDirectChat(MAMA_ID,PIN);
    const local=await loadChatKey(DIRECT_CHAT_ID,PIN);
    expect(local.keyVersion).toBe(1);
    expect(Array.from(local.key)).toEqual(Array.from(key));
  });
});
