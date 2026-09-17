import { useEffect,useState } from 'react';
import { ThemeControl } from './components/ThemeControl.js';
import { AppShell,type AppSection } from './components/AppShell.js';
import { getUnlockedPin,loadProfile } from './local/session.js';
import { consumeJoinTokenFromHash } from './flows/join.js';
import { consumeDeviceLinkTokenFromHash } from './flows/device-link.js';
import { openOrCreateDirectChat } from './flows/chats.js';
import { WelcomeScreen } from './screens/WelcomeScreen.js';
import { CreateFamilyScreen } from './screens/CreateFamilyScreen.js';
import { JoinFamilyScreen } from './screens/JoinFamilyScreen.js';
import { AcceptDeviceLinkScreen } from './screens/AcceptDeviceLinkScreen.js';
import { PendingApprovalScreen } from './screens/PendingApprovalScreen.js';
import { FamilyChatScreen } from './screens/FamilyChatScreen.js';
import { ContactsScreen,type ContactItem } from './screens/ContactsScreen.js';
import type { LocalProfile } from './local/db.js';

type SelectedChat={chatId:string;title:string;senderLabel:string};

export default function App(){
  const [profile,setProfile]=useState<LocalProfile|null|undefined>(undefined);
  const [mode,setMode]=useState<'home'|'create'>('home');
  const [section,setSection]=useState<AppSection>('chats');
  const [selectedChat,setSelectedChat]=useState<SelectedChat|null>(null);
  const [joinToken]=useState(()=>consumeJoinTokenFromHash());
  const [deviceLinkToken]=useState(()=>consumeDeviceLinkTokenFromHash());
  const refresh=()=>void loadProfile().then(setProfile);
  useEffect(refresh,[]);

  async function openContact(contact:ContactItem){
    const pin=getUnlockedPin();
    if(!pin)throw new Error('Сначала разблокируйте приложение PIN-кодом.');
    const opened=await openOrCreateDirectChat(contact.memberId,pin);
    setSelectedChat({chatId:opened.chatId,title:contact.displayName,senderLabel:contact.displayName});
    setSection('chats');
  }

  let content;
  if(profile===undefined)content=<main className="center-card">Загрузка…</main>;
  else if(!profile&&joinToken)content=<JoinFamilyScreen token={joinToken} onDone={refresh}/>;
  else if(!profile&&deviceLinkToken)content=<AcceptDeviceLinkScreen token={deviceLinkToken} onDone={refresh}/>;
  else if(!profile&&mode==='create')content=<CreateFamilyScreen onDone={refresh} onBack={()=>setMode('home')}/>;
  else if(!profile)content=<WelcomeScreen onCreate={()=>setMode('create')}/>;
  else if(profile.status==='pending_key')content=<PendingApprovalScreen onDone={refresh}/>;
  else content=<AppShell active={section} onSelect={setSection}>
    {section==='chats'&&(selectedChat
      ?<FamilyChatScreen chatId={selectedChat.chatId} title={selectedChat.title} subtitle="Личный защищённый чат" senderLabel={selectedChat.senderLabel}/>
      :<FamilyChatScreen/>)}
    {section==='contacts'&&<ContactsScreen onOpen={openContact}/>} 
  </AppShell>;

  return <><ThemeControl/>{content}</>;
}
