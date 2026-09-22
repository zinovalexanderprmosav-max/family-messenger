import { useEffect,useState } from 'react';
import { api } from './api/client.js';
import { loadProfile } from './local/session.js';
import { consumeJoinTokenFromHash } from './flows/join.js';
import { consumeDeviceEnrollmentTokenFromHash } from './flows/device-enrollment.js';
import { WelcomeScreen } from './screens/WelcomeScreen.js';
import { CreateFamilyScreen } from './screens/CreateFamilyScreen.js';
import { JoinFamilyScreen } from './screens/JoinFamilyScreen.js';
import { AddOwnDeviceScreen } from './screens/AddOwnDeviceScreen.js';
import { PendingApprovalScreen } from './screens/PendingApprovalScreen.js';
import { FamilyChatScreen } from './screens/FamilyChatScreen.js';
import { AdminScreen } from './screens/AdminScreen.js';
import { DeviceManagementScreen } from './screens/DeviceManagementScreen.js';
import { FamilyContacts,type FamilyContact } from './components/FamilyContacts.js';
import { SettingsPanel } from './components/SettingsPanel.js';
import { ThemeSwitcher } from './components/ThemeSwitcher.js';
import { StandaloneInstallHint } from './components/StandaloneInstallHint.js';
import { RecoveryRequiredScreen } from './screens/RecoveryRequiredScreen.js';
import { RecoverExistingDeviceScreen } from './screens/RecoverExistingDeviceScreen.js';
import { recoverProfileFromServerSession,type SessionContext } from './flows/session-recovery.js';
import type { LocalProfile } from './local/db.js';

type FamilySummary={primaryAdminMemberId:string|null;members:FamilyContact[]};
type MobileView='chat'|'contacts'|'devices'|'admin'|'settings';

export default function App(){
  const [profile,setProfile]=useState<LocalProfile|null|undefined>(undefined);
  const [family,setFamily]=useState<FamilySummary|null>(null);
  const [role,setRole]=useState<'admin'|'member'|null>(null);
  const [selectedMember,setSelectedMember]=useState<FamilyContact|null>(null);
  const [mode,setMode]=useState<'home'|'create'|'recover'>('home');
  const [familyRefresh,setFamilyRefresh]=useState(0);
  const [mobileView,setMobileView]=useState<MobileView>('chat');
  const [recoveryContext,setRecoveryContext]=useState<SessionContext|null>(null);
  const [joinToken]=useState(()=>consumeJoinTokenFromHash());
  const [deviceToken]=useState(()=>consumeDeviceEnrollmentTokenFromHash());
  const refresh=()=>void (async()=>{
    const local=await loadProfile();
    if(local){
      setRecoveryContext(null);
      setProfile(local);
      return;
    }
    if(joinToken||deviceToken){
      setProfile(null);
      return;
    }
    const recovered=await recoverProfileFromServerSession();
    if(recovered.status==='restored'){
      setRecoveryContext(null);
      setProfile(recovered.profile);
      return;
    }
    setRecoveryContext(recovered.status==='keys_missing'?recovered.context:null);
    setProfile(null);
  })();

  useEffect(refresh,[]);
  useEffect(()=>{
    if(!profile||profile.status!=='active'){setFamily(null);setRole(null);setSelectedMember(null);return;}
    let cancelled=false;
    void api<FamilySummary>('/v1/family').then(summary=>{
      if(cancelled)return;
      setFamily(summary);
      setRole(summary.members.find(member=>member.id===profile.memberId)?.role??'member');
      if(selectedMember&&!summary.members.some(member=>member.id===selectedMember.id&&member.status==='active'))setSelectedMember(null);
    }).catch(()=>{if(!cancelled){setFamily(null);setRole('member');}});
    return()=>{cancelled=true;};
  },[profile,familyRefresh]);

  if(profile===undefined)return <main className="splash-screen"><div className="brand-orb">F</div><div className="spinner"/></main>;
  if(!profile&&joinToken)return <JoinFamilyScreen token={joinToken} onDone={refresh}/>;
  if(!profile&&deviceToken)return <AddOwnDeviceScreen token={deviceToken} onDone={refresh}/>;
  if(!profile&&recoveryContext)return <RecoveryRequiredScreen context={recoveryContext} onRetry={refresh}/>;
  if(!profile&&mode==='recover')return <RecoverExistingDeviceScreen onDone={refresh} onBack={()=>setMode('home')}/>;
  if(!profile&&mode==='create')return <CreateFamilyScreen onDone={refresh} onBack={()=>setMode('home')}/>;
  if(!profile)return <WelcomeScreen onCreate={()=>setMode('create')} onRecover={()=>setMode('recover')}/>;
  if(profile.status==='pending_key')return <PendingApprovalScreen onDone={refresh}/>;

  const pickMember=(member:FamilyContact|null)=>{setSelectedMember(member);setMobileView('chat');};
  const showAdmin=role==='admin'&&family;

  return <div className="app-shell">
    <StandaloneInstallHint/>
    <header className="app-topbar">
      <div className="brand-lockup">
        <div className="brand-orb small">F</div>
        <div><strong>{profile.familyDisplayName??'Family Messenger'}</strong><span>{profile.memberDisplayName}</span></div>
      </div>
      <ThemeSwitcher compact/>
    </header>

    <main className="app-layout">
      <div className={mobileView==='chat'?'mobile-pane active':'mobile-pane'}>
        <FamilyChatScreen selectedMember={selectedMember}/>
      </div>
      <aside className="side-stack">
        {family&&<div className={mobileView==='contacts'?'mobile-pane active':'mobile-pane desktop-visible'}>
          <FamilyContacts members={family.members} currentMemberId={profile.memberId} selectedMemberId={selectedMember?.id??null} onSelectMember={pickMember}/>
        </div>}
        <div className={mobileView==='devices'?'mobile-pane active':'mobile-pane desktop-visible'}><DeviceManagementScreen/></div>
        {role==='admin'&&family&&<div className={mobileView==='admin'?'mobile-pane active':'mobile-pane desktop-visible'}>
          <AdminScreen family={family} currentMemberId={profile.memberId} onChanged={()=>setFamilyRefresh(value=>value+1)}/>
        </div>}
        <div className={mobileView==='settings'?'mobile-pane active':'mobile-pane desktop-visible'}><SettingsPanel/></div>
      </aside>
    </main>

    <nav className="bottom-nav" aria-label="Основная навигация">
      <button className={mobileView==='chat'?'active':''} onClick={()=>setMobileView('chat')}><span>●</span><small>Чаты</small></button>
      <button className={mobileView==='contacts'?'active':''} onClick={()=>setMobileView('contacts')}><span>♧</span><small>Контакты</small></button>
      <button className={mobileView==='devices'?'active':''} onClick={()=>setMobileView('devices')}><span>▣</span><small>Устройства</small></button>
      {showAdmin&&<button className={mobileView==='admin'?'active':''} onClick={()=>setMobileView('admin')}><span>◇</span><small>Семья</small></button>}
      <button className={mobileView==='settings'?'active':''} onClick={()=>setMobileView('settings')}><span>⚙</span><small>Настройки</small></button>
    </nav>
  </div>;
}
