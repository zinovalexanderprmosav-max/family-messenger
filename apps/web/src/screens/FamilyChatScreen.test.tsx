import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { FamilyChatScreen } from './FamilyChatScreen.js';
import { loadProfile } from '../local/session.js';

vi.mock('../local/session.js',()=>({
  getUnlockedPin:()=> '123456',
  setUnlockedPin:vi.fn(),
  loadProfile:vi.fn()
}));
vi.mock('../flows/messages.js',()=>({
  flushOutbox:vi.fn().mockResolvedValue(undefined),
  readLocalVisibleMessages:vi.fn().mockResolvedValue([]),
  reconcileChat:vi.fn().mockResolvedValue([]),
  sendTextMessage:vi.fn().mockResolvedValue(undefined)
}));
vi.mock('../local/outbox.js',()=>({listOutbox:vi.fn().mockResolvedValue([])}));
vi.mock('../realtime/socket.js',()=>({connectRealtime:()=>()=>{}}));
vi.mock('../local/keystore.js',()=>({unlockDeviceProfile:vi.fn()}));

(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;

beforeEach(()=>{
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
});
afterEach(()=>vi.clearAllMocks());

describe('reusable chat screen',()=>{
  it('uses the selected chat id and supplied direct-chat title/subtitle',async()=>{
    const container=document.createElement('div');
    document.body.appendChild(container);
    const root=createRoot(container);
    try{
      await act(async()=>{
        root.render(<FamilyChatScreen
          chatId="55555555-5555-4555-8555-555555555555"
          title="Мама"
          subtitle="Личный защищённый чат"
          senderLabel="Мама"
        />);
        await Promise.resolve();
      });
      expect(container.textContent).toContain('Мама');
      expect(container.textContent).toContain('Личный защищённый чат');
    }finally{
      await act(async()=>root.unmount());
      container.remove();
    }
  });
});
