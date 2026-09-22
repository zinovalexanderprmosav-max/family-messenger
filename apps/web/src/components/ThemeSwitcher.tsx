import {useEffect,useState} from 'react';

export type ThemeMode='system'|'light'|'dark';
const KEY='family-messenger-theme';

function savedTheme():ThemeMode{
  try{
    const value=localStorage.getItem(KEY);
    return value==='light'||value==='dark'||value==='system'?value:'system';
  }catch{return 'system';}
}

function prefersDark(){
  return typeof window!=='undefined'
    &&typeof window.matchMedia==='function'
    &&window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolved(mode:ThemeMode){
  if(mode!=='system')return mode;
  return prefersDark()?'dark':'light';
}

function apply(mode:ThemeMode){
  const value=resolved(mode);
  document.documentElement.dataset.theme=value;
  document.documentElement.dataset.themeMode=mode;
  document.documentElement.style.colorScheme=value;
}

export function initTheme(){
  const mode=savedTheme();apply(mode);return mode;
}

export function ThemeSwitcher({compact=false}:{compact?:boolean}){
  const [mode,setMode]=useState<ThemeMode>(()=>savedTheme());
  useEffect(()=>{
    apply(mode);
    try{localStorage.setItem(KEY,mode);}catch{}
    if(typeof window==='undefined'||typeof window.matchMedia!=='function')return;
    const media=window.matchMedia('(prefers-color-scheme: dark)');
    const onChange=()=>{if(mode==='system')apply('system');};
    media.addEventListener?.('change',onChange);
    return()=>media.removeEventListener?.('change',onChange);
  },[mode]);
  return <div className={compact?'theme-switcher compact':'theme-switcher'} aria-label="Тема оформления">
    {([
      ['system','Система','◐'],
      ['light','Светлая','☀'],
      ['dark','Тёмная','●']
    ] as const).map(([value,label,icon])=><button
      key={value}
      type="button"
      className={mode===value?'theme-option active':'theme-option'}
      aria-pressed={mode===value}
      title={label}
      onClick={()=>setMode(value)}
    ><span aria-hidden="true">{icon}</span>{!compact&&<span>{label}</span>}</button>)}
  </div>;
}
