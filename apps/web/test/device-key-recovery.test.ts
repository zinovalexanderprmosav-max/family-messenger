// @vitest-environment node
import 'fake-indexeddb/auto';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {generateDeviceIdentity,toBase64} from '@family-messenger/crypto';
import {clearLocalData,resetDbHandleForTests} from '../src/local/db.js';
import {createLockedDeviceProfile} from '../src/local/keystore.js';
import {loadProfile} from '../src/local/session.js';
import {recoverExistingDeviceWithPin} from '../src/flows/device-key-recovery.js';

afterEach(async()=>{
  vi.unstubAllGlobals();
  await clearLocalData();
  resetDbHandleForTests();
});

describe('existing device PIN recovery',()=>{
  it('re-authenticates the same device with its signing key and restores profile',async()=>{
    const pin='246824';
    const identity=await generateDeviceIdentity();
    await createLockedDeviceProfile(identity,pin);

    const deviceId='33333333-3333-4333-8333-333333333333';
    const familyId='11111111-1111-4111-8111-111111111111';
    const memberId='22222222-2222-4222-8222-222222222222';
    const familyChatId='44444444-4444-4444-8444-444444444444';
    const calls:Array<{url:string;body?:unknown}>=[];

    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      const body=init?.body?JSON.parse(String(init.body)):undefined;
      calls.push({url,body});

      if(url==='/v1/auth/identify'){
        expect(body).toEqual({signingPublicKey:toBase64(identity.signingPublicKey)});
        return new Response(JSON.stringify({deviceId}),{status:200,headers:{'content-type':'application/json'}});
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
        expect(body.signature.length).toBeGreaterThan(20);
        return new Response(JSON.stringify({csrfToken:'csrf',memberId,familyId,deviceId}),{
          status:200,headers:{'content-type':'application/json'}
        });
      }
      if(url==='/v1/session/context'){
        return new Response(JSON.stringify({
          familyId,memberId,deviceId,familyChatId,status:'active',csrfToken:'csrf',
          familyDisplayName:'Наша семья',memberDisplayName:'Папа',deviceName:'Мой iPhone'
        }),{status:200,headers:{'content-type':'application/json'}});
      }
      return new Response(JSON.stringify({error:'unexpected_request'}),{status:500,headers:{'content-type':'application/json'}});
    }));

    const result=await recoverExistingDeviceWithPin(pin);
    expect(result.familyDisplayName).toBe('Наша семья');
    expect(calls.map(item=>item.url)).toEqual([
      '/v1/auth/identify','/v1/auth/challenge','/v1/auth/complete','/v1/session/context'
    ]);
    expect(await loadProfile()).toMatchObject({
      familyId,memberId,deviceId,familyChatId,
      memberDisplayName:'Папа',familyDisplayName:'Наша семья'
    });
  });

  it('does not create a family when no old encrypted keystore exists',async()=>{
    await expect(recoverExistingDeviceWithPin('246824')).rejects.toThrow('recovery_keystore_not_found');
  });
});
