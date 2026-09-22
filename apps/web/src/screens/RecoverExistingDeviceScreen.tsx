import {useEffect,useState} from 'react';
import {canRecoverExistingDevice,recoverExistingDeviceWithPin} from '../flows/device-key-recovery.js';

function messageFor(error:unknown){
  if(!(error instanceof Error))return 'Не удалось восстановить доступ.';
  if(error.message==='recovery_keystore_not_found')return 'На этом устройстве не найден старый зашифрованный ключ. Не создавайте новую семью — потребуется переподключение из доверенного устройства.';
  if(error.message==='device_not_found')return 'Сервер не нашёл это старое устройство или оно было отозвано.';
  if(error.message==='invalid_pin'||error.message==='keystore_decryption_failed')return 'PIN не подошёл. Проверьте PIN, который использовался на этом iPhone.';
  return error.message;
}

export function RecoverExistingDeviceScreen({onDone,onBack}:{onDone:()=>void;onBack:()=>void}){
  const [pin,setPin]=useState('');
  const [available,setAvailable]=useState<boolean|undefined>(undefined);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  useEffect(()=>{void canRecoverExistingDevice().then(setAvailable);},[]);

  async function submit(event:React.FormEvent){
    event.preventDefault();
    setBusy(true);setError('');
    try{
      await recoverExistingDeviceWithPin(pin);
      onDone();
    }catch(e){setError(messageFor(e));}
    finally{setBusy(false);}
  }

  return <main className="welcome-screen recovery-screen">
    <section className="welcome-card recovery-card">
      <div className="brand-orb hero">F</div>
      <span className="eyebrow">Восстановление</span>
      <h1>Вернуть существующую семью</h1>
      <p className="welcome-lead">Новая семья не создаётся. Мы проверим старый ключ этого iPhone и вернём тот же профиль и чаты.</p>

      {available===false&&<div className="recovery-warning">
        <strong>Старый ключ на этом iPhone не найден.</strong>
        <span>Не нажимайте «Создать семью». Этот iPhone нужно будет переподключить из другого доверенного устройства.</span>
      </div>}

      {available!==false&&<form className="form" onSubmit={submit}>
        <label>PIN этого iPhone
          <input inputMode="numeric" pattern="[0-9]{6,}" autoComplete="off" value={pin} onChange={e=>setPin(e.target.value)} required/>
        </label>
        <p className="hint">PIN используется только локально для расшифровки старого ключа устройства.</p>
        {error&&<p className="error">{error}</p>}
        <button className="primary" disabled={busy}>{busy?'Восстанавливаем…':'Восстановить доступ'}</button>
      </form>}

      <button className="link" onClick={onBack}>Назад</button>
    </section>
  </main>;
}
