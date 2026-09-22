// @vitest-environment jsdom
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {initTheme} from '../src/components/ThemeSwitcher.js';

describe('appearance theme',()=>{
  beforeEach(()=>{
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    vi.stubGlobal('matchMedia',vi.fn(()=>({
      matches:false,media:'(prefers-color-scheme: dark)',onchange:null,
      addListener:vi.fn(),removeListener:vi.fn(),addEventListener:vi.fn(),removeEventListener:vi.fn(),dispatchEvent:vi.fn()
    })));
  });

  it('restores a saved dark theme',()=>{
    localStorage.setItem('family-messenger-theme','dark');
    expect(initTheme()).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.themeMode).toBe('dark');
  });

  it('uses the system preference when no explicit theme is saved',()=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({
      matches:true,media:'(prefers-color-scheme: dark)',onchange:null,
      addListener:vi.fn(),removeListener:vi.fn(),addEventListener:vi.fn(),removeEventListener:vi.fn(),dispatchEvent:vi.fn()
    })));
    expect(initTheme()).toBe('system');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
