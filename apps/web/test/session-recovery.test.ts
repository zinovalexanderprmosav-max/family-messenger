// @vitest-environment node
import 'fake-indexeddb/auto';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {generateDeviceIdentity} from '@family-messenger/crypto';
import {clearLocalData,resetDbHandleForTests} from '../src/local/db.js';
import {createLockedDeviceProfile} from '../src/local/keystore.js';
import {loadProfile} from '../src/local/session.js';
import {recoverProfileFromServerSession} from '../src/flows/session-recovery.js';

afterEach(async()=>{
  vi.unstubAllGlobals();
  await clearLocalData();
  resetDbHandleForTests();
});

const context={
  familyId:'11111111-1111-4111-8111-111111111111',
  memberId:'22222222-2222-4222-8222-222222222222',
  deviceId:'33333333-3333-4333-8333-333333333333',
  familyChatId:'44444444-4444-4444-8444-444444444444',
  status:'active' as const,
  csrfToken:'csrf-token',
  familyDisplayName:'Наша семья',
  memberDisplayName:'Папа',
  deviceName:'Мой iPhone'
};

describe('server session profile recovery',()=>{
  it('restores a missing local profile when encrypted keystore still exists',async()=>{
    const identity=await generateDeviceIdentity();
    await createLockedDeviceProfile(identity,'246824');

    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(context),{
      status:200,headers:{'content-type':'application/json'}
    })));

    const result=await recoverProfileFromServerSession();
    expect(result.status).toBe('restored');
    expect(await loadProfile()).toMatchObject({
      familyId:context.familyId,
      memberId:context.memberId,
      deviceId:context.deviceId,
      familyChatId:context.familyChatId,
      memberDisplayName:'Папа',
      familyDisplayName:'Наша семья'
    });
  });

  it('blocks duplicate family creation when server knows the device but encryption key is gone',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(context),{
      status:200,headers:{'content-type':'application/json'}
    })));

    const result=await recoverProfileFromServerSession();
    expect(result.status).toBe('keys_missing');
    expect(await loadProfile()).toBeNull();
  });

  it('falls back to normal onboarding only when there is no authenticated session',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:'authentication_required'}),{
      status:401,headers:{'content-type':'application/json'}
    })));

    expect(await recoverProfileFromServerSession()).toEqual({status:'no_session'});
  });
});
