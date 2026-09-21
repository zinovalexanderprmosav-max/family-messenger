// @vitest-environment node
import 'fake-indexeddb/auto';
import {afterEach,expect,it} from 'vitest';
import {generateDeviceIdentity,generateConversationKey} from '@family-messenger/crypto';
import {clearLocalData,resetDbHandleForTests} from '../src/local/db.js';
import {createLockedDeviceProfile,saveChatKey,loadChatKey} from '../src/local/keystore.js';
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
