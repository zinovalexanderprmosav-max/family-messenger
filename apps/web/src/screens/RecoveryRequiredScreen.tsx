import type {SessionContext} from '../flows/session-recovery.js';

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
      <h1>Не создавайте новую семью</h1>
      <p className="welcome-lead">
        Сервер узнал это устройство как <strong>{context.memberDisplayName}</strong> в семье
        {' '}«<strong>{context.familyDisplayName}</strong>», но локальный ключ шифрования сейчас недоступен.
      </p>
      <div className="recovery-facts">
        <div><span>Профиль</span><strong>{context.memberDisplayName}</strong></div>
        <div><span>Устройство</span><strong>{context.deviceName}</strong></div>
        <div><span>Семья</span><strong>{context.familyDisplayName}</strong></div>
      </div>
      <p className="hint">
        Если ключ восстановится из локальной резервной копии, приложение вернёт доступ автоматически.
        В противном случае это устройство нужно безопасно переподключить из другого доверенного устройства.
      </p>
      <button className="primary welcome-cta" onClick={onRetry}>Проверить восстановление ещё раз</button>
    </section>
  </main>;
}
