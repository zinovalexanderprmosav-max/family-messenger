import type { VisibleMessage } from '../flows/messages.js';

export function MessageBubble({message,mine,senderLabel}:{message:VisibleMessage;mine:boolean;senderLabel?:string}){
  const status=message.sendState==='queued'?'Ожидает сети':message.sendState==='sending'?'Отправляется...':'Отправлено';
  const author=mine?'Вы':senderLabel??'Семья';
  return <article className={`message ${mine?'mine':''}`}>
    <div className="message-meta">{author} · {new Date(message.sentAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div>
    <div className="message-text">{message.text}</div>
    {mine&&<div className={`message-status status-${message.sendState}`} aria-label={`Статус: ${status}`}>{status}</div>}
  </article>;
}
