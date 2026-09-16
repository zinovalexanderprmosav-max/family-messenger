import type { VisibleMessage } from '../flows/messages.js';
export function MessageBubble({message,mine}:{message:VisibleMessage;mine:boolean}){return <article className={`message ${mine?'mine':''}`}><div className="message-meta">{mine?'Вы':'Семья'} · {new Date(message.sentAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div><div>{message.text}</div></article>;}
