// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { clearLocalData } from '../local/db.js';
import { loadProfile,setUnlockedPin } from '../local/session.js';
import { acceptDeviceLink,consumeDeviceLinkTokenFromHash } from './device-link.js';

const TOKEN='device-link-token-abcdefghijklmnopqrstuvwxyz123456';
const FAMILY_ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEMBER_ID='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DEVICE_ID='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CHAT_ID='dddddddd-dddd-4ddd-8ddd-dddddddddddd';

beforeEach(async()=>{
  vi.restoreAllMocks();
  setUnlockedPin(undefined);
  await clearLocalData();
});

describe('additional device linking',()=>{
  it('extracts the device-link token and removes it from the visible URL',()=>{
    const replaceState=vi.fn();
    const token=consumeDeviceLinkTokenFromHash({hash:`#/device-link?token=${encodeURIComponent(TOKEN)}`} as Pick<Location,'hash'>,{replaceState} as Pick<History,'replaceState'>);
    expect(token).toBe(TOKEN);
    expect(replaceState).toHaveBeenCalledWith(null,'','/#/device-link');
  });

  it('stores the server-returned existing member id instead of creating a duplicate profile',async()=>{
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      expect(String(input)).toBe('/v1/device-links/accept');
      const body=JSON.parse(String(init?.body??'{}')) as Record<string,unknown>;
      expect(body.linkToken).toBe(TOKEN);
      expect(body.deviceName).toBe('Рабочий ПК');
      expect(body).not.toHaveProperty('memberDisplayName');
      return new Response(JSON.stringify({familyId:FAMILY_ID,memberId:MEMBER_ID,deviceId:DEVICE_ID,familyChatId:CHAT_ID,status:'pending_key',csrfToken:'csrf-new'}),{status:201,headers:{'content-type':'application/json'}});
    }));

    await acceptDeviceLink({linkToken:TOKEN,deviceName:'Рабочий ПК',pin:'123456',memberDisplayName:'Александр',familyDisplayName:'Наша семья'});
    const profile=await loadProfile();
    expect(profile).toEqual(expect.objectContaining({familyId:FAMILY_ID,memberId:MEMBER_ID,deviceId:DEVICE_ID,familyChatId:CHAT_ID,status:'pending_key',memberDisplayName:'Александр',familyDisplayName:'Наша семья'}));
  });
});
