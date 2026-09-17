import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import App from './App.js';
import { loadProfile } from './local/session.js';

vi.mock('./local/session.js',()=>({loadProfile:vi.fn(),getUnlockedPin:()=> '123456'}));
vi.mock('./flows/join.js',()=>({consumeJoinTokenFromHash:()=>null}));
vi.mock('./flows/device-link.js',()=>({consumeDeviceLinkTokenFromHash:()=>null,createDeviceLink:vi.fn()}));
vi.mock('./flows/chats.js',()=>({openOrCreateDirectChat:vi.fn()}));
vi.mock('./components/ThemeControl.js',()=>({ThemeControl:()=>null}));
vi.mock('./screens/FamilyChatScreen.js',()=>({FamilyChatScreen:()=> <main>CHAT</main>}));

(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;

const profile={
  familyId:'11111111-1111-4111-8111-111111111111',memberId:'22222222-2222-4222-8222-222222222222',deviceId:'33333333-3333-4333-8333-333333333333',familyChatId:'44444444-4444-4444-8444-444444444444',status:'active' as const,csrfToken:'csrf',memberDisplayName:'Александр',familyDisplayName:'Наша семья'
};

beforeEach(()=>{
  vi.mocked(loadProfile).mockResolvedValue(profile);
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{
    const path=typeof input==='string'?input:input instanceof URL?input.toString():input.url;
    if(path==='/v1/chats')return new Response(JSON.stringify({items:[{chatId:profile.familyChatId,kind:'family',title:'Наша семья'}]}),{status:200,headers:{'content-type':'application/json'}});
    if(path==='/v1/devices')return new Response(JSON.stringify({items:[{
      deviceId:profile.deviceId,memberId:profile.memberId,memberDisplayName:'Александр',memberRole:'owner',deviceName:'iPhone Александра',status:'active',createdAt:'2026-09-01T07:00:00.000Z',lastSeenAt:'2026-09-17T06:00:00.000Z',encryptionPublicKey:'public-key',canManage:true
    }]}),{status:200,headers:{'content-type':'application/json'}});
    return new Response(JSON.stringify({error:'unexpected_request'}),{status:404,headers:{'content-type':'application/json'}});
  }));
});
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});

describe('Devices navigation',()=>{
  it('shows manageable devices and the add-my-device action',async()=>{
    const container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container);
    try{
      await act(async()=>{root.render(<App/>);});
      await act(async()=>{await Promise.resolve();await Promise.resolve();});
      const devicesButton=Array.from(container.querySelectorAll('button')).find(button=>button.textContent==='Устройства');
      expect(devicesButton).toBeTruthy();
      await act(async()=>{devicesButton!.dispatchEvent(new MouseEvent('click',{bubbles:true}));await Promise.resolve();await Promise.resolve();});
      expect(container.textContent).toContain('iPhone Александра');
      expect(container.textContent).toContain('Подключить моё устройство');
    }finally{await act(async()=>root.unmount());container.remove();}
  });
});
