import {useEffect,useRef,useState} from 'react';
import {ConnectionBadge} from '../components/ConnectionBadge.js';
import {MessageBubble} from '../components/MessageBubble.js';
import {openDirectChat} from '../flows/direct-chat.js';
import {readLocalVisibleMessages,reconcileChat,sendAttachmentMessage,sendTextMessage,type VisibleMessage} from '../flows/messages.js';
import {connectRealtime} from '../realtime/socket.js';
import {getUnlockedPin,setUnlockedPin,loadProfile} from '../local/session.js';
import {unlockDeviceProfile} from '../local/keystore.js';

type SelectedMember={id:string;displayName:string};

function friendlyError(error:unknown){
  if(!(error instanceof Error))return 'Ошибка';
  if(error.message==='video_too_large')return 'Видео больше 20 МБ. Выберите более короткий ролик.';
  if(error.message==='attachment_too_large')return 'Файл больше 20 МБ.';
  return error.message;
}

export function FamilyChatScreen({selectedMember}:{selectedMember?:SelectedMember|null}){
  const [profile,setProfile]=useState<Awaited<ReturnType<typeof loadProfile>>>(null);
  const [inputPin,setInputPin]=useState('');
  const [readyPin,setReadyPin]=useState(getUnlockedPin()??'');
  const [activeChatId,setActiveChatId]=useState('');
  const [draft,setDraft]=useState('');
  const [messages,setMessages]=useState<VisibleMessage[]>([]);
  const [connection,setConnection]=useState<'connecting'|'online'|'offline'>('offline');
  const [error,setError]=useState('');
  const [uploading,setUploading]=useState(false);
  const fileInput=useRef<HTMLInputElement>(null);

  useEffect(()=>{void loadProfile().then(setProfile);},[]);

  useEffect(()=>{
    if(!profile||!readyPin){setActiveChatId('');return;}
    let cancelled=false;let stop=()=>{};
    setActiveChatId('');setMessages([]);setConnection('connecting');
    const activate=async()=>{
      try{
        const chatId=selectedMember?(await openDirectChat(selectedMember.id,readyPin)).chatId:profile.familyChatId;
        if(cancelled)return;
        setActiveChatId(chatId);setError('');
        try{const local=await readLocalVisibleMessages(chatId,readyPin);if(!cancelled)setMessages(local);}
        catch{if(!cancelled)setMessages([]);}
        if(cancelled)return;
        const reconcile=async()=>{
          try{
            const incoming=await reconcileChat(chatId,readyPin);
            if(incoming.length&&!cancelled){
              const local=await readLocalVisibleMessages(chatId,readyPin);
              if(!cancelled)setMessages(local);
            }
          }catch(err){if(!cancelled)setError(friendlyError(err));}
        };
        stop=connectRealtime({chatId,onReconcile:reconcile,onState:state=>{if(!cancelled)setConnection(state);}});
      }catch(err){if(!cancelled){setConnection('offline');setError(friendlyError(err));}}
    };
    void activate();
    return()=>{cancelled=true;stop();};
  },[profile,readyPin,selectedMember?.id]);

  if(!profile)return null;

  if(!readyPin)return <main className="center-card">
    <h1>Разблокировать</h1>
    <form className="form" onSubmit={async e=>{
      e.preventDefault();
      try{await unlockDeviceProfile(inputPin);setUnlockedPin(inputPin);setReadyPin(inputPin);setError('');}
      catch(err){setError(err instanceof Error?err.message:'Неверный PIN');}
    }}>
      <label>PIN<input inputMode="numeric" pattern="[0-9]{6,}" value={inputPin} onChange={e=>setInputPin(e.target.value)} required/></label>
      {error&&<p className="error">{error}</p>}
      <button className="primary">Открыть чат</button>
    </form>
  </main>;

  const activeProfile=profile;

  async function refreshMessages(){if(activeChatId)setMessages(await readLocalVisibleMessages(activeChatId,readyPin));}

  async function send(e:React.FormEvent){
    e.preventDefault();const text=draft.trim();if(!text||!activeChatId)return;
    setDraft('');
    try{await sendTextMessage(text,readyPin,activeChatId);await refreshMessages();setError('');}
    catch(err){setError(friendlyError(err));setDraft(text);}
  }

  async function sendFile(file:File|undefined){
    if(!file||!activeChatId||uploading)return;
    setUploading(true);setError('');
    try{await sendAttachmentMessage(file,readyPin,activeChatId);await refreshMessages();}
    catch(err){setError(friendlyError(err));}
    finally{setUploading(false);if(fileInput.current)fileInput.current.value='';}
  }

  return <section className="chat">
    <header className="chat-header">
      <div><strong>{selectedMember?.displayName??activeProfile.familyDisplayName??'Наша семья'}</strong><div className="hint">Сквозное шифрование</div></div>
      <ConnectionBadge state={connection}/>
    </header>
    <div className="messages">{messages.map(m=><MessageBubble key={m.messageId} message={m} mine={m.senderDeviceId===activeProfile.deviceId}/>)}</div>
    {error&&<div className="error-inline">{error}</div>}
    <form className="composer" onSubmit={send}>
      <input ref={fileInput} className="file-input" type="file" accept="image/*,video/*,.pdf,.txt,.zip,.doc,.docx,.xls,.xlsx" onChange={e=>void sendFile(e.target.files?.[0])}/>
      <button type="button" className="attach-button" aria-label="Добавить фото, видео или файл" disabled={!activeChatId||uploading} onClick={()=>fileInput.current?.click()}>{uploading?'…':'＋'}</button>
      <textarea aria-label="Сообщение" value={draft} onChange={e=>setDraft(e.target.value)} placeholder={selectedMember?`Сообщение ${selectedMember.displayName}`:'Сообщение семье'} rows={1}/>
      <button className="send" aria-label="Отправить" disabled={!activeChatId||uploading}>➤</button>
    </form>
  </section>;
}
