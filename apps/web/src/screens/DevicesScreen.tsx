import { useEffect,useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../api/client.js';
import { createDeviceLink } from '../flows/device-link.js';

export type DeviceItem={
  deviceId:string;
  memberId:string;
  memberDisplayName:string;
  memberRole:'owner'|'admin'|'member';
  deviceName:string;
  status:'pending_key'|'active'|'revoked';
  createdAt:string;
  lastSeenAt:string|null;
  encryptionPublicKey:string;
  canManage:boolean;
};

const statusLabel=(status:DeviceItem['status'])=>status==='active'?'Активно':status==='pending_key'?'Ожидает подтверждения':'Отключено';

export function DevicesScreen(){
  const [items,setItems]=useState<DeviceItem[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [qr,setQr]=useState('');
  const [qrUrl,setQrUrl]=useState('');

  async function refresh(){
    try{const response=await api<{items:DeviceItem[]}>('/v1/devices');setItems(response.items);setError('');}
    catch(reason){setError(reason instanceof Error?reason.message:'Не удалось загрузить устройства');}
    finally{setLoading(false);}
  }
  useEffect(()=>{void refresh();},[]);

  async function connectMine(){
    setMessage('');setError('');
    try{
      const link=await createDeviceLink();
      const url=`${location.origin}/#/device-link?token=${encodeURIComponent(link.linkToken)}`;
      setQrUrl(url);
      setQr(await QRCode.toDataURL(url,{margin:1,width:280}));
      setMessage('QR действует 15 минут и используется один раз. На новом устройстве будет создан новый ключ, но профиль останется тем же.');
    }catch(reason){setError(reason instanceof Error?reason.message:'Не удалось создать QR');}
  }

  return <section className="panel section-screen devices-screen">
    <div className="section-heading"><div><h2>Устройства</h2><p className="hint">До трёх устройств на одного участника.</p></div><button className="primary" type="button" onClick={()=>void connectMine()}>Подключить моё устройство</button></div>
    {qr&&<div className="qr-box"><img src={qr} alt="QR подключения моего устройства"/><small>{qrUrl}</small></div>}
    {message&&<p className="hint" role="status">{message}</p>}
    {error&&<p className="error" role="alert">{error}</p>}
    {loading&&<p className="hint">Загрузка устройств…</p>}
    {!loading&&items.length===0&&!error&&<p className="hint">Устройства не найдены.</p>}
    <div className="device-list">{items.map(device=><article className="device-row" key={device.deviceId}>
      <div className="device-icon" aria-hidden="true">▣</div>
      <div className="device-main"><strong>{device.deviceName}</strong><small>{device.memberDisplayName} · {statusLabel(device.status)}</small>{device.lastSeenAt&&<small>Последняя активность: {new Date(device.lastSeenAt).toLocaleString()}</small>}</div>
      {device.canManage&&<span className="device-manageable">Можно редактировать</span>}
    </article>)}</div>
  </section>;
}
