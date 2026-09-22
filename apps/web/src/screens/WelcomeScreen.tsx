import {ThemeSwitcher} from '../components/ThemeSwitcher.js';
import {StandaloneInstallHint} from '../components/StandaloneInstallHint.js';

export function WelcomeScreen({onCreate,onRecover}:{onCreate:()=>void;onRecover:()=>void}){
  return <main className="welcome-screen">
    <StandaloneInstallHint/>
    <div className="welcome-top"><ThemeSwitcher compact/></div>
    <section className="welcome-card">
      <div className="brand-orb hero">F</div>
      <span className="eyebrow">Только для своих</span>
      <h1>Family Messenger</h1>
      <p className="welcome-lead">Спокойное семейное пространство для сообщений, фото и важных моментов — со сквозным шифрованием на ваших устройствах.</p>
      <div className="feature-chips"><span>Семейный чат</span><span>Личные сообщения</span><span>E2EE</span></div>
      <button className="primary welcome-cta" onClick={onRecover}>Восстановить существующую семью</button>
      <button className="secondary-button welcome-cta welcome-create-secondary" onClick={onCreate}>Создать новую семью</button>
      <p className="hint welcome-hint">Если вы уже пользовались Family Messenger на этом iPhone, сначала выбирайте восстановление. Новую семью создавайте только один раз.</p>
    </section>
  </main>;
}
