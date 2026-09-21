import {useEffect,useState} from 'react';
import QRCode from 'qrcode';
import {createOwnDeviceEnrollment} from '../flows/device-enrollment.js';
import {approvePendingDevice,deviceFingerprint,listPendingDevices} from '../flows/approve-device.js';
import {listManagedDevices,renameManagedDevice,revokeManagedDevice} from '../flows/device-management.js';
import {getUnlockedPin,loadProfile} from '../local/session.js';
import type {ManagedDevice,PendingDevice} from '../api/types.js';

type PendingWithFingerprint=PendingDevice&{fingerprint?:string};

function statusLabel(status:ManagedDevice['status']){
  if(status==='active')return 'Активно';
  if(status==='pending_key')return 'Ожидает подтверждения';
  return 'Отозвано';
}

export function DeviceManagementScreen(){
  const [qr,setQr]=useState('');
  const [joinUrl,setJoinUrl]=useState('');
  const [ownPending,setOwnPending]=useState<PendingWithFingerprint[]>([]);
  const [devices,setDevices]=useState<ManagedDevice[]>([]);
  const [message,setMessage]=useState('');

  async function refresh(){
    try{
      const profile=await loadProfile();if(!profile)return;
      const [pending,managed]=await Promise.all([listPendingDevices(),listManagedDevices()]);
      const own=pending.filter(item=>item.memberId===profile.memberId);
      setOwnPending(await Promise.all(own.map(async item=>({...item,fingerprint:await deviceFingerprint(item.encryptionPublicKey)}))));
      setDevices(managed.filter(item=>item.memberId===profile.memberId));
    }catch{setOwnPending([]);setDevices([]);}
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

  async function rename(device:ManagedDevice){
    const next=window.prompt('Новое название устройства',device.deviceName)?.trim();
    if(!next||next===device.deviceName)return;
    try{await renameManagedDevice(device.deviceId,next);setMessage('Название устройства обновлено.');await refresh();}
    catch(e){setMessage(e instanceof Error?e.message:'Ошибка переименования');}
  }

  async function revoke(device:ManagedDevice){
    if(device.current||device.status==='revoked')return;
    if(!window.confirm(`Отозвать устройство «${device.deviceName}»? Оно потеряет доступ к новым сообщениям.`))return;
    try{await revokeManagedDevice(device.deviceId);setMessage(`${device.deviceName}: доступ отозван`);await refresh();}
    catch(e){setMessage(e instanceof Error?e.message:'Ошибка отзыва устройства');}
  }

  return <section className="panel">
    <h2>Мои устройства</h2>
    <p className="hint">Подключайте свои дополнительные телефоны без создания нового участника семьи.</p>
    <button className="primary" onClick={()=>void createQr()}>Добавить моё устройство</button>
    {qr&&<div className="qr-box"><img src={qr} alt="QR для моего нового устройства"/><small>{joinUrl}</small></div>}
    {message&&<p className="hint">{message}</p>}

    <h3>Подключённые устройства</h3>
    {devices.length===0?<p className="hint">Устройства не найдены.</p>:devices.map(device=><div className="device-row" key={device.deviceId}>
      <div className="device-copy">
        <strong>{device.deviceName}{device.current?' · это устройство':''}</strong>
        <span className={`status-chip status-${device.status}`}>{statusLabel(device.status)}</span>
      </div>
      <div className="member-actions">
        {device.status!=='revoked'&&<button className="secondary-button" onClick={()=>void rename(device)}>Переименовать</button>}
        {!device.current&&device.status!=='revoked'&&<button className="danger-button" onClick={()=>void revoke(device)}>Отозвать</button>}
      </div>
    </div>)}

    <h3>Ждут моего подтверждения</h3>
    {ownPending.length===0?<p className="hint">Новых устройств нет.</p>:ownPending.map(device=><div className="pending" key={device.deviceId}>
      <div><strong>{device.deviceName}</strong><br/><code>{device.fingerprint}</code></div>
      <button onClick={()=>void approve(device)}>Подтвердить</button>
    </div>)}
  </section>;
}
