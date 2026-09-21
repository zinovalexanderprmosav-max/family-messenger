import {useEffect,useState} from 'react';
import {acceptOwnDeviceEnrollment,inspectOwnDeviceEnrollment} from '../flows/device-enrollment.js';

export function AddOwnDeviceScreen({token,onDone}:{token:string;onDone:()=>void}){
  const [family,setFamily]=useState('Семья');
  const [member,setMember]=useState('Пользователь');
  const [device,setDevice]=useState('Мой телефон');
  const [pin,setPin]=useState('');
  const [ready,setReady]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{void inspectOwnDeviceEnrollment(token).then(info=>{setFamily(info.familyDisplayName);setMember(info.memberDisplayName);setReady(true);}).catch(e=>setError(e instanceof Error?e.message:'QR-код недействителен'));},[token]);
  async function submit(e:React.FormEvent){
    e.preventDefault();setError('');
    try{
      await acceptOwnDeviceEnrollment({enrollmentToken:token,deviceName:device,pin,memberDisplayName:member,familyDisplayName:family});
      onDone();
    }catch(e){setError(e instanceof Error?e.message:'Ошибка подключения');}
  }
  return <main className="center-card">
    <div className="logo-mark">F</div>
    <h1>Добавить устройство</h1>
    <p>{ready?<>Профиль <strong>{member}</strong> · «{family}»</>:'Проверяем QR-код…'}</p>
    {ready&&<form onSubmit={submit} className="form">
      <label>Название этого устройства<input value={device} onChange={e=>setDevice(e.target.value)} required/></label>
      <label>Личный PIN на этом устройстве<input inputMode="numeric" pattern="[0-9]{6,}" value={pin} onChange={e=>setPin(e.target.value)} required/></label>
      <p className="hint">После подключения подтвердите новый телефон на одном из уже доверенных устройств.</p>
      {error&&<p className="error">{error}</p>}
      <button className="primary">Подключить это устройство</button>
    </form>}
    {!ready&&error&&<p className="error">{error}</p>}
  </main>;
}
