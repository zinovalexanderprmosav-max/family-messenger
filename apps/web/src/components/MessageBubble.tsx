import {useEffect,useState} from 'react';
import {fetchAttachmentBlob} from '../flows/attachments.js';
import type {DeliveryStatus,VisibleAttachmentMessage,VisibleMessage} from '../flows/messages.js';

function formatBytes(bytes:number){
  if(bytes<1024)return `${bytes} Б`;
  if(bytes<1024*1024)return `${(bytes/1024).toFixed(1)} КБ`;
  return `${(bytes/(1024*1024)).toFixed(1)} МБ`;
}

function statusText(status:DeliveryStatus|undefined){
  if(status==='queued')return 'в очереди';
  if(status==='sending')return 'отправляется';
  if(status==='failed')return 'не отправлено';
  return '✓';
}

function TextContent({text}:{text:string}){
  const parts=text.split(/(https?:\/\/[^\s]+)/g);
  return <div>{parts.map((part,index)=>/^https?:\/\//.test(part)
    ?<a key={index} href={part} target="_blank" rel="noreferrer">{part}</a>
    :<span key={index}>{part}</span>)}</div>;
}

function PhotoViewer({url,fileName,onClose}:{url:string;fileName:string;onClose:()=>void}){
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose();};
    window.addEventListener('keydown',onKey);
    const previous=document.body.style.overflow;
    document.body.style.overflow='hidden';
    return()=>{window.removeEventListener('keydown',onKey);document.body.style.overflow=previous;};
  },[onClose]);

  return <div className="photo-viewer" role="dialog" aria-modal="true" aria-label={fileName} onClick={onClose}>
    <div className="photo-viewer-toolbar" onClick={event=>event.stopPropagation()}>
      <strong>{fileName}</strong>
      <div>
        <a className="photo-viewer-open" href={url} target="_blank" rel="noreferrer">Открыть отдельно</a>
        <button className="photo-viewer-close" aria-label="Закрыть фото" onClick={onClose}>×</button>
      </div>
    </div>
    <img className="photo-viewer-image" src={url} alt={fileName} onClick={event=>event.stopPropagation()}/>
  </div>;
}

function AttachmentContent({message}:{message:VisibleAttachmentMessage}){
  const [url,setUrl]=useState('');
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [viewerOpen,setViewerOpen]=useState(false);

  async function load(){
    if(url||loading)return;
    setLoading(true);setError('');
    try{
      const blob=message.localBlob??await fetchAttachmentBlob({
        chatId:message.chatId,attachmentId:message.attachmentId,
        attachmentKey:message.attachmentKey,mimeType:message.mimeType
      });
      setUrl(URL.createObjectURL(blob));
    }catch(e){
      setError(e instanceof Error?e.message:'Не удалось открыть файл');
    }finally{
      setLoading(false);
    }
  }

  useEffect(()=>{
    setError('');setViewerOpen(false);
    if(message.localBlob||message.mediaKind==='image'||message.mediaKind==='audio')void load();
    return()=>{};
  },[message.messageId]);

  useEffect(()=>()=>{if(url)URL.revokeObjectURL(url);},[url]);

  return <div className="attachment-content">
    {message.mediaKind==='image'&&url&&<>
      <button type="button" className="chat-image-button" aria-label="Открыть фото" onClick={()=>setViewerOpen(true)}>
        <img className="chat-image" src={url} alt={message.fileName} onError={()=>setError('Не удалось показать фото')}/>
      </button>
      {viewerOpen&&<PhotoViewer url={url} fileName={message.fileName} onClose={()=>setViewerOpen(false)}/>}
    </>}
    {message.mediaKind==='video'&&url&&<video className="chat-video" src={url} controls playsInline/>}
    {message.mediaKind==='audio'&&url&&<audio className="voice-player" src={url} controls preload="metadata"/>}
    <div className="attachment-meta">
      <strong>{message.mediaKind==='audio'?'Голосовое сообщение':message.fileName}</strong>
      <span>{formatBytes(message.size)}</span>
    </div>
    {!url&&message.mediaKind==='image'&&<button className="attachment-open" onClick={()=>void load()} disabled={loading}>
      {loading?'Открываем фото…':'Открыть фото'}
    </button>}
    {!url&&message.mediaKind!=='image'&&message.mediaKind!=='audio'&&<button className="attachment-open" onClick={()=>void load()} disabled={loading}>
      {loading?'Открываем…':message.mediaKind==='video'?'Открыть видео':'Открыть файл'}
    </button>}
    {url&&message.mediaKind==='file'&&<a className="attachment-open attachment-link" href={url} download={message.fileName}>Сохранить файл</a>}
    {error&&<div className="error attachment-error">{error}</div>}
  </div>;
}

const QUICK_REACTIONS=['❤️','👍','😂','😮','😢','🙏'];

export function MessageBubble({
  message,mine,currentDeviceId,onReply,onReact,onEdit,onDelete,actionsDisabled=false
}:{
  message:VisibleMessage;mine:boolean;currentDeviceId:string;
  onReply?:(()=>void)|undefined;
  onReact?:((emoji:string,action:'add'|'remove')=>void)|undefined;
  onEdit?:(()=>void)|undefined;onDelete?:(()=>void)|undefined;actionsDisabled?:boolean|undefined;
}){
  const [menuOpen,setMenuOpen]=useState(false);
  const canAct=message.kind!=='deleted'&&(onReply||onReact||onEdit||onDelete);

  return <article className={`message ${mine?'mine':''} ${message.kind==='deleted'?'message-deleted':''}`}>
    <div className="message-meta">
      <span>
        {mine?'Вы':'Семья'} · {new Date(message.sentAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}
        {message.editedAt&&<span className="message-edited"> · изменено</span>}
        {mine&&<span className={`message-status status-${message.deliveryStatus??'sent'}`}> · {statusText(message.deliveryStatus)}</span>}
      </span>
      {canAct&&<div className="message-actions">
        <button type="button" className="message-menu-button" aria-label="Действия с сообщением" aria-expanded={menuOpen} disabled={actionsDisabled} onClick={()=>setMenuOpen(value=>!value)}>⋯</button>
        {menuOpen&&<div className="message-menu" role="menu">
          {onReply&&<button type="button" role="menuitem" onClick={()=>{setMenuOpen(false);onReply();}}>Ответить</button>}
          {onReact&&<div className="message-reaction-picker" aria-label="Реакции">
            {QUICK_REACTIONS.map(emoji=>{
              const reacted=message.reactions?.some(reaction=>reaction.emoji===emoji&&reaction.senderDeviceIds.includes(currentDeviceId))??false;
              return <button key={emoji} type="button" className={reacted?'active':''} aria-label={(reacted?'Убрать реакцию ':'Поставить реакцию ')+emoji} onClick={()=>{setMenuOpen(false);onReact(emoji,reacted?'remove':'add');}}>{emoji}</button>;
            })}
          </div>}
          {message.kind==='text'&&onEdit&&<button type="button" role="menuitem" onClick={()=>{setMenuOpen(false);onEdit();}}>Редактировать</button>}
          {onDelete&&<button type="button" role="menuitem" className="message-menu-danger" onClick={()=>{setMenuOpen(false);onDelete();}}>Удалить</button>}
        </div>}
      </div>}
    </div>
    {message.replyTo&&message.kind!=='deleted'&&<div className="message-reply-preview">
      <span>Ответ на сообщение</span><strong>{message.replyTo.preview}</strong>
    </div>}
    {message.kind==='text'
      ?<TextContent text={message.text}/>
      :message.kind==='attachment'
        ?<AttachmentContent message={message}/>
        :<div className="deleted-message-text">Сообщение удалено</div>}
    {message.kind!=='deleted'&&message.reactions&&message.reactions.length>0&&<div className="message-reactions">
      {message.reactions.map(reaction=>{
        const reacted=reaction.senderDeviceIds.includes(currentDeviceId);
        return <button key={reaction.emoji} type="button" className={reacted?'active':''} disabled={actionsDisabled||!onReact} onClick={()=>onReact?.(reaction.emoji,reacted?'remove':'add')}>
          <span>{reaction.emoji}</span><small>{reaction.senderDeviceIds.length}</small>
        </button>;
      })}
    </div>}
  </article>;
}
