import { useEffect,useState } from 'react';
import { ConnectionBadge } from '../components/ConnectionBadge.js';
import { MessageBubble } from '../components/MessageBubble.js';
import { flushOutbox,readLocalVisibleMessages,reconcileChat,sendTextMessage,type VisibleMessage } from '../flows/messages.js';
import { listOutbox } from '../local/outbox.js';
import { connectRealtime } from '../realtime/socket.js';
import { getUnlockedPin,setUnlockedPin,loadProfile } from '../local/session.js';
import { unlockDeviceProfile } from '../local/keystore.js';

type ChatScreenProps={chatId?:string;title?:string;subtitle?:string;senderLabel?:string};

export function FamilyChatScreen({chatId,title,subtitle,senderLabel}:ChatScreenProps={}){
  const [profile,setProfile]=useState<Awaited<ReturnType<typeof loadProfile>>>(null);
  const [inputPin,setInputPin]=useState('');
  const [readyPin,setReadyPin]=useState(getUnlockedPin()??'');
  const [draft,setDraft]=useState('');
  const [messages,setMessages]=useState<VisibleMessage[]>([]);
  const [connection,setConnection]=useState<'connecting'|'online'|'offline'>(()=>typeof navigator!=='undefined'&&navigator.onLine===false?'offline':'connecting');
  const [resending,setResending]=useState(false);
  const [error,setError]=useState('');

  useEffect(()=>{void loadProfile().then(setProfile);},[]);

  const selectedChatId=profile?(chatId??profile.familyChatId):chatId;

  useEffect(()=>{
    if(!profile||!readyPin||!selectedChatId)return;
    let disposed=false;
    let stop=()=>{};
    const refreshLocal=async()=>{const local=await readLocalVisibleMessages(selectedChatId,readyPin);if(!disposed)setMessages(local);};
    const reconcile=async()=>{await reconcileChat(selectedChatId,readyPin);await refreshLocal();};
    const flushPending=async()=>{
      const queued=await listOutbox(selectedChatId);if(!disposed&&queued.length>0)setResending(true);
      try{await flushOutbox(selectedChatId,readyPin);await refreshLocal();}
      finally{if(!disposed)setResending(false);}
    };
    const recover=async()=>{
      if(!disposed)setConnection('connecting');
      try{await flushPending();await reconcile();if(!disposed)setConnection('online');}
      catch{if(!disposed)setConnection('offline');}
    };
    const onBrowserOnline=()=>void recover();
    const onBrowserOffline=()=>{setResending(false);setConnection('offline');};

    void refreshLocal();
    window.addEventListener('online',onBrowserOnline);
    window.addEventListener('offline',onBrowserOffline);
    stop=connectRealtime({chatId:selectedChatId,onReconcile:reconcile,onOnline:flushPending,onState:state=>{if(!disposed)setConnection(state);}});
    return()=>{disposed=true;window.removeEventListener('online',onBrowserOnline);window.removeEventListener('offline',onBrowserOffline);stop();};
  },[profile,readyPin,selectedChatId]);

  if(!profile)return null;
  if(!readyPin)return <main className="center-card"><h1>Разблокировать</h1><form className="form" onSubmit={async e=>{e.preventDefault();try{await unlockDeviceProfile(inputPin);setUnlockedPin(inputPin);setReadyPin(inputPin);setError('');}catch(err){setError(err instanceof Error?err.message:'Неверный PIN');}}}><label>PIN<input inputMode="numeric" pattern="[0-9]{6,}" value={inputPin} onChange={e=>setInputPin(e.target.value)} required/></label>{error&&<p className="error">{error}</p>}<button className="primary">Открыть чат</button></form></main>;

  const activeProfile=profile;
  const activeChatId=chatId??activeProfile.familyChatId;
  async function send(e:React.FormEvent){
    e.preventDefault();const text=draft.trim();if(!text)return;setDraft('');setError('');
    try{await sendTextMessage(activeChatId,text,readyPin);}
    catch(err){setError(err instanceof Error?err.message:'Не отправлено');}
    finally{setMessages(await readLocalVisibleMessages(activeChatId,readyPin));}
  }

  return <section className="chat">
    <header className="chat-header"><div><strong>{title??activeProfile.familyDisplayName??'Наша семья'}</strong><div className="hint">{subtitle??'Сквозное шифрование'}</div></div><ConnectionBadge state={connection}/></header>
    {connection==='offline'&&<div className="connection-notice offline-notice" role="status">Нет связи — сообщения сохраняются на устройстве</div>}
    {connection==='connecting'&&resending&&<div className="connection-notice reconnect-notice" role="status">Соединение восстановлено — отправляем сообщения…</div>}
    <div className="messages">{messages.map(m=><MessageBubble key={m.messageId} message={m} mine={m.senderDeviceId===activeProfile.deviceId} {...(senderLabel===undefined?{}:{senderLabel})}/>)}</div>
    {error&&<div className="error-inline">{error}</div>}
    <form className="composer" onSubmit={send}><textarea aria-label="Сообщение" value={draft} onChange={e=>setDraft(e.target.value)} placeholder={title?`Сообщение: ${title}`:'Сообщение семье'} rows={1}/><button className="send" aria-label="Отправить">➤</button></form>
  </section>;
}
