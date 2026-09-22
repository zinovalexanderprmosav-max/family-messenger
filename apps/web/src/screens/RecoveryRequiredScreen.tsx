import type {SessionContext} from '../flows/session-recovery.js';
import {RecoveryCodeForm} from '../components/RecoveryCodeForm.js';

export function RecoveryRequiredScreen({
  context,
  onRetry
}:{
  context:SessionContext;
  onRetry:()=>void;
}){
  return <main className="welcome-screen recovery-screen">
    <section className="welcome-card recovery-card">
      <div className="brand-orb hero">F</div>
      <span className="eyebrow">Существующая семья найдена</span>
      <h1>Восстановить ключ устройства</h1>
      <p className="welcome-lead">
        Сервер узнал профиль <strong>{context.memberDisplayName}</strong> в семье
        {' '}«<strong>{context.familyDisplayName}</strong>», но локальный ключ сейчас недоступен.
      </p>
      <div className="recovery-facts">
        <div><span>Профиль</span><strong>{context.memberDisplayName}</strong></div>
        <div><span>Устройство</span><strong>{context.deviceName}</strong></div>
        <div><span>Семья</span><strong>{context.familyDisplayName}</strong></div>
      </div>
      <RecoveryCodeForm onDone={onRetry}/>
    </section>
  </main>;
}
