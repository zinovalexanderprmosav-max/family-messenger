// @vitest-environment node
import 'fake-indexeddb/auto';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {generateDeviceIdentity} from '@family-messenger/crypto';
import {clearLocalData,getDb,resetDbHandleForTests,type LocalProfile} from '../src/local/db.js';
import {createLockedDeviceProfile,unlockDeviceProfile} from '../src/local/keystore.js';
import {loadProfile,saveProfile} from '../src/local/session.js';
import {clearLocalShadows} from '../src/local/shadow.js';

const pin='246824';
const profile:LocalProfile={
  familyId:'family-1',memberId:'member-1',deviceId:'device-1',familyChatId:'chat-1',
  status:'active',csrfToken:'csrf',memberDisplayName:'Папа',familyDisplayName:'Наша семья'
};

function installLocalStorage(){
  const map=new Map<string,string>();
  vi.stubGlobal('localStorage',{
    getItem:(key:string)=>map.get(key)??null,
    setItem:(key:string,value:string)=>{map.set(key,String(value));},
    removeItem:(key:string)=>{map.delete(key);},
    clear:()=>map.clear(),
    key:(index:number)=>[...map.keys()][index]??null,
    get length(){return map.size;}
  });
}

afterEach(async()=>{
  await clearLocalData();
  clearLocalShadows();
  resetDbHandleForTests();
  vi.unstubAllGlobals();
});

describe('iOS device continuity fallback',()=>{
  it('restores profile and encrypted keystore when IndexedDB rows disappear',async()=>{
    installLocalStorage();
    const identity=await generateDeviceIdentity();
    await createLockedDeviceProfile(identity,pin);
    await saveProfile(profile);

    const db=await getDb();
    await db.delete('profile','current');
    await db.delete('keystore','device');

    expect(await db.get('profile','current')).toBeUndefined();
    expect(await db.get('keystore','device')).toBeUndefined();

    const restored=await loadProfile();
    expect(restored).toEqual(profile);
    expect(await db.get('profile','current')).toEqual({id:'current',profile});

    const unlocked=await unlockDeviceProfile(pin);
    expect(unlocked.encryptionPublicKey).toBeTruthy();
    expect(unlocked.encryptionPrivateKey).toBeTruthy();
    expect(await db.get('keystore','device')).toBeTruthy();
  });
});
