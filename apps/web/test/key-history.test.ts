// @vitest-environment node
import 'fake-indexeddb/auto';
import {afterEach,expect,it} from 'vitest';
import {generateDeviceIdentity,generateConversationKey} from '@family-messenger/crypto';
import {clearLocalData,resetDbHandleForTests} from '../src/local/db.js';
import {createLockedDeviceProfile,saveChatKey,loadChatKey,listStoredChatKeys} from '../src/local/keystore.js';
const pin='246824';
afterEach(async()=>{await clearLocalData();resetDbHandleForTests();});
it('keeps old conversation keys readable after rotation and never downgrades current key',async()=>{
 await createLockedDeviceProfile(await generateDeviceIdentity(),pin);
 const old=await generateConversationKey(),fresh=await generateConversationKey();
 await saveChatKey('chat',1,old,pin);await saveChatKey('chat',2,fresh,pin);
 expect(Array.from((await loadChatKey('chat',pin,1)).key)).toEqual(Array.from(old));
 await saveChatKey('chat',1,old,pin);
 expect((await loadChatKey('chat',pin)).keyVersion).toBe(2);
});
it('enumerates every locally available key version across chats for trusted provisioning',async()=>{
 await createLockedDeviceProfile(await generateDeviceIdentity(),pin);
 const family1=await generateConversationKey(),family2=await generateConversationKey(),direct1=await generateConversationKey();
 await saveChatKey('family-chat',1,family1,pin);await saveChatKey('family-chat',2,family2,pin);await saveChatKey('direct-chat',1,direct1,pin);
 const items=await listStoredChatKeys(pin);
 expect(items.map(item=>`${item.chatId}:${item.keyVersion}`)).toEqual(['direct-chat:1','family-chat:1','family-chat:2']);
 expect(Array.from(items.find(item=>item.chatId==='family-chat'&&item.keyVersion===1)!.key)).toEqual(Array.from(family1));
});
