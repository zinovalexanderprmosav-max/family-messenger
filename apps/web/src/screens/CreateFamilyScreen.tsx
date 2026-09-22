import { useEffect,useState } from 'react';
import { bootstrapFamily } from '../flows/bootstrap.js';

function defaultDeviceName(){
  const ua=navigator.userAgent;
  if(/iPhone/i.test(ua))return 'Мой iPhone';
  if(/iPad/i.test(ua))return 'Мой iPad';
  if(/Android/i.test(ua))return 'Мой Android';
  return 'Моё устройство';
}

export function CreateFamilyScreen({onDone,onBack}:{onDone:()=>void;onBack:()=>void}){
  const [family,setFamily]=useState('Наша семья');
  const [name,setName]=useState('');
  const [device,setDevice]=useState('Моё устройство');
  const [pin,setPin]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [recoveryCode,setRecoveryCode]=useState('');

  useEffect(()=>{setDevice(defaultDeviceName());},[]);

  async function submit(e:React.FormEvent){
    e.preventDefault();setBusy(true);setError('');
    try{
      const result=await bootstrapFamily({familyDisplayName:family,memberDisplayName:name,deviceName:device,pin});
      setRecoveryCode(result.recoveryCode);
    }catch(err){
      setError(err instanceof Error?err.message:'Ошибка');
    }finally{setBusy(false);}
  }

  async function copyCode(){
    try{await navigator.clipboard.writeText(recoveryCode);}
    catch{}
  }

  if(recoveryCode)return <main className="center-card recovery-code-card">
    <span className="eyebrow">Готово</span>
    <h1>Сохраните код восстановления</h1>
    <p className="hint">Он нужен только если iPhone, Safari или приложение потеряют локальные данные. Код не заменяет PIN — для восстановления нужны оба.</p>
    <div className="recovery-code" aria-label="Код восстановления">{recoveryCode}</div>
    <div className="recovery-code-actions">
      <button className="secondary-button" onClick={()=>void copyCode()}>Скопировать код</button>
      <button className="primary" onClick={onDone}>Я сохранил код</button>
    </div>
    <p className="recovery-note">Сделайте скриншот или сохраните код в защищённой заметке. Family Messenger не показывает открытые ключи и не знает ваш PIN.</p>
  </main>;

  return <main className="center-card">
    <button className="link" onClick={onBack}>← Назад</button>
    <h1>Создать семью</h1>
    <p className="hint">Это устройство станет вашим первым доверенным устройством и основным администраторским входом.</p>
    <form onSubmit={submit} className="form">
      <label>Название семьи<input value={family} onChange={e=>setFamily(e.target.value)} required/></label>
      <label>Ваше имя<input value={name} onChange={e=>setName(e.target.value)} required/></label>
      <label>Это устройство<input value={device} onChange={e=>setDevice(e.target.value)} required/></label>
      <label>Личный PIN<input inputMode="numeric" pattern="[0-9]{6,}" value={pin} onChange={e=>setPin(e.target.value)} required/></label>
      <p className="hint">PIN нужен только для защиты переписки на этом устройстве. Запомните его.</p>
      {error&&<p className="error">{error}</p>}
      <button className="primary" disabled={busy}>{busy?'Создаём и сохраняем резерв…':'Создать семейный чат'}</button>
    </form>
  </main>;
}
