// @vitest-environment node
import 'fake-indexeddb/auto';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {generateDeviceIdentity} from '@family-messenger/crypto';
import {clearLocalData,resetDbHandleForTests} from '../src/local/db.js';
import {
  createLockedDeviceProfile,
  loadEncryptedKeystoreBlob,
  unlockDeviceProfile
} from '../src/local/keystore.js';
import {loadProfile,saveProfile} from '../src/local/session.js';
import {clearLocalShadows,loadRecoveryCode} from '../src/local/shadow.js';
import {
  ensureRecoveryBackup,
  restoreFromRecoveryBackup
} from '../src/flows/recovery-backup.js';

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

describe('encrypted recovery backup',()=>{
  it('uploads only the PIN-encrypted keystore and creates a 128-bit recovery code',async()=>{
    installLocalStorage();
    const pin='246824';
    const identity=await generateDeviceIdentity();
    await createLockedDeviceProfile(identity,pin);
    await saveProfile({
      familyId:'11111111-1111-4111-8111-111111111111',
      memberId:'22222222-2222-4222-8222-222222222222',
      deviceId:'33333333-3333-4333-8333-333333333333',
      familyChatId:'44444444-4444-4444-8444-444444444444',
      status:'active',
      csrfToken:'csrf-token',
      memberDisplayName:'Папа',
      familyDisplayName:'Наша семья'
    });

    let backupBody:any;
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      expect(String(input)).toBe('/v1/recovery/backup');
      expect(new Headers(init?.headers).get('x-csrf-token')).toBe('csrf-token');
      backupBody=JSON.parse(String(init?.body));
      return new Response(null,{status:204});
    }));

    const code=await ensureRecoveryBackup();
    expect(code.replace(/-/g,'')).toMatch(/^[A-F0-9]{32}$/);
    expect(loadRecoveryCode()).toBe(code);
    expect(backupBody.recoveryCode).toBe(code);
    expect(backupBody.encryptedKeystore.ciphertext).toBeTruthy();
    expect(JSON.stringify(backupBody)).not.toContain(identity.signingPrivateKey.toString());
  });

  it('restores the same device from recovery code plus PIN after local storage is lost',async()=>{
    installLocalStorage();
    const pin='246824';
    const identity=await generateDeviceIdentity();
    await createLockedDeviceProfile(identity,pin);
    const encrypted=await loadEncryptedKeystoreBlob();
    if(!encrypted)throw new Error('missing encrypted keystore');

    await clearLocalData();
    clearLocalShadows();
    resetDbHandleForTests();

    const deviceId='33333333-3333-4333-8333-333333333333';
    const familyId='11111111-1111-4111-8111-111111111111';
    const memberId='22222222-2222-4222-8222-222222222222';
    const familyChatId='44444444-4444-4444-8444-444444444444';
    const code='AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-1111-2222';
    const calls:string[]=[];

    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);calls.push(url);
      const body=init?.body?JSON.parse(String(init.body)):undefined;
      if(url==='/v1/recovery/restore'){
        expect(body).toEqual({recoveryCode:code});
        return new Response(JSON.stringify({deviceId,encryptedKeystore:encrypted}),{
          status:200,headers:{'content-type':'application/json'}
        });
      }
      if(url==='/v1/auth/challenge'){
        expect(body).toEqual({deviceId});
        return new Response(JSON.stringify({
          challengeId:'55555555-5555-4555-8555-555555555555',
          challenge:'challenge-value',
          expiresInSeconds:120
        }),{status:200,headers:{'content-type':'application/json'}});
      }
      if(url==='/v1/auth/complete'){
        expect(body.deviceId).toBe(deviceId);
        expect(typeof body.signature).toBe('string');
        return new Response(JSON.stringify({csrfToken:'csrf-new',memberId,familyId,deviceId}),{
          status:200,headers:{'content-type':'application/json'}
        });
      }
      if(url==='/v1/session/context'){
        return new Response(JSON.stringify({
          familyId,memberId,deviceId,familyChatId,status:'active',
          csrfToken:'csrf-new',familyDisplayName:'Наша семья',
          memberDisplayName:'Папа',deviceName:'Мой iPhone'
        }),{status:200,headers:{'content-type':'application/json'}});
      }
      return new Response(JSON.stringify({error:'unexpected_request'}),{
        status:500,headers:{'content-type':'application/json'}
      });
    }));

    await restoreFromRecoveryBackup(code,pin);

    expect(calls).toEqual([
      '/v1/recovery/restore',
      '/v1/auth/challenge',
      '/v1/auth/complete',
      '/v1/session/context'
    ]);
    expect(await loadProfile()).toMatchObject({
      familyId,memberId,deviceId,familyChatId,
      memberDisplayName:'Папа',familyDisplayName:'Наша семья'
    });
    expect(loadRecoveryCode()).toBe(code);
    const plain=await unlockDeviceProfile(pin);
    expect(plain.signingPublicKey).toBeTruthy();
    expect(plain.signingPrivateKey).toBeTruthy();
  });
});
