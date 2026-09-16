import { useEffect,useState } from 'react';
import { applyTheme,loadThemePreference,saveThemePreference,type ThemePreference } from '../local/theme.js';

export function ThemeControl(){
  const [theme,setTheme]=useState<ThemePreference>(()=>loadThemePreference());
  useEffect(()=>applyTheme(theme),[theme]);
  function change(next:ThemePreference){saveThemePreference(next);setTheme(next);}
  return <label className="theme-control" title="Тема оформления">
    <span aria-hidden="true">◐</span>
    <select aria-label="Тема оформления" value={theme} onChange={event=>change(event.target.value as ThemePreference)}>
      <option value="system">Системная</option>
      <option value="light">Светлая</option>
      <option value="dark">Тёмная</option>
    </select>
  </label>;
}
