import {useEffect,useState} from 'react';
import {canRecoverExistingDevice,recoverExistingDeviceWithPin} from '../flows/device-key-recovery.js';
import {RecoveryCodeForm} from '../components/RecoveryCodeForm.js';

function messageFor(error:unknown){
  if(!(error instanceof Error))return 'Не удалось восстановить доступ.';
  if(error.message==='recovery_keystore_not_found')return 'Локальный ключ не найден. Используйте код восстановления ниже.';
  if(error.message==='device_not_found')return 'Сервер не нашёл это старое устройство или оно было отозвано.';
  if(error.message==='invalid_pin'||error.message==='keystore_decryption_failed'||error.message==='pin_invalid_or_keystore_corrupt')return 'PIN не подошёл. Проверьте PIN этого устройства.';
  return error.message;
}

export function RecoverExistingDeviceScreen({onDone,onBack}:{onDone:()=>void;onBack:()=>void}){
  const [pin,setPin]=useState('');
  const [available,setAvailable]=useState<boolean|undefined>(undefined);
  const [useBackup,setUseBackup]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  useEffect(()=>{void canRecoverExistingDevice().then(value=>{setAvailable(value);setUseBackup(!value);});},[]);

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
      <p className="welcome-lead">Новая семья не создаётся. Family Messenger возвращает тот же профиль, устройство, ключи и доступные чаты.</p>

      {available===false&&<div className="recovery-warning">
        <strong>Локальный ключ на этом устройстве не найден.</strong>
        <span>Используйте сохранённый код восстановления и ваш PIN.</span>
      </div>}

      {available&& !useBackup&&<form className="form" onSubmit={submit}>
        <label>PIN этого устройства
          <input inputMode="numeric" pattern="[0-9]{6,}" autoComplete="off" value={pin} onChange={e=>setPin(e.target.value)} required/>
        </label>
        <p className="hint">Сначала пробуем локальный зашифрованный ключ — это самый быстрый вариант.</p>
        {error&&<p className="error">{error}</p>}
        <button className="primary" disabled={busy}>{busy?'Восстанавливаем…':'Восстановить доступ'}</button>
        <button type="button" className="secondary-button" onClick={()=>setUseBackup(true)}>Восстановить по коду</button>
      </form>}

      {(available===false||useBackup)&&<RecoveryCodeForm onDone={onDone}/>}

      <button className="link" onClick={onBack}>Назад</button>
    </section>
  </main>;
}
