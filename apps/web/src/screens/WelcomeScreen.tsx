import {ThemeSwitcher} from '../components/ThemeSwitcher.js';
import {StandaloneInstallHint} from '../components/StandaloneInstallHint.js';

export function WelcomeScreen({onCreate}:{onCreate:()=>void}){
  return <main className="welcome-screen">
    <StandaloneInstallHint/>
    <div className="welcome-top"><ThemeSwitcher compact/></div>
    <section className="welcome-card">
      <div className="brand-orb hero">F</div>
      <span className="eyebrow">Только для своих</span>
      <h1>Family Messenger</h1>
      <p className="welcome-lead">Спокойное семейное пространство для сообщений, фото и важных моментов — со сквозным шифрованием на ваших устройствах.</p>
      <div className="feature-chips"><span>Семейный чат</span><span>Личные сообщения</span><span>E2EE</span></div>
      <button className="primary welcome-cta" onClick={onCreate}>Создать нашу семью</button>
      <p className="hint welcome-hint">Если вас пригласили, просто откройте или отсканируйте семейный QR-код.</p>
    </section>
  </main>;
}
