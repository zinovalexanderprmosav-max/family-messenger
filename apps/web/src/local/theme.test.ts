import { beforeEach,describe,expect,it,vi } from 'vitest';
import { applyTheme,loadThemePreference,saveThemePreference } from './theme.js';

beforeEach(()=>{
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.restoreAllMocks();
});

describe('theme preference',()=>{
  it('defaults to system',()=>{
    expect(loadThemePreference()).toBe('system');
  });

  it('persists dark preference',()=>{
    saveThemePreference('dark');
    expect(loadThemePreference()).toBe('dark');
  });

  it('resolves system theme and follows media query changes',()=>{
    let matches=true;
    let listener:((event:{matches:boolean})=>void)|undefined;
    const media={
      get matches(){return matches;},
      media:'(prefers-color-scheme: dark)',
      onchange:null,
      addEventListener:(_type:string,fn:(event:{matches:boolean})=>void)=>{listener=fn;},
      removeEventListener:()=>{},
      addListener:()=>{},removeListener:()=>{},dispatchEvent:()=>true
    };
    vi.stubGlobal('matchMedia',vi.fn(()=>media));
    window.matchMedia=matchMedia;

    const cleanup=applyTheme('system');
    expect(document.documentElement.dataset.theme).toBe('dark');
    matches=false;listener?.({matches:false});
    expect(document.documentElement.dataset.theme).toBe('light');
    cleanup();
  });

  it('applies an explicit dark theme without consulting system mode',()=>{
    const match=vi.fn();vi.stubGlobal('matchMedia',match);window.matchMedia=match;
    const cleanup=applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(match).not.toHaveBeenCalled();
    cleanup();
  });
});
