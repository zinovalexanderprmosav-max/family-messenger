import { useEffect,useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../api/client.js';
import type { InvitationResponse,PendingDevice } from '../api/types.js';
import { approvePendingDevice,deviceFingerprint,listPendingDevices } from '../flows/approve-device.js';
import { createDeviceLink } from '../flows/device-link.js';
import { getUnlockedPin } from '../local/session.js';

export function AdminScreen(){
  const [qr,setQr]=useState('');
  const [qrUrl,setQrUrl]=useState('');
  const [qrLabel,setQrLabel]=useState('');
  const [pending,setPending]=useState<Array<PendingDevice&{fingerprint?:string}>>([]);
  const [message,setMessage]=useState('');

  async function refresh(){
    try{const items=await listPendingDevices();setPending(await Promise.all(items.map(async d=>({...d,fingerprint:await deviceFingerprint(d.encryptionPublicKey)}))));}
    catch{setPending([]);}
  }
  useEffect(()=>{void refresh();const id=setInterval(()=>void refresh(),4000);return()=>clearInterval(id);},[]);

  async function showQr(url:string,label:string,messageText:string){
    setQrUrl(url);
    setQrLabel(label);
    setQr(await QRCode.toDataURL(url,{margin:1,width:280}));
    setMessage(messageText);
  }

  async function createInvite(){
    try{
      const inv=await api<InvitationResponse>('/v1/invitations',{method:'POST',body:'{}'});
      const url=`${location.origin}/#/join?token=${encodeURIComponent(inv.joinToken)}`;
      await showQr(url,'QR приглашения нового члена семьи','QR действует 15 минут и используется один раз.');
    }catch(e){setMessage(e instanceof Error?e.message:'Ошибка');}
  }

  async function createOwnDeviceInvite(){
    try{
      const link=await createDeviceLink();
      const url=`${location.origin}/#/device-link?token=${encodeURIComponent(link.linkToken)}`;
      await showQr(url,'QR подключения моего устройства','QR для вашего дополнительного устройства действует 15 минут и используется один раз.');
    }catch(e){setMessage(e instanceof Error?e.message:'Ошибка');}
  }

  async function approve(d:PendingDevice){
    const pin=getUnlockedPin();
    if(!pin){setMessage('Сначала разблокируйте приложение PIN-кодом.');return;}
    try{await approvePendingDevice(d,pin);setMessage(`${d.memberDisplayName}: устройство подтверждено`);await refresh();}
    catch(e){setMessage(e instanceof Error?e.message:'Ошибка');}
  }

  return <section className="panel">
    <h2>Семейное управление</h2>
    <button className="primary" onClick={createInvite}>Пригласить нового члена семьи</button>
    <button onClick={createOwnDeviceInvite}>Подключить моё устройство</button>
    {qr&&<div className="qr-box"><img src={qr} alt={qrLabel}/><small>{qrUrl}</small></div>}
    {message&&<p className="hint">{message}</p>}
    <h3>Ожидают подтверждения</h3>
    {pending.length===0?<p className="hint">Новых устройств нет.</p>:pending.map(d=><div className="pending" key={d.deviceId}><div><strong>{d.memberDisplayName}</strong><br/><span>{d.deviceName}</span><br/><code>{d.fingerprint}</code></div><button onClick={()=>void approve(d)}>Подтвердить</button></div>)}
  </section>;
}
