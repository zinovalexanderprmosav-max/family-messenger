// @vitest-environment node
import 'fake-indexeddb/auto';
import {afterEach,describe,expect,it} from 'vitest';
import {encryptMessagePayload,generateDeviceIdentity} from '@family-messenger/crypto';
import type {StoredMessageEnvelope} from '@family-messenger/protocol';
import {clearLocalData,getDb,resetDbHandleForTests} from '../src/local/db.js';
import {createLockedDeviceProfile,saveChatKey} from '../src/local/keystore.js';
import {saveProfile} from '../src/local/session.js';
import {readLocalVisibleMessages} from '../src/flows/messages.js';

const pin='246824';
const chatId='11111111-1111-4111-8111-111111111111';
const deviceId='33333333-3333-4333-8333-333333333333';
const originalId='44444444-4444-4444-8444-444444444444';
const editId='55555555-5555-4555-8555-555555555555';
const deleteId='66666666-6666-4666-8666-666666666666';

afterEach(async()=>{
  await clearLocalData();
  resetDbHandleForTests();
});

async function setup(){
  const identity=await generateDeviceIdentity();
  const key=new Uint8Array(32).fill(7);
  await createLockedDeviceProfile(identity,pin);
  await saveChatKey(chatId,1,key,pin);
  await saveProfile({
    familyId:'family-1',memberId:'member-me',deviceId,familyChatId:chatId,status:'active',
    csrfToken:'csrf',memberDisplayName:'Alex',familyDisplayName:'Family'
  });
  return key;
}

function stored<T extends {sequence?:never;acceptedAt?:never}>(envelope:T,sequence:string):T&{sequence:string;acceptedAt:string}{
  return {...envelope,sequence,acceptedAt:`2026-09-22T12:00:0${sequence}.000Z`};
}

describe('message edit/delete history',()=>{
  it('applies an encrypted edit and then an encrypted delete to the original message',async()=>{
    const key=await setup();
    const original=stored(await encryptMessagePayload({
      messageId:originalId,chatId,senderDeviceId:deviceId,keyVersion:1,key,
      payload:{kind:'text',text:'Первый текст',sentAt:'2026-09-22T12:00:00.000Z'}
    }),'1') as StoredMessageEnvelope;
    const edit=stored(await encryptMessagePayload({
      messageId:editId,chatId,senderDeviceId:deviceId,keyVersion:1,key,
      payload:{kind:'edit',text:'Исправленный текст',sentAt:'2026-09-22T12:01:00.000Z'},
      mutation:{kind:'edit',targetMessageId:originalId}
    }),'2') as StoredMessageEnvelope;

    const db=await getDb();
    await db.put('messages',original);await db.put('messages',edit);

    const edited=await readLocalVisibleMessages(chatId,pin);
    expect(edited).toHaveLength(1);
    expect(edited[0]).toMatchObject({messageId:originalId,kind:'text',text:'Исправленный текст',editedAt:'2026-09-22T12:01:00.000Z'});

    const deletion=stored(await encryptMessagePayload({
      messageId:deleteId,chatId,senderDeviceId:deviceId,keyVersion:1,key,
      payload:{kind:'delete',sentAt:'2026-09-22T12:02:00.000Z'},
      mutation:{kind:'delete',targetMessageId:originalId}
    }),'3') as StoredMessageEnvelope;
    await db.put('messages',deletion);

    const deleted=await readLocalVisibleMessages(chatId,pin);
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatchObject({messageId:originalId,kind:'deleted',deletedAt:'2026-09-22T12:02:00.000Z'});
  });
});
