// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks=vi.hoisted(()=>({
  openDirectChat:vi.fn(async()=>({chatId:'direct-1',keyVersion:1})),
  readLocalVisibleMessages:vi.fn(async()=>[]),
  reconcileChat:vi.fn(async()=>[]),
  sendTextMessage:vi.fn(async()=>({messageId:'m1',text:'Привет',sentAt:new Date().toISOString(),senderDeviceId:'device-1',sequence:'1'})),
  connectRealtime:vi.fn(()=>()=>{})
}));

vi.mock('../src/local/session.js',()=>({
  getUnlockedPin:()=> '246824',
  setUnlockedPin:vi.fn(),
  loadProfile:async()=>({familyId:'family-1',memberId:'member-1',deviceId:'device-1',familyChatId:'family-chat',status:'active' as const,csrfToken:'csrf',memberDisplayName:'Alex',familyDisplayName:'Family'})
}));
vi.mock('../src/local/keystore.js',()=>({unlockDeviceProfile:vi.fn()}));
vi.mock('../src/flows/direct-chat.js',()=>({openDirectChat:mocks.openDirectChat}));
vi.mock('../src/flows/messages.js',()=>({
  readLocalVisibleMessages:mocks.readLocalVisibleMessages,
  reconcileChat:mocks.reconcileChat,
  sendTextMessage:mocks.sendTextMessage
}));
vi.mock('../src/realtime/socket.js',()=>({connectRealtime:mocks.connectRealtime}));

import { FamilyChatScreen } from '../src/screens/FamilyChatScreen.js';

describe('FamilyChatScreen direct mode',()=>{
  let container:HTMLDivElement;
  let root:Root;

  beforeEach(()=>{
    vi.clearAllMocks();
    container=document.createElement('div');
    document.body.appendChild(container);
    root=createRoot(container);
  });

  afterEach(async()=>{
    await act(async()=>root.unmount());
    container.remove();
  });

  it('opens the selected member direct chat and uses its chat id for realtime and sending',async()=>{
    await act(async()=>{
      root.render(<FamilyChatScreen selectedMember={{id:'member-2',displayName:'Мама'}}/>);
      await new Promise(resolve=>setTimeout(resolve,0));
      await new Promise(resolve=>setTimeout(resolve,0));
    });

    expect(mocks.openDirectChat).toHaveBeenCalledWith('member-2','246824');
    expect(mocks.readLocalVisibleMessages).toHaveBeenCalledWith('direct-1','246824');
    expect(mocks.connectRealtime).toHaveBeenCalledWith(expect.objectContaining({chatId:'direct-1'}));
    expect(container.textContent).toContain('Мама');

    const textarea=container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Сообщение"]');
    expect(textarea).not.toBeNull();
    await act(async()=>{
      const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value')?.set;
      setter?.call(textarea,'Привет');
      textarea!.dispatchEvent(new Event('input',{bubbles:true}));
    });
    await act(async()=>{
      textarea!.closest('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
      await new Promise(resolve=>setTimeout(resolve,0));
    });
    expect(mocks.sendTextMessage).toHaveBeenCalledWith('Привет','246824','direct-1');
  });
});
