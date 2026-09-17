import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { consumeDeviceLinkTokenFromHash } from './flows/device-link.js';
import { consumeJoinTokenFromHash } from './flows/join.js';
import { loadProfile } from './local/session.js';
import App from './App.js';

vi.mock('./local/session.js',()=>({
  loadProfile:vi.fn()
}));
vi.mock('./flows/join.js',()=>({
  consumeJoinTokenFromHash:vi.fn()
}));
vi.mock('./flows/device-link.js',()=>({
  consumeDeviceLinkTokenFromHash:vi.fn()
}));
vi.mock('./components/ThemeControl.js',()=>({
  ThemeControl:()=>null
}));
vi.mock('./screens/AcceptDeviceLinkScreen.js',()=>({
  AcceptDeviceLinkScreen:({token}:{token:string})=><main>DEVICE LINK ROUTE {token}</main>
}));
vi.mock('./screens/FamilyChatScreen.js',()=>({
  FamilyChatScreen:()=> <main>FAMILY CHAT</main>
}));
vi.mock('./screens/AdminScreen.js',()=>({
  AdminScreen:()=> <aside>FAMILY MANAGEMENT</aside>
}));

(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;

beforeEach(()=>{
  vi.mocked(loadProfile).mockResolvedValue(null);
  vi.mocked(consumeJoinTokenFromHash).mockReturnValue(null);
  vi.mocked(consumeDeviceLinkTokenFromHash).mockReturnValue('device-token');
});
afterEach(()=>vi.clearAllMocks());

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

  it('shows the approved four-section navigation for an active member',async()=>{
    vi.mocked(loadProfile).mockResolvedValue({
      familyId:'11111111-1111-4111-8111-111111111111',
      memberId:'22222222-2222-4222-8222-222222222222',
      deviceId:'33333333-3333-4333-8333-333333333333',
      familyChatId:'44444444-4444-4444-8444-444444444444',
      status:'active',
      csrfToken:'csrf',
      memberDisplayName:'Александр',
      familyDisplayName:'Наша семья'
    });
    const container=document.createElement('div');
    document.body.appendChild(container);
    const root=createRoot(container);
    try{
      await act(async()=>{root.render(<App/>);});
      await act(async()=>{await Promise.resolve();});
      expect(container.textContent).toContain('Чаты');
      expect(container.textContent).toContain('Контакты');
      expect(container.textContent).toContain('Профиль');
      expect(container.textContent).toContain('Устройства');
      expect(container.textContent).toContain('FAMILY CHAT');
    }finally{
      await act(async()=>root.unmount());
      container.remove();
    }
  });
});
