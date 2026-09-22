import {useEffect,useState} from 'react';
import {ensureRecoveryBackup,getSavedRecoveryCode} from '../flows/recovery-backup.js';

export function RecoverySettings(){
  const [code,setCode]=useState<string|null>(null);
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);

  useEffect(()=>{setCode(getSavedRecoveryCode());},[]);

  async function ensure(){
    setBusy(true);setMessage('');
    try{
      const value=await ensureRecoveryBackup();
      setCode(value);
      setMessage('Зашифрованная резервная копия обновлена.');
    }catch(e){setMessage(e instanceof Error?e.message:'Не удалось обновить резервную копию.');}
    finally{setBusy(false);}
  }

  async function copy(){
    if(!code)return;
    try{await navigator.clipboard.writeText(code);setMessage('Код скопирован.');}
    catch{setMessage('Не удалось скопировать автоматически. Сохраните код вручную.');}
  }

  return <div className="recovery-settings">
    <div className="section-heading">
      <div><span className="eyebrow">Безопасность</span><h2>Восстановление</h2></div>
    </div>
    <p className="hint">Если Safari, PWA или приложение потеряют локальные данные, доступ можно вернуть по коду восстановления + вашему PIN.</p>
    {code?<>
      <div className="recovery-code compact">{code}</div>
      <div className="recovery-code-actions">
        <button className="secondary-button" onClick={()=>void copy()}>Скопировать код</button>
        <button className="secondary-button" disabled={busy} onClick={()=>void ensure()}>{busy?'Обновляем…':'Обновить резерв'}</button>
      </div>
    </>:<button className="primary" disabled={busy} onClick={()=>void ensure()}>{busy?'Настраиваем…':'Настроить восстановление'}</button>}
    {message&&<p className="hint recovery-message">{message}</p>}
    <p className="recovery-note">Храните код отдельно от устройства. Сервер получает только зашифрованный контейнер ключей и не знает ваш PIN.</p>
  </div>;
}
