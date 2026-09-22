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

function AttachmentContent({message}:{message:VisibleAttachmentMessage}){
  const [url,setUrl]=useState('');
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');

  async function load(){
    if(url||loading)return;
    setLoading(true);setError('');
    try{
      const blob=message.localBlob??await fetchAttachmentBlob({
        chatId:message.chatId,attachmentId:message.attachmentId,
        attachmentKey:message.attachmentKey,mimeType:message.mimeType
      });
      setUrl(URL.createObjectURL(blob));
    }catch(e){setError(e instanceof Error?e.message:'Не удалось открыть файл');}
    finally{setLoading(false);}
  }

  useEffect(()=>{
    if(message.localBlob||message.mediaKind==='image'||message.mediaKind==='audio')void load();
    return()=>{if(url)URL.revokeObjectURL(url);};
  },[message.messageId]);

  return <div className="attachment-content">
    {message.mediaKind==='image'&&url&&<img className="chat-image" src={url} alt={message.fileName}/>}
    {message.mediaKind==='video'&&url&&<video className="chat-video" src={url} controls playsInline/>}
    {message.mediaKind==='audio'&&url&&<audio className="voice-player" src={url} controls preload="metadata"/>}
    <div className="attachment-meta">
      <strong>{message.mediaKind==='audio'?'Голосовое сообщение':message.fileName}</strong>
      <span>{formatBytes(message.size)}</span>
    </div>
    {!url&&message.mediaKind!=='image'&&message.mediaKind!=='audio'&&<button className="attachment-open" onClick={()=>void load()} disabled={loading}>
      {loading?'Открываем…':message.mediaKind==='video'?'Открыть видео':'Открыть файл'}
    </button>}
    {url&&message.mediaKind==='file'&&<a className="attachment-open attachment-link" href={url} download={message.fileName}>Сохранить файл</a>}
    {error&&<div className="error">{error}</div>}
  </div>;
}

export function MessageBubble({message,mine}:{message:VisibleMessage;mine:boolean}){
  return <article className={`message ${mine?'mine':''}`}>
    <div className="message-meta">
      {mine?'Вы':'Семья'} · {new Date(message.sentAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}
      {mine&&<span className={`message-status status-${message.deliveryStatus??'sent'}`}> · {statusText(message.deliveryStatus)}</span>}
    </div>
    {message.kind==='text'?<TextContent text={message.text}/>:<AttachmentContent message={message}/>}
  </article>;
}
