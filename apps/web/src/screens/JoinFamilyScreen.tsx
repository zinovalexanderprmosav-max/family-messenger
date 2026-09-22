import { useEffect,useState } from 'react';
import { acceptInvitation, inspectJoinToken } from '../flows/join.js';
import { getNativeDeviceName,getUnlockedPin,isNativeAndroid } from '../local/session.js';

export function JoinFamilyScreen({token,onDone}:{token:string;onDone:()=>void}){
  const [family,setFamily]=useState('Семья');
  const [name,setName]=useState('');
  const [device,setDevice]=useState('Мой телефон');
  const [pin,setPin]=useState('');
  const [auto,setAuto]=useState(false);
  const [error,setError]=useState('');

  useEffect(()=>{
    let stopped=false;
    void inspectJoinToken(token).then(async info=>{
      if(stopped)return;
      setFamily(info.familyDisplayName);
      if(info.intendedMemberDisplayName)setName(info.intendedMemberDisplayName);
      if(isNativeAndroid()&&info.intendedMemberDisplayName){
        const nativePin=getUnlockedPin();
        if(!nativePin)throw new Error('native_secret_unavailable');
        setAuto(true);
        await acceptInvitation({
          joinToken:token,
          memberDisplayName:info.intendedMemberDisplayName,
          deviceName:getNativeDeviceName()??'Android телефон',
          pin:nativePin,
          familyDisplayName:info.familyDisplayName
        });
        if(!stopped)onDone();
      }
    }).catch(e=>{if(!stopped)setError(e instanceof Error?e.message:'Неверное приглашение');});
    return()=>{stopped=true;};
  },[token,onDone]);

  async function submit(e:React.FormEvent){
    e.preventDefault();setError('');
    try{
      await acceptInvitation({joinToken:token,memberDisplayName:name,deviceName:device,pin,familyDisplayName:family});
      onDone();
    }catch(e){setError(e instanceof Error?e.message:'Ошибка');}
  }

  if(auto)return <main className="center-card"><div className="spinner"/><h1>Подключаем к «{family}»</h1><p>Ничего вводить не нужно.</p>{error&&<p className="error">{error}</p>}</main>;

  return <main className="center-card">
    <h1>Вступить в «{family}»</h1>
    <form onSubmit={submit} className="form">
      <label>Ваше имя<input value={name} onChange={e=>setName(e.target.value)} required/></label>
      <label>Это устройство<input value={device} onChange={e=>setDevice(e.target.value)} required/></label>
      <label>Личный PIN<input inputMode="numeric" pattern="[0-9]{6,}" value={pin} onChange={e=>setPin(e.target.value)} required/></label>
      {error&&<p className="error">{error}</p>}
      <button className="primary">Присоединиться</button>
    </form>
  </main>;
}
