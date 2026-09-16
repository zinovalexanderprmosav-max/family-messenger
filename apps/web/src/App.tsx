import { useEffect,useState } from 'react';
import { loadProfile } from './local/session.js';
import { consumeJoinTokenFromHash } from './flows/join.js';
import { WelcomeScreen } from './screens/WelcomeScreen.js';
import { CreateFamilyScreen } from './screens/CreateFamilyScreen.js';
import { JoinFamilyScreen } from './screens/JoinFamilyScreen.js';
import { PendingApprovalScreen } from './screens/PendingApprovalScreen.js';
import { FamilyChatScreen } from './screens/FamilyChatScreen.js';
import { AdminScreen } from './screens/AdminScreen.js';
import type { LocalProfile } from './local/db.js';
export default function App(){const [profile,setProfile]=useState<LocalProfile|null|undefined>(undefined);const [mode,setMode]=useState<'home'|'create'>('home');const [joinToken]=useState(()=>consumeJoinTokenFromHash());const refresh=()=>void loadProfile().then(setProfile);useEffect(refresh,[]);if(profile===undefined)return <main className="center-card">Загрузка…</main>;if(!profile&&joinToken)return <JoinFamilyScreen token={joinToken} onDone={refresh}/>;if(!profile&&mode==='create')return <CreateFamilyScreen onDone={refresh} onBack={()=>setMode('home')}/>;if(!profile)return <WelcomeScreen onCreate={()=>setMode('create')}/>;if(profile.status==='pending_key')return <PendingApprovalScreen onDone={refresh}/>;return <div className="app-layout"><FamilyChatScreen/><AdminScreen/></div>;}
