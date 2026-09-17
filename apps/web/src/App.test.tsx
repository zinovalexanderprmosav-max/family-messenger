import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { consumeDeviceLinkTokenFromHash } from './flows/device-link.js';
import { consumeJoinTokenFromHash } from './flows/join.js';
import { openOrCreateDirectChat } from './flows/chats.js';
import { loadProfile } from './local/session.js';
import App from './App.js';

vi.mock('./local/session.js',()=>({
  loadProfile:vi.fn(),
  getUnlockedPin:()=> '123456'
}));
vi.mock('./flows/join.js',()=>({
  consumeJoinTokenFromHash:vi.fn()
}));
vi.mock('./flows/device-link.js',()=>({
  consumeDeviceLinkTokenFromHash:vi.fn()
}));
vi.mock('./flows/chats.js',()=>({
  openOrCreateDirectChat:vi.fn()
}));
vi.mock('./components/ThemeControl.js',()=>({
  ThemeControl:()=>null
}));
vi.mock('./screens/AcceptDeviceLinkScreen.js',()=>({
  AcceptDeviceLinkScreen:({token}:{token:string})=><main>DEVICE LINK ROUTE {token}</main>
}));
vi.mock('./screens/FamilyChatScreen.js',()=>({
  FamilyChatScreen:({title}:{title?:string})=> <main>{title?`DIRECT CHAT ${title}`:'FAMILY CHAT'}</main>
}));

(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;

const activeProfile={
  familyId:'11111111-1111-4111-8111-111111111111',
  memberId:'22222222-2222-4222-8222-222222222222',
  deviceId:'33333333-3333-4333-8333-333333333333',
  familyChatId:'44444444-4444-4444-8444-444444444444',
  status:'active' as const,
  csrfToken:'csrf',
  memberDisplayName:'Александр',
  familyDisplayName:'Наша семья'
};

beforeEach(()=>{
  vi.mocked(loadProfile).mockResolvedValue(null);
  vi.mocked(consumeJoinTokenFromHash).mockReturnValue(null);
  vi.mocked(consumeDeviceLinkTokenFromHash).mockReturnValue('device-token');
  vi.mocked(openOrCreateDirectChat).mockResolvedValue({chatId:'55555555-5555-4555-8555-555555555555',keyVersion:1});
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{
    const path=typeof input==='string'?input:input instanceof URL?input.toString():input.url;
    if(path==='/v1/contacts')return new Response(JSON.stringify({items:[{memberId:'66666666-6666-4666-8666-666666666666',displayName:'Мама',role:'admin'}]}),{status:200,headers:{'content-type':'application/json'}});
    if(path==='/v1/chats')return new Response(JSON.stringify({items:[
      {chatId:activeProfile.familyChatId,kind:'family',title:'Наша семья'},
      {chatId:'55555555-5555-4555-8555-555555555555',kind:'direct',title:'Мама',otherMemberId:'66666666-6666-4666-8666-666666666666'}
    ]}),{status:200,headers:{'content-type':'application/json'}});
    if(path==='/v1/family')return new Response(JSON.stringify({
      id:activeProfile.familyId,
      displayName:'Наша семья',
      familyChatId:activeProfile.familyChatId,
      members:[
        {id:activeProfile.memberId,displayName:'Александр',role:'owner',status:'active'},
        {id:'66666666-6666-4666-8666-666666666666',displayName:'Мама',role:'admin',status:'active'}
      ]
    }),{status:200,headers:{'content-type':'application/json'}});
    return new Response(JSON.stringify({error:'unexpected_request'}),{status:404,headers:{'content-type':'application/json'}});
  }));
});
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});

describe('App routing',()=>{
  it('opens the additional-device enrollment screen before the normal welcome flow',async()=>{
    const container=document.createElement('div');
    document.body.appendChild(container);
    const root=createRoot(container);
    try{
      await act(async()=>{root.render(<App/>);});
      await act(async()=>{await Promise.resolve();});
      expect(consumeDeviceLinkTokenFromHash).toHaveBeenCalledTimes(1);
      expect(container.textContent).toContain('DEVICE LINK ROUTE device-token');
    }finally{
      await act(async()=>root.unmount());
      container.remove();
    }
  });

  it('shows the approved four-section navigation and chat list for an active member',async()=>{
    vi.mocked(loadProfile).mockResolvedValue(activeProfile);
    const container=document.createElement('div');
    document.body.appendChild(container);
    const root=createRoot(container);
    try{
      await act(async()=>{root.render(<App/>);});
      await act(async()=>{await Promise.resolve();await Promise.resolve();});
      expect(container.textContent).toContain('Чаты');
      expect(container.textContent).toContain('Контакты');
      expect(container.textContent).toContain('Профиль');
      expect(container.textContent).toContain('Устройства');
      expect(container.textContent).toContain('Семейный чат');
    }finally{
      await act(async()=>root.unmount());
      container.remove();
    }
  });

  it('shows the family chat first and opens an existing personal chat from the chat list',async()=>{
    vi.mocked(loadProfile).mockResolvedValue(activeProfile);
    const container=document.createElement('div');
    document.body.appendChild(container);
    const root=createRoot(container);
    try{
      await act(async()=>{root.render(<App/>);});
      await act(async()=>{await Promise.resolve();await Promise.resolve();});
      const rows=Array.from(container.querySelectorAll('button.chat-row'));
      expect(rows).toHaveLength(2);
      expect(rows[0]?.textContent).toContain('Семейный чат');
      expect(rows[1]?.textContent).toContain('Мама');
      await act(async()=>{rows[1]!.dispatchEvent(new MouseEvent('click',{bubbles:true}));await Promise.resolve();});
      expect(openOrCreateDirectChat).toHaveBeenCalledWith('66666666-6666-4666-8666-666666666666','123456');
      expect(container.textContent).toContain('DIRECT CHAT Мама');
    }finally{
      await act(async()=>root.unmount());
      container.remove();
    }
  });

  it('loads automatic contacts and opens the selected personal encrypted chat',async()=>{
    vi.mocked(loadProfile).mockResolvedValue(activeProfile);
    const container=document.createElement('div');
    document.body.appendChild(container);
    const root=createRoot(container);
    try{
      await act(async()=>{root.render(<App/>);});
      await act(async()=>{await Promise.resolve();});
      const contactsButton=Array.from(container.querySelectorAll('button')).find(button=>button.textContent==='Контакты');
      expect(contactsButton).toBeTruthy();
      await act(async()=>{contactsButton!.dispatchEvent(new MouseEvent('click',{bubbles:true}));await Promise.resolve();await Promise.resolve();});
      expect(container.textContent).toContain('Мама');
      const mamaButton=Array.from(container.querySelectorAll('button')).find(button=>button.textContent?.includes('Мама'));
      expect(mamaButton).toBeTruthy();
      await act(async()=>{mamaButton!.dispatchEvent(new MouseEvent('click',{bubbles:true}));await Promise.resolve();});
      expect(openOrCreateDirectChat).toHaveBeenCalledWith('66666666-6666-4666-8666-666666666666','123456');
      expect(container.textContent).toContain('DIRECT CHAT Мама');
    }finally{
      await act(async()=>root.unmount());
      container.remove();
    }
  });

  it('shows the current member name, family and owner role in Profile',async()=>{
    vi.mocked(loadProfile).mockResolvedValue(activeProfile);
    const container=document.createElement('div');
    document.body.appendChild(container);
    const root=createRoot(container);
    try{
      await act(async()=>{root.render(<App/>);});
      await act(async()=>{await Promise.resolve();});
      const profileButton=Array.from(container.querySelectorAll('button')).find(button=>button.textContent==='Профиль');
      expect(profileButton).toBeTruthy();
      await act(async()=>{profileButton!.dispatchEvent(new MouseEvent('click',{bubbles:true}));await Promise.resolve();await Promise.resolve();});
      expect(container.textContent).toContain('Александр');
      expect(container.textContent).toContain('Наша семья');
      expect(container.textContent).toContain('Главный администратор');
    }finally{
      await act(async()=>root.unmount());
      container.remove();
    }
  });
});
