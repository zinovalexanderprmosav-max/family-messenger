// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({ role: 'member' as 'admin' | 'member' }));

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
    members: [{ id: 'member-1', displayName: 'Alex', role: state.role, status: 'active' }]
  })
}));
vi.mock('../src/screens/WelcomeScreen.js', () => ({ WelcomeScreen: () => <div>WELCOME</div> }));
vi.mock('../src/screens/CreateFamilyScreen.js', () => ({ CreateFamilyScreen: () => <div>CREATE</div> }));
vi.mock('../src/screens/JoinFamilyScreen.js', () => ({ JoinFamilyScreen: () => <div>JOIN</div> }));
vi.mock('../src/screens/PendingApprovalScreen.js', () => ({ PendingApprovalScreen: () => <div>PENDING</div> }));
vi.mock('../src/screens/FamilyChatScreen.js', () => ({ FamilyChatScreen: () => <div>CHAT</div> }));
vi.mock('../src/screens/AdminScreen.js', () => ({ AdminScreen: () => <div>ADMIN_SCREEN</div> }));

import App from '../src/App.js';

describe('App role visibility', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    state.role = 'member';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function renderApp() {
    await act(async () => {
      root.render(<App />);
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }

  it('hides family administration from a regular member', async () => {
    state.role = 'member';
    await renderApp();
    expect(container.textContent).toContain('CHAT');
    expect(container.textContent).not.toContain('ADMIN_SCREEN');
  });

  it('shows family administration to an administrator', async () => {
    state.role = 'admin';
    await renderApp();
    expect(container.textContent).toContain('CHAT');
    expect(container.textContent).toContain('ADMIN_SCREEN');
  });
});
