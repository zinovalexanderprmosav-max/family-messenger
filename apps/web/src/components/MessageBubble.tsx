import type { VisibleMessage } from '../flows/messages.js';

export function MessageBubble({message,mine}:{message:VisibleMessage;mine:boolean}){
  const status=message.sendState==='queued'?'Ожидает сети':message.sendState==='sending'?'Отправляется...':'Отправлено';
  return <article className={`message ${mine?'mine':''}`}>
    <div className="message-meta">{mine?'Вы':'Семья'} · {new Date(message.sentAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div>
    <div className="message-text">{message.text}</div>
    {mine&&<div className={`message-status status-${message.sendState}`} aria-label={`Статус: ${status}`}>{status}</div>}
  </article>;
}
