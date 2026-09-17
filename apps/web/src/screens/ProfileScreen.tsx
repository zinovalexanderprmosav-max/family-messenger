import { useEffect,useState } from 'react';
import { api } from '../api/client.js';
import { ThemeControl } from '../components/ThemeControl.js';

export type FamilyRole='owner'|'admin'|'member';
type FamilyMember={id:string;displayName:string;role:FamilyRole;status:'active'|'removed'};
type FamilySummary={id:string;displayName:string;familyChatId:string;members:FamilyMember[]};

export function familyRoleLabel(role:FamilyRole){
  if(role==='owner')return 'Главный администратор';
  if(role==='admin')return 'Администратор';
  return 'Участник';
}

export function ProfileScreen({currentMemberId}:{currentMemberId:string}){
  const [family,setFamily]=useState<FamilySummary|null>(null);
  const [error,setError]=useState('');

  useEffect(()=>{
    let disposed=false;
    void api<FamilySummary>('/v1/family').then(summary=>{
      if(!disposed)setFamily(summary);
    }).catch(reason=>{
      if(!disposed)setError(reason instanceof Error?reason.message:'Не удалось загрузить профиль');
    });
    return()=>{disposed=true;};
  },[]);

  const member=family?.members.find(item=>item.id===currentMemberId&&item.status==='active');

  return <section className="panel section-screen profile-screen">
    <h2>Профиль</h2>
    {error&&<p className="error" role="alert">{error}</p>}
    {!family&&!error&&<p className="hint">Загрузка профиля…</p>}
    {family&&member&&<>
      <div className="profile-card">
        <div className="profile-avatar" aria-hidden="true">{member.displayName.slice(0,1).toUpperCase()}</div>
        <div><h3>{member.displayName}</h3><span className={`role-badge role-${member.role}`}>{familyRoleLabel(member.role)}</span></div>
      </div>
      <dl className="profile-details">
        <div><dt>Семья</dt><dd>{family.displayName}</dd></div>
        <div><dt>Роль</dt><dd>{familyRoleLabel(member.role)}</dd></div>
      </dl>
      <div className="profile-theme"><h3>Оформление</h3><p className="hint">Тема сохраняется отдельно на каждом устройстве.</p><ThemeControl/></div>
    </>}
    {family&&!member&&<p className="error" role="alert">Профиль участника не найден.</p>}
  </section>;
}
