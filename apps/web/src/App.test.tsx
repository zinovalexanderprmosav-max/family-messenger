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
vi.mock('./screens/AcceptDeviceLinkScreen.js',()=>({
  AcceptDeviceLinkScreen:({token}:{token:string})=><main>DEVICE LINK ROUTE {token}</main>
}));

(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;

beforeEach(()=>{
  vi.mocked(loadProfile).mockResolvedValue(null);
  vi.mocked(consumeJoinTokenFromHash).mockReturnValue(null);
  vi.mocked(consumeDeviceLinkTokenFromHash).mockReturnValue('device-token');
});
afterEach(()=>vi.clearAllMocks());

describe('App device-link route',()=>{
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
});
