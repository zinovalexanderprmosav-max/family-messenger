export type ThemePreference='system'|'light'|'dark';
const STORAGE_KEY='family-messenger:theme';

function isThemePreference(value:string|null):value is ThemePreference{return value==='system'||value==='light'||value==='dark';}

export function loadThemePreference():ThemePreference{
  try{const value=localStorage.getItem(STORAGE_KEY);return isThemePreference(value)?value:'system';}
  catch{return 'system';}
}

export function saveThemePreference(value:ThemePreference){
  try{localStorage.setItem(STORAGE_KEY,value);}catch{}
}

export function applyTheme(value:ThemePreference){
  const root=document.documentElement;
  if(value==='light'||value==='dark'){
    root.dataset.theme=value;
    return()=>{};
  }
  const media=window.matchMedia('(prefers-color-scheme: dark)');
  const sync=()=>{root.dataset.theme=media.matches?'dark':'light';};
  sync();
  if(typeof media.addEventListener==='function')media.addEventListener('change',sync);
  else media.addListener(sync);
  return()=>{
    if(typeof media.removeEventListener==='function')media.removeEventListener('change',sync);
    else media.removeListener(sync);
  };
}
