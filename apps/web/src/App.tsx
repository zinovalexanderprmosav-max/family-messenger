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
import type { LocalProfile } from './local/db.js';

type FamilySummary={members:FamilyContact[]};

export default function App(){
  const [profile,setProfile]=useState<LocalProfile|null|undefined>(undefined);
  const [family,setFamily]=useState<FamilySummary|null>(null);
  const [role,setRole]=useState<'admin'|'member'|null>(null);
  const [selectedMember,setSelectedMember]=useState<FamilyContact|null>(null);
  const [mode,setMode]=useState<'home'|'create'>('home');
  const [joinToken]=useState(()=>consumeJoinTokenFromHash());
  const [deviceToken]=useState(()=>consumeDeviceEnrollmentTokenFromHash());
  const refresh=()=>void loadProfile().then(setProfile);

  useEffect(refresh,[]);
  useEffect(()=>{
    if(!profile||profile.status!=='active'){setFamily(null);setRole(null);setSelectedMember(null);return;}
    let cancelled=false;
    void api<FamilySummary>('/v1/family').then(summary=>{
      if(cancelled)return;
      setFamily(summary);
      setRole(summary.members.find(member=>member.id===profile.memberId)?.role??'member');
    }).catch(()=>{if(!cancelled){setFamily(null);setRole('member');}});
    return()=>{cancelled=true;};
  },[profile]);

  if(profile===undefined)return <main className="center-card">Загрузка…</main>;
  if(!profile&&joinToken)return <JoinFamilyScreen token={joinToken} onDone={refresh}/>;
  if(!profile&&deviceToken)return <AddOwnDeviceScreen token={deviceToken} onDone={refresh}/>;
  if(!profile&&mode==='create')return <CreateFamilyScreen onDone={refresh} onBack={()=>setMode('home')}/>;
  if(!profile)return <WelcomeScreen onCreate={()=>setMode('create')}/>;
  if(profile.status==='pending_key')return <PendingApprovalScreen onDone={refresh}/>;
  return <div className="app-layout">
    <FamilyChatScreen selectedMember={selectedMember}/>
    <div className="side-stack">
      {family&&<FamilyContacts members={family.members} currentMemberId={profile.memberId} selectedMemberId={selectedMember?.id??null} onSelectMember={setSelectedMember}/>}
      <DeviceManagementScreen/>
      {role==='admin'&&<AdminScreen/>}
    </div>
  </div>;
}
