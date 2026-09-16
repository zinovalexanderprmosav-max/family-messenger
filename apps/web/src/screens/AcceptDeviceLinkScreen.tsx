import { useEffect,useState,type FormEvent } from 'react';
import { inspectDeviceLinkToken,type DeviceLinkInspection } from '../flows/device-link.js';

export function AcceptDeviceLinkForm(props:{
  inspection:DeviceLinkInspection;
  busy:boolean;
  error:string;
  onSubmit:(deviceName:string,pin:string)=>void;
}){
  const [deviceName,setDeviceName]=useState('');
  const [pin,setPin]=useState('');
  function submit(event:FormEvent){event.preventDefault();if(props.busy)return;props.onSubmit(deviceName.trim(),pin);}
  return <section className="panel">
    <h2>Подключение устройства</h2>
    <p className="hint">Вы подключаете новое устройство к существующему профилю.</p>
    <div className="pending"><div><strong>{props.inspection.memberDisplayName}</strong><br/><span>{props.inspection.familyDisplayName}</span></div></div>
    <form onSubmit={submit}>
      <label>Название устройства<input value={deviceName} onChange={e=>setDeviceName(e.target.value)} required maxLength={100} placeholder="Например, Рабочий ПК"/></label>
      <label>Личный PIN<input type="password" value={pin} onChange={e=>setPin(e.target.value)} required minLength={6} autoComplete="new-password" inputMode="numeric"/></label>
      {props.error&&<p className="error">{props.error}</p>}
      <button className="primary" type="submit" disabled={props.busy}>{props.busy?'Подключаем…':'Подключить устройство'}</button>
    </form>
  </section>;
}

export function AcceptDeviceLinkScreen(props:{token:string;onDone:()=>void}){
  const [inspection,setInspection]=useState<DeviceLinkInspection|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    let current=true;
    void inspectDeviceLinkToken(props.token).then(value=>{if(current)setInspection(value);}).catch(reason=>{if(current)setError(reason instanceof Error?reason.message:'Ссылка недействительна');});
    return()=>{current=false;};
  },[props.token]);
  if(error)return <main className="center-card"><section className="panel"><h2>Не удалось проверить ссылку</h2><p className="error">{error}</p></section></main>;
  if(!inspection)return <main className="center-card">Проверяем ссылку…</main>;
  return <main className="center-card"><AcceptDeviceLinkForm inspection={inspection} busy={false} error="" onSubmit={()=>{}}/></main>;
}
