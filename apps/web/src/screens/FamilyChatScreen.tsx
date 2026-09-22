import {useEffect,useRef,useState} from 'react';
import {ConnectionBadge} from '../components/ConnectionBadge.js';
import {MessageBubble} from '../components/MessageBubble.js';
import {openDirectChat} from '../flows/direct-chat.js';
import {deleteMessage,editTextMessage,flushOutbox,readLocalVisibleMessages,reconcileChat,sendAttachmentMessage,sendTextMessage,type VisibleMessage,type VisibleTextMessage} from '../flows/messages.js';
import {connectRealtime} from '../realtime/socket.js';
import {getUnlockedPin,setUnlockedPin,loadProfile} from '../local/session.js';
import {unlockDeviceProfile} from '../local/keystore.js';

type SelectedMember={id:string;displayName:string};

function friendlyError(error:unknown){
  if(!(error instanceof Error))return 'Ошибка';
  if(error.message==='video_too_large')return 'Видео больше 20 МБ. Выберите более короткий ролик.';
  if(error.message==='attachment_too_large')return 'Файл больше 20 МБ.';
  if(error.message==='message_not_owned')return 'Можно изменять и удалять только свои сообщения.';
  if(error.message==='message_not_found')return 'Сообщение уже недоступно.';
  if(/Permission|NotAllowed/i.test(error.message))return 'Нет доступа к микрофону. Разрешите микрофон для Family Messenger в настройках устройства.';
  return error.message;
}

function formatDuration(seconds:number){
  const min=Math.floor(seconds/60),sec=seconds%60;
  return `${min}:${String(sec).padStart(2,'0')}`;
}

export function FamilyChatScreen({selectedMember}:{selectedMember?:SelectedMember|null}){
  const [profile,setProfile]=useState<Awaited<ReturnType<typeof loadProfile>>>(null);
  const [inputPin,setInputPin]=useState('');
  const [readyPin,setReadyPin]=useState(getUnlockedPin()??'');
  const [activeChatId,setActiveChatId]=useState('');
  const [draft,setDraft]=useState('');
  const [messages,setMessages]=useState<VisibleMessage[]>([]);
  const [editingMessage,setEditingMessage]=useState<VisibleTextMessage|null>(null);
  const [messageActionBusy,setMessageActionBusy]=useState(false);
  const [connection,setConnection]=useState<'connecting'|'online'|'offline'>('offline');
  const [error,setError]=useState('');
  const [uploading,setUploading]=useState(false);
  const [recording,setRecording]=useState(false);
  const [recordingSeconds,setRecordingSeconds]=useState(0);
  const fileInput=useRef<HTMLInputElement>(null);
  const composerInput=useRef<HTMLTextAreaElement>(null);
  const recorderRef=useRef<MediaRecorder|null>(null);
  const recordingStreamRef=useRef<MediaStream|null>(null);
  const chunksRef=useRef<Blob[]>([]);
  const timerRef=useRef<number|undefined>(undefined);

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
            await reconcileChat(chatId,readyPin);
            if(!cancelled)setMessages(await readLocalVisibleMessages(chatId,readyPin));
          }catch(err){if(!cancelled)setError(friendlyError(err));}
        };
        stop=connectRealtime({chatId,onReconcile:reconcile,onState:state=>{if(!cancelled)setConnection(state);}});
      }catch(err){if(!cancelled){setConnection('offline');setError(friendlyError(err));}}
    };
    void activate();
    return()=>{cancelled=true;stop();};
  },[profile,readyPin,selectedMember?.id]);

  useEffect(()=>{
    if(!readyPin)return;
    const online=()=>{void flushOutbox(readyPin,activeChatId||undefined).then(()=>{if(activeChatId)void refreshMessages();});};
    window.addEventListener('online',online);
    return()=>window.removeEventListener('online',online);
  },[readyPin,activeChatId]);

  useEffect(()=>()=>stopRecording(false),[]);

  if(!profile)return null;

  if(!readyPin)return <main className="center-card">
    <span className="eyebrow">Защищённый вход</span>
    <h1>Разблокировать</h1>
    <p className="hint">PIN открывает ключи только на этом устройстве.</p>
    <form className="form" onSubmit={async e=>{
      e.preventDefault();
      try{await unlockDeviceProfile(inputPin);setUnlockedPin(inputPin);setReadyPin(inputPin);setError('');}
      catch(err){setError(err instanceof Error?err.message:'Неверный PIN');}
    }}>
      <label>PIN<input inputMode="numeric" pattern="[0-9]{6,}" value={inputPin} onChange={e=>setInputPin(e.target.value)} required/></label>
      {error&&<p className="error">{error}</p>}
      <button className="primary">Открыть Family Messenger</button>
    </form>
  </main>;

  const activeProfile=profile;

  async function refreshMessages(){if(activeChatId)setMessages(await readLocalVisibleMessages(activeChatId,readyPin));}

  async function send(e:React.FormEvent){
    e.preventDefault();const text=draft.trim();if(!text||!activeChatId||messageActionBusy)return;
    if(editingMessage){
      const original=editingMessage;
      if(text===original.text){setEditingMessage(null);setDraft('');return;}
      setMessageActionBusy(true);setDraft('');
      try{
        await editTextMessage(original.chatId,original.messageId,text,readyPin);
        setEditingMessage(null);await refreshMessages();setError('');
      }catch(err){
        setError(friendlyError(err));setDraft(text);
      }finally{setMessageActionBusy(false);}
      return;
    }
    setDraft('');
    try{await sendTextMessage(text,readyPin,activeChatId);await refreshMessages();setError('');}
    catch(err){setError(friendlyError(err));setDraft(text);await refreshMessages();}
  }

  function startEdit(message:VisibleTextMessage){
    setEditingMessage(message);setDraft(message.text);setError('');
    window.requestAnimationFrame(()=>composerInput.current?.focus());
  }

  function cancelEdit(){setEditingMessage(null);setDraft('');}

  async function removeMessage(message:VisibleMessage){
    if(messageActionBusy||message.kind==='deleted')return;
    if(!window.confirm('Удалить это сообщение у всех участников чата?'))return;
    setMessageActionBusy(true);setError('');
    try{
      await deleteMessage(message.chatId,message.messageId,readyPin);
      if(editingMessage?.messageId===message.messageId)cancelEdit();
      await refreshMessages();
    }catch(err){setError(friendlyError(err));}
    finally{setMessageActionBusy(false);}
  }

  async function sendFile(file:File|undefined){
    if(!file||!activeChatId||uploading)return;
    setUploading(true);setError('');
    try{await sendAttachmentMessage(file,readyPin,activeChatId);await refreshMessages();}
    catch(err){setError(friendlyError(err));await refreshMessages();}
    finally{setUploading(false);if(fileInput.current)fileInput.current.value='';}
  }

  async function startRecording(){
    if(recording||uploading||!activeChatId)return;
    if(typeof MediaRecorder==='undefined'||!navigator.mediaDevices?.getUserMedia){
      setError('Запись голоса не поддерживается этим браузером.');
      return;
    }
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
      const preferred=['audio/mp4','audio/webm;codecs=opus','audio/webm'];
      const mimeType=preferred.find(type=>MediaRecorder.isTypeSupported?.(type))??'';
      const recorder=mimeType?new MediaRecorder(stream,{mimeType}):new MediaRecorder(stream);
      recorderRef.current=recorder;recordingStreamRef.current=stream;chunksRef.current=[];
      recorder.ondataavailable=event=>{if(event.data.size>0)chunksRef.current.push(event.data);};
      recorder.onstop=()=>{
        const actualType=recorder.mimeType||mimeType||'audio/webm';
        const blob=new Blob(chunksRef.current,{type:actualType});
        chunksRef.current=[];recordingStreamRef.current?.getTracks().forEach(track=>track.stop());recordingStreamRef.current=null;
        if(blob.size>0){
          const ext=actualType.includes('mp4')?'m4a':'webm';
          const file=new File([blob],`voice-${Date.now()}.${ext}`,{type:actualType,lastModified:Date.now()});
          void sendFile(file);
        }
      };
      recorder.start(500);setRecording(true);setRecordingSeconds(0);setError('');
      timerRef.current=window.setInterval(()=>setRecordingSeconds(value=>value+1),1000);
    }catch(err){setError(friendlyError(err));}
  }

  function stopRecording(send=true){
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=undefined;}
    const recorder=recorderRef.current;recorderRef.current=null;setRecording(false);
    if(!recorder){recordingStreamRef.current?.getTracks().forEach(track=>track.stop());recordingStreamRef.current=null;return;}
    if(!send){recorder.onstop=()=>{recordingStreamRef.current?.getTracks().forEach(track=>track.stop());recordingStreamRef.current=null;};}
    if(recorder.state!=='inactive')recorder.stop();
  }

  return <section className="chat">
    <header className="chat-header">
      <div>
        <strong>{selectedMember?.displayName??activeProfile.familyDisplayName??'Общий семейный чат'}</strong>
        <div className="hint">{selectedMember?'Личный защищённый чат':'Вся семья · сквозное шифрование'}</div>
      </div>
      <ConnectionBadge state={connection}/>
    </header>
    <div className="messages">{messages.length===0
      ?<div className="empty-chat"><div className="brand-orb small">F</div><strong>Здесь начнётся ваша переписка</strong><span>Сообщения и вложения защищены сквозным шифрованием.</span></div>
      :messages.map(m=>{
        const mine=m.senderDeviceId===activeProfile.deviceId;
        return <MessageBubble
          key={m.messageId}
          message={m}
          mine={mine}
          actionsDisabled={messageActionBusy}
          onEdit={mine&&m.kind==='text'?()=>startEdit(m):undefined}
          onDelete={mine&&m.kind!=='deleted'?()=>void removeMessage(m):undefined}
        />;
      })}</div>
    {recording&&<div className="recording-banner"><span className="record-dot"/>Запись голоса {formatDuration(recordingSeconds)}</div>}
    {error&&<div className="error-inline">{error}</div>}
    <form className="composer" onSubmit={send}>
      {editingMessage&&<div className="composer-editing">
        <div><strong>Редактирование сообщения</strong><span>Изменение увидят все участники чата.</span></div>
        <button type="button" aria-label="Отменить редактирование" onClick={cancelEdit}>×</button>
      </div>}
      <input ref={fileInput} className="file-input" type="file" accept="image/*,video/*,audio/*,.pdf,.txt,.zip,.doc,.docx,.xls,.xlsx" onChange={e=>void sendFile(e.target.files?.[0])}/>
      <button type="button" className="attach-button" aria-label="Добавить фото, видео или файл" disabled={!activeChatId||uploading||recording} onClick={()=>fileInput.current?.click()}>＋</button>
      {recording
        ?<button type="button" className="voice-button recording" aria-label="Остановить и отправить голосовое" onClick={()=>stopRecording(true)}>■</button>
        :<button type="button" className="voice-button" aria-label="Записать голосовое" disabled={!activeChatId||uploading} onClick={()=>void startRecording()}>●</button>}
      <textarea ref={composerInput} aria-label={editingMessage?'Редактировать сообщение':'Сообщение'} value={draft} onChange={e=>setDraft(e.target.value)} placeholder={editingMessage?'Измените текст сообщения':recording?'Идёт запись…':selectedMember?`Сообщение ${selectedMember.displayName}`:'Сообщение семье'} rows={1} disabled={recording||messageActionBusy}/>
      <button className="send" aria-label={editingMessage?'Сохранить изменения':'Отправить'} disabled={!activeChatId||uploading||recording||messageActionBusy||!draft.trim()}>{editingMessage?'✓':'➤'}</button>
    </form>
  </section>;
}
