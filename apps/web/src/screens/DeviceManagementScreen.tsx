import {useEffect,useState} from 'react';
import QRCode from 'qrcode';
import {createOwnDeviceEnrollment} from '../flows/device-enrollment.js';
import {approvePendingDevice,deviceFingerprint,listPendingDevices} from '../flows/approve-device.js';
import {getUnlockedPin,loadProfile} from '../local/session.js';
import type {PendingDevice} from '../api/types.js';

type PendingWithFingerprint=PendingDevice&{fingerprint?:string};

export function DeviceManagementScreen(){
  const [qr,setQr]=useState('');
  const [joinUrl,setJoinUrl]=useState('');
  const [ownPending,setOwnPending]=useState<PendingWithFingerprint[]>([]);
  const [message,setMessage]=useState('');

  async function refresh(){
    try{
      const profile=await loadProfile();if(!profile)return;
      const items=(await listPendingDevices()).filter(item=>item.memberId===profile.memberId);
      setOwnPending(await Promise.all(items.map(async item=>({...item,fingerprint:await deviceFingerprint(item.encryptionPublicKey)}))));
    }catch{setOwnPending([]);}
  }
  useEffect(()=>{void refresh();const id=setInterval(()=>void refresh(),4000);return()=>clearInterval(id);},[]);

  async function createQr(){
    try{
      const enrollment=await createOwnDeviceEnrollment();
      const url=`${location.origin}/#/device?token=${encodeURIComponent(enrollment.enrollmentToken)}`;
      setJoinUrl(url);setQr(await QRCode.toDataURL(url,{margin:1,width:280}));
      setMessage('QR действует 10 минут. Откройте его только на вашем новом устройстве.');
    }catch(e){setMessage(e instanceof Error?e.message:'Ошибка создания QR');}
  }

  async function approve(device:PendingDevice){
    const pin=getUnlockedPin();
    if(!pin){setMessage('Сначала разблокируйте приложение PIN-кодом.');return;}
    try{await approvePendingDevice(device,pin);setMessage(`${device.deviceName}: устройство подтверждено`);await refresh();}
    catch(e){setMessage(e instanceof Error?e.message:'Ошибка подтверждения');}
  }

  return <section className="panel">
    <h2>Мои устройства</h2>
    <p className="hint">Подключайте свои дополнительные телефоны без создания нового участника семьи.</p>
    <button className="primary" onClick={()=>void createQr()}>Добавить моё устройство</button>
    {qr&&<div className="qr-box"><img src={qr} alt="QR для моего нового устройства"/><small>{joinUrl}</small></div>}
    {message&&<p className="hint">{message}</p>}
    <h3>Ждут моего подтверждения</h3>
    {ownPending.length===0?<p className="hint">Новых устройств нет.</p>:ownPending.map(device=><div className="pending" key={device.deviceId}>
      <div><strong>{device.deviceName}</strong><br/><code>{device.fingerprint}</code></div>
      <button onClick={()=>void approve(device)}>Подтвердить</button>
    </div>)}
  </section>;
}
