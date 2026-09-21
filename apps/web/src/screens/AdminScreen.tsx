import { useEffect,useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../api/client.js';
import type { InvitationResponse,ManagedDevice,PendingDevice } from '../api/types.js';
import { approvePendingDevice,deviceFingerprint,listPendingDevices } from '../flows/approve-device.js';
import { listManagedDevices,revokeManagedDevice } from '../flows/device-management.js';
import { demoteFamilyAdministrator,promoteFamilyAdministrator,removeFamilyMember } from '../flows/family-management.js';
import { getUnlockedPin,loadProfile } from '../local/session.js';
import type { FamilyContact } from '../components/FamilyContacts.js';

type FamilySummary={primaryAdminMemberId:string|null;members:FamilyContact[]};

export function AdminScreen({family,currentMemberId,onChanged}:{family:FamilySummary;currentMemberId:string;onChanged:()=>void}){
  const [qr,setQr]=useState('');
  const [joinUrl,setJoinUrl]=useState('');
  const [pending,setPending]=useState<Array<PendingDevice&{fingerprint?:string}>>([]);
  const [devices,setDevices]=useState<ManagedDevice[]>([]);
  const [message,setMessage]=useState('');
  const isPrimary=family.primaryAdminMemberId===currentMemberId;
  const activeAdminCount=family.members.filter(member=>member.status==='active'&&member.role==='admin').length;

  async function refresh(){
    try{
      const profile=await loadProfile();
      const [pendingItems,managed]=await Promise.all([listPendingDevices(),listManagedDevices()]);
      setPending(await Promise.all(pendingItems.filter(d=>!profile||d.memberId!==profile.memberId).map(async d=>({...d,fingerprint:await deviceFingerprint(d.encryptionPublicKey)}))));
      setDevices(managed.filter(d=>!profile||d.memberId!==profile.memberId));
    }catch{setPending([]);setDevices([]);}
  }
  useEffect(()=>{void refresh();const id=setInterval(()=>void refresh(),4000);return()=>clearInterval(id);},[]);

  async function createInvite(){
    try{
      const inv=await api<InvitationResponse>('/v1/invitations',{method:'POST',body:'{}'});
      const url=`${location.origin}/#/join?token=${encodeURIComponent(inv.joinToken)}`;
      setJoinUrl(url);setQr(await QRCode.toDataURL(url,{margin:1,width:280}));
      setMessage('QR действует 15 минут и создаёт нового участника семьи.');
    }catch(e){setMessage(e instanceof Error?e.message:'Ошибка');}
  }

  async function approve(d:PendingDevice){
    const pin=getUnlockedPin();if(!pin){setMessage('Сначала разблокируйте приложение PIN-кодом.');return;}
    try{await approvePendingDevice(d,pin);setMessage(`${d.memberDisplayName}: устройство подтверждено`);await refresh();}
    catch(e){setMessage(e instanceof Error?e.message:'Ошибка');}
  }

  async function revoke(device:ManagedDevice){
    if(device.status==='revoked')return;
    if(!window.confirm(`Отозвать «${device.deviceName}» у ${device.memberDisplayName}?`))return;
    try{await revokeManagedDevice(device.deviceId);setMessage('Доступ устройства отозван.');await refresh();}
    catch(e){setMessage(e instanceof Error?e.message:'Ошибка отзыва устройства');}
  }

  async function remove(member:FamilyContact){
    if(!window.confirm(`Удалить ${member.displayName} из семьи? История сохранится, доступ будет закрыт.`))return;
    try{await removeFamilyMember(member.id);setMessage(`${member.displayName}: доступ закрыт`);onChanged();await refresh();}
    catch(e){setMessage(e instanceof Error?e.message:'Ошибка удаления участника');}
  }

  async function promote(member:FamilyContact){
    try{await promoteFamilyAdministrator(member.id);setMessage(`${member.displayName}: назначен вторым администратором`);onChanged();}
    catch(e){setMessage(e instanceof Error?e.message:'Ошибка назначения администратора');}
  }

  async function demote(member:FamilyContact){
    try{await demoteFamilyAdministrator(member.id);setMessage(`${member.displayName}: права администратора сняты`);onChanged();}
    catch(e){setMessage(e instanceof Error?e.message:'Ошибка изменения роли');}
  }

  const activeMembers=family.members.filter(member=>member.status==='active'&&member.id!==currentMemberId);

  return <section className="panel">
    <h2>Семейное управление</h2>
    <p className="hint">Этот QR нужен именно для добавления нового человека в семью.</p>
    <button className="primary" onClick={()=>void createInvite()}>Пригласить нового участника</button>
    {qr&&<div className="qr-box"><img src={qr} alt="QR приглашения нового участника"/><small>{joinUrl}</small></div>}
    {message&&<p className="hint">{message}</p>}

    <h3>Участники</h3>
    {activeMembers.map(member=>{
      const canRemove=member.id!==family.primaryAdminMemberId&&(isPrimary||member.role==='member');
      const canPromote=isPrimary&&activeAdminCount<2&&member.role==='member';
      const canDemote=isPrimary&&member.role==='admin'&&member.id!==family.primaryAdminMemberId;
      const memberDevices=devices.filter(device=>device.memberId===member.id);
      const canRevokeTarget=member.id!==family.primaryAdminMemberId&&(isPrimary||member.role==='member');
      return <div className="member-card" key={member.id}>
        <strong>{member.displayName}</strong>
        <div className="hint">{member.role==='admin'?'Администратор':'Член семьи'}</div>
        <div className="member-actions">
          {canPromote&&<button className="secondary-button" onClick={()=>void promote(member)}>Сделать администратором</button>}
          {canDemote&&<button className="secondary-button" onClick={()=>void demote(member)}>Снять права администратора</button>}
          {canRemove&&<button className="danger-button" onClick={()=>void remove(member)}>Удалить из семьи</button>}
        </div>
        {memberDevices.map(device=><div className="device-row" key={device.deviceId}>
          <div className="device-copy"><span>{device.deviceName}</span><span className={`status-chip status-${device.status}`}>{device.status==='active'?'Активно':device.status==='pending_key'?'Ожидает подтверждения':'Отозвано'}</span></div>
          {canRevokeTarget&&device.status!=='revoked'&&<button className="danger-button" onClick={()=>void revoke(device)}>Отозвать</button>}
        </div>)}
      </div>;
    })}

    <h3>Ожидают подтверждения</h3>
    {pending.length===0?<p className="hint">Новых устройств нет.</p>:pending.map(d=><div className="pending" key={d.deviceId}><div><strong>{d.memberDisplayName}</strong><br/><span>{d.deviceName}</span><br/><code>{d.fingerprint}</code></div><button onClick={()=>void approve(d)}>Подтвердить</button></div>)}
  </section>;
}
