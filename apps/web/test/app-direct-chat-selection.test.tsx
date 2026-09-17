// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../src/local/session.js', () => ({
  loadProfile: async () => ({
    familyId: 'family-1',
    memberId: 'member-1',
    deviceId: 'device-1',
    familyChatId: 'chat-1',
    status: 'active' as const,
    csrfToken: 'csrf',
    memberDisplayName: 'Alex',
    familyDisplayName: 'Family'
  })
}));
vi.mock('../src/flows/join.js', () => ({ consumeJoinTokenFromHash: () => null }));
vi.mock('../src/api/client.js', () => ({
  api: async () => ({
    id: 'family-1',
    displayName: 'Family',
    familyChatId: 'chat-1',
    members: [
      { id: 'member-1', displayName: 'Alex', role: 'admin', status: 'active' },
      { id: 'member-2', displayName: 'Мама', role: 'member', status: 'active' }
    ]
  })
}));
vi.mock('../src/screens/WelcomeScreen.js', () => ({ WelcomeScreen: () => <div>WELCOME</div> }));
vi.mock('../src/screens/CreateFamilyScreen.js', () => ({ CreateFamilyScreen: () => <div>CREATE</div> }));
vi.mock('../src/screens/JoinFamilyScreen.js', () => ({ JoinFamilyScreen: () => <div>JOIN</div> }));
vi.mock('../src/screens/PendingApprovalScreen.js', () => ({ PendingApprovalScreen: () => <div>PENDING</div> }));
vi.mock('../src/screens/AdminScreen.js', () => ({ AdminScreen: () => <div>ADMIN</div> }));
vi.mock('../src/screens/FamilyChatScreen.js', () => ({
  FamilyChatScreen: ({selectedMember}:{selectedMember?:{id:string;displayName:string}|null}) =>
    <div>CHAT:{selectedMember?.id ?? 'family'}</div>
}));

import App from '../src/App.js';

describe('direct chat selection', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('selects another family member from contacts and can return to the family chat', async () => {
    await act(async () => {
      root.render(<App />);
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain('CHAT:family');

    const contact = container.querySelector<HTMLButtonElement>('button[data-member-id="member-2"]');
    expect(contact).not.toBeNull();
    await act(async () => contact!.click());
    expect(container.textContent).toContain('CHAT:member-2');

    const family = container.querySelector<HTMLButtonElement>('button[data-chat="family"]');
    expect(family).not.toBeNull();
    await act(async () => family!.click());
    expect(container.textContent).toContain('CHAT:family');
  });
});
