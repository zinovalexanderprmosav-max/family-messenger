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

  useEffect(()=>{setDevice(defaultDeviceName());},[]);

  async function submit(e:React.FormEvent){
    e.preventDefault();setBusy(true);setError('');
    try{
      await bootstrapFamily({familyDisplayName:family,memberDisplayName:name,deviceName:device,pin});
      onDone();
    }catch(err){
      setError(err instanceof Error?err.message:'Ошибка');
    }finally{setBusy(false);}
  }

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
      <button className="primary" disabled={busy}>{busy?'Создаём…':'Создать семейный чат'}</button>
    </form>
  </main>;
}
