// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';
import { generateDeviceIdentity,openConversationKey,sealConversationKey,toBase64,type DeviceIdentity } from '@family-messenger/crypto';
import { clearLocalData } from '../local/db.js';
import { createLockedDeviceProfile,loadChatKey,saveChatKey } from '../local/keystore.js';
import { saveProfile } from '../local/session.js';
import { processPendingRotations } from './key-rotation.js';

const PIN='123456';
const FAMILY_ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER_ID='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWNER_DEVICE_ID='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTHER_ID='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const OTHER_DEVICE_ID='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const CHAT_ID='ffffffff-ffff-4fff-8fff-ffffffffffff';
let ownerIdentity:DeviceIdentity;
let otherIdentity:DeviceIdentity;

beforeAll(async()=>{
  ownerIdentity=await generateDeviceIdentity();
  otherIdentity=await generateDeviceIdentity();
});

beforeEach(async()=>{
  vi.restoreAllMocks();
  await clearLocalData();
  await createLockedDeviceProfile(ownerIdentity,PIN);
  await saveProfile({familyId:FAMILY_ID,memberId:OWNER_ID,deviceId:OWNER_DEVICE_ID,familyChatId:CHAT_ID,status:'active',csrfToken:'csrf-owner',memberDisplayName:'Александр',familyDisplayName:'Наша семья'});
  await saveChatKey(CHAT_ID,1,new Uint8Array(32).fill(7),PIN);
});

describe('browser key rotation worker',()=>{
  it('creates a fresh key locally, seals it for every remaining device, and stores only the local copy',async()=>{
    let rotationBody='';
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const path=String(input);
      if(path==='/v1/key-rotations'){
        return new Response(JSON.stringify({items:[{
          chatId:CHAT_ID,fromKeyVersion:1,toKeyVersion:2,reason:'device_revoked',recipientDevices:[
            {deviceId:OWNER_DEVICE_ID,memberId:OWNER_ID,encryptionPublicKey:toBase64(ownerIdentity.encryptionPublicKey)},
            {deviceId:OTHER_DEVICE_ID,memberId:OTHER_ID,encryptionPublicKey:toBase64(otherIdentity.encryptionPublicKey)}
          ]
        }]}),{status:200,headers:{'content-type':'application/json'}});
      }
      if(path===`/v1/chats/${CHAT_ID}/key-rotation`){
        rotationBody=String(init?.body??'');
        return new Response(JSON.stringify({chatId:CHAT_ID,keyVersion:2}),{status:201,headers:{'content-type':'application/json'}});
      }
      throw new Error(`unexpected_fetch:${path}`);
    }));

    await processPendingRotations(PIN);
    const local=await loadChatKey(CHAT_ID,PIN);
    expect(local.keyVersion).toBe(2);
    const body=JSON.parse(rotationBody) as {toKeyVersion:number;envelopes:Array<{deviceId:string;sealedKeyEnvelope:string}>};
    expect(body.toKeyVersion).toBe(2);
    expect(body.envelopes.map(x=>x.deviceId).sort()).toEqual([OWNER_DEVICE_ID,OTHER_DEVICE_ID].sort());
    expect(rotationBody).not.toContain(toBase64(local.key));

    const ownerEnvelope=body.envelopes.find(x=>x.deviceId===OWNER_DEVICE_ID)!;
    const otherEnvelope=body.envelopes.find(x=>x.deviceId===OTHER_DEVICE_ID)!;
    const openedOwner=await openConversationKey(ownerEnvelope.sealedKeyEnvelope,ownerIdentity.encryptionPublicKey,ownerIdentity.encryptionPrivateKey);
    const openedOther=await openConversationKey(otherEnvelope.sealedKeyEnvelope,otherIdentity.encryptionPublicKey,otherIdentity.encryptionPrivateKey);
    expect(Array.from(openedOwner)).toEqual(Array.from(local.key));
    expect(Array.from(openedOther)).toEqual(Array.from(local.key));
  });

  it('recovers the canonical new key when another active device wins the rotation race',async()=>{
    const canonicalKey=new Uint8Array(32).fill(29);
    const sealedForOwner=await sealConversationKey(canonicalKey,ownerIdentity.encryptionPublicKey);
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{
      const path=String(input);
      if(path==='/v1/key-rotations'){
        return new Response(JSON.stringify({items:[{
          chatId:CHAT_ID,fromKeyVersion:1,toKeyVersion:2,reason:'device_revoked',recipientDevices:[
            {deviceId:OWNER_DEVICE_ID,memberId:OWNER_ID,encryptionPublicKey:toBase64(ownerIdentity.encryptionPublicKey)}
          ]
        }]}),{status:200,headers:{'content-type':'application/json'}});
      }
      if(path===`/v1/chats/${CHAT_ID}/key-rotation`){
        return new Response(JSON.stringify({error:'key_rotation_already_completed'}),{status:409,headers:{'content-type':'application/json'}});
      }
      if(path===`/v1/keys/chat/${CHAT_ID}/current`){
        return new Response(JSON.stringify({keyVersion:2,sealedKeyEnvelope:sealedForOwner}),{status:200,headers:{'content-type':'application/json'}});
      }
      throw new Error(`unexpected_fetch:${path}`);
    }));

    await processPendingRotations(PIN);
    const local=await loadChatKey(CHAT_ID,PIN);
    expect(local.keyVersion).toBe(2);
    expect(Array.from(local.key)).toEqual(Array.from(canonicalKey));
  });
});
