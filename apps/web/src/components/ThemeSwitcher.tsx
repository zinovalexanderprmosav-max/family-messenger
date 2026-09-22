import {useEffect,useState} from 'react';

export type ThemeMode='system'|'light'|'dark';
const KEY='family-messenger-theme';

function savedTheme():ThemeMode{
  const value=localStorage.getItem(KEY);
  return value==='light'||value==='dark'||value==='system'?value:'system';
}

function resolved(mode:ThemeMode){
  if(mode!=='system')return mode;
  return matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
}

function apply(mode:ThemeMode){
  document.documentElement.dataset.theme=resolved(mode);
  document.documentElement.dataset.themeMode=mode;
  document.documentElement.style.colorScheme=resolved(mode);
}

export function initTheme(){
  const mode=savedTheme();apply(mode);return mode;
}

export function ThemeSwitcher({compact=false}:{compact?:boolean}){
  const [mode,setMode]=useState<ThemeMode>(()=>savedTheme());
  useEffect(()=>{
    apply(mode);localStorage.setItem(KEY,mode);
    const media=matchMedia('(prefers-color-scheme: dark)');
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
