import { useEffect,useState } from 'react';
import { ThemeControl } from './components/ThemeControl.js';
import { loadProfile } from './local/session.js';
import { consumeJoinTokenFromHash } from './flows/join.js';
import { consumeDeviceLinkTokenFromHash } from './flows/device-link.js';
import { WelcomeScreen } from './screens/WelcomeScreen.js';
import { CreateFamilyScreen } from './screens/CreateFamilyScreen.js';
import { JoinFamilyScreen } from './screens/JoinFamilyScreen.js';
import { AcceptDeviceLinkScreen } from './screens/AcceptDeviceLinkScreen.js';
import { PendingApprovalScreen } from './screens/PendingApprovalScreen.js';
import { FamilyChatScreen } from './screens/FamilyChatScreen.js';
import { AdminScreen } from './screens/AdminScreen.js';
import type { LocalProfile } from './local/db.js';

export default function App(){
  const [profile,setProfile]=useState<LocalProfile|null|undefined>(undefined);
  const [mode,setMode]=useState<'home'|'create'>('home');
  const [joinToken]=useState(()=>consumeJoinTokenFromHash());
  const [deviceLinkToken]=useState(()=>consumeDeviceLinkTokenFromHash());
  const refresh=()=>void loadProfile().then(setProfile);
  useEffect(refresh,[]);

  let content;
  if(profile===undefined)content=<main className="center-card">Загрузка…</main>;
  else if(!profile&&joinToken)content=<JoinFamilyScreen token={joinToken} onDone={refresh}/>;
  else if(!profile&&deviceLinkToken)content=<AcceptDeviceLinkScreen token={deviceLinkToken} onDone={refresh}/>;
  else if(!profile&&mode==='create')content=<CreateFamilyScreen onDone={refresh} onBack={()=>setMode('home')}/>;
  else if(!profile)content=<WelcomeScreen onCreate={()=>setMode('create')}/>;
  else if(profile.status==='pending_key')content=<PendingApprovalScreen onDone={refresh}/>;
  else content=<div className="app-layout"><FamilyChatScreen/><AdminScreen/></div>;

  return <><ThemeControl/>{content}</>;
}
