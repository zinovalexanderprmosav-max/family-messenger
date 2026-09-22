import {useState} from 'react';
import {restoreFromRecoveryBackup} from '../flows/recovery-backup.js';

function messageFor(error:unknown){
  if(!(error instanceof Error))return 'Не удалось восстановить доступ.';
  if(error.message==='recovery_backup_not_found')return 'Код восстановления не найден. Проверьте код.';
  if(error.message==='recovery_code_invalid')return 'Код восстановления введён неверно.';
  if(error.message==='pin_invalid_or_keystore_corrupt')return 'PIN не подошёл к резервной копии.';
  if(error.message==='device_not_found')return 'Старое устройство было отозвано или больше недоступно.';
  return error.message;
}

export function RecoveryCodeForm({onDone}:{onDone:()=>void}){
  const [code,setCode]=useState('');
  const [pin,setPin]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  async function submit(event:React.FormEvent){
    event.preventDefault();
    setBusy(true);setError('');
    try{
      await restoreFromRecoveryBackup(code,pin);
      onDone();
    }catch(e){setError(messageFor(e));}
    finally{setBusy(false);}
  }

  return <form className="form recovery-code-form" onSubmit={submit}>
    <label>Код восстановления
      <input
        value={code}
        onChange={e=>setCode(e.target.value.toUpperCase())}
        autoCapitalize="characters"
        autoCorrect="off"
        placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
        required
      />
    </label>
    <label>Ваш PIN
      <input inputMode="numeric" pattern="[0-9]{6,}" autoComplete="off" value={pin} onChange={e=>setPin(e.target.value)} required/>
    </label>
    <p className="hint">Резервная копия хранится на сервере только в зашифрованном PIN-кодом виде. Без PIN сервер её расшифровать не может.</p>
    {error&&<p className="error">{error}</p>}
    <button className="primary" disabled={busy}>{busy?'Восстанавливаем…':'Восстановить по коду'}</button>
  </form>;
}
