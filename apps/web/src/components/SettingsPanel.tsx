import {ThemeSwitcher} from './ThemeSwitcher.js';
import {BuildInfo} from './BuildInfo.js';
import {RecoverySettings} from './RecoverySettings.js';

export function SettingsPanel(){
  return <section className="panel settings-panel">
    <div className="section-heading">
      <div><span className="eyebrow">Настройки</span><h2>Оформление</h2></div>
    </div>
    <p className="hint">Тема сохраняется на этом устройстве. «Система» повторяет светлую или тёмную тему iPhone, Android или компьютера.</p>
    <ThemeSwitcher/>
    <div className="settings-divider"/>
    <RecoverySettings/>
    <div className="settings-divider"/>
    <BuildInfo/>
  </section>;
}
