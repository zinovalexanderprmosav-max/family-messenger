import 'fake-indexeddb/auto';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { fromBase64,generateDeviceIdentity,openConversationKey,toBase64 } from '@family-messenger/crypto';
import { clearLocalData,resetDbHandleForTests } from '../src/local/db.js';
import { createLockedDeviceProfile,loadChatKey } from '../src/local/keystore.js';
import { saveProfile } from '../src/local/session.js';
import { openDirectChat } from '../src/flows/direct-chat.js';

const pin='2468';

afterEach(async()=>{
  vi.unstubAllGlobals();
  await clearLocalData();
  resetDbHandleForTests();
});

describe('mobile direct chat flow',()=>{
  it('creates a shared E2EE key for both phones and stores the clear key only locally',async()=>{
    const me=await generateDeviceIdentity();
    const other=await generateDeviceIdentity();
    await createLockedDeviceProfile(me,pin);
    await saveProfile({familyId:'family-1',memberId:'member-me',deviceId:'device-me',familyChatId:'family-chat',status:'active',csrfToken:'csrf',memberDisplayName:'Alex',familyDisplayName:'Family'});

    let otherEnvelope='';
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const path=String(input);
      if(path==='/v1/members/member-other/direct-chat'&&(!init?.method||init.method==='GET')){
        return new Response(JSON.stringify({status:'needs_key',devices:[
          {deviceId:'device-me',memberId:'member-me',encryptionPublicKey:toBase64(me.encryptionPublicKey)},
          {deviceId:'device-other',memberId:'member-other',encryptionPublicKey:toBase64(other.encryptionPublicKey)}
        ]}),{status:200,headers:{'content-type':'application/json'}});
      }
      if(path==='/v1/members/member-other/direct-chat'&&init?.method==='POST'){
        const body=JSON.parse(String(init.body)) as {envelopes:Array<{deviceId:string;sealedKeyEnvelope:string}>};
        const mine=body.envelopes.find(item=>item.deviceId==='device-me');
        const theirs=body.envelopes.find(item=>item.deviceId==='device-other');
        if(!mine||!theirs)throw new Error('missing_device_envelope');
        otherEnvelope=theirs.sealedKeyEnvelope;
        return new Response(JSON.stringify({status:'ready',chatId:'direct-1',keyVersion:1,sealedKeyEnvelope:mine.sealedKeyEnvelope}),{status:201,headers:{'content-type':'application/json'}});
      }
      throw new Error(`unexpected_fetch:${path}`);
    });
    vi.stubGlobal('fetch',fetchMock);

    const opened=await openDirectChat('member-other',pin);
    expect(opened).toEqual({chatId:'direct-1',keyVersion:1});
    const local=await loadChatKey('direct-1',pin);
    const onOtherPhone=await openConversationKey(otherEnvelope,other.encryptionPublicKey,other.encryptionPrivateKey);
    expect(Array.from(local.key)).toEqual(Array.from(onOtherPhone));
    expect(local.key).toHaveLength(32);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
