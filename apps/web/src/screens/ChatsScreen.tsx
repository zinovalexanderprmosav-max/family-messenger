import { useEffect,useState } from 'react';
import { api } from '../api/client.js';

export type FamilyChatItem={chatId:string;kind:'family';title:string};
export type DirectChatItem={chatId:string;kind:'direct';title:string;otherMemberId:string};
export type ChatListItem=FamilyChatItem|DirectChatItem;

export function ChatsScreen({onOpenFamily,onOpenDirect}:{onOpenFamily:(chat:FamilyChatItem)=>void;onOpenDirect:(chat:DirectChatItem)=>Promise<void>}){
  const [items,setItems]=useState<ChatListItem[]>([]);
  const [loading,setLoading]=useState(true);
  const [openingId,setOpeningId]=useState<string|null>(null);
  const [error,setError]=useState('');

  useEffect(()=>{
    let disposed=false;
    void api<{items:ChatListItem[]}>('/v1/chats').then(response=>{
      if(!disposed)setItems(response.items);
    }).catch(reason=>{
      if(!disposed)setError(reason instanceof Error?reason.message:'Не удалось загрузить чаты');
    }).finally(()=>{
      if(!disposed)setLoading(false);
    });
    return()=>{disposed=true;};
  },[]);

  async function openDirect(chat:DirectChatItem){
    setOpeningId(chat.chatId);setError('');
    try{await onOpenDirect(chat);}catch(reason){setError(reason instanceof Error?reason.message:'Не удалось открыть чат');}
    finally{setOpeningId(null);}
  }

  return <section className="panel section-screen chats-screen">
    <div className="section-heading"><div><h2>Чаты</h2><p className="hint">Общий семейный чат и личные защищённые переписки.</p></div></div>
    {loading&&<p className="hint">Загрузка чатов…</p>}
    {error&&<p className="error" role="alert">{error}</p>}
    {!loading&&items.length===0&&!error&&<p className="hint">Чатов пока нет.</p>}
    <div className="chat-list">{items.map(chat=>chat.kind==='family'
      ?<button className="chat-row family-chat-row" key={chat.chatId} onClick={()=>onOpenFamily(chat)}>
        <span className="chat-avatar" aria-hidden="true">⌂</span>
        <span className="chat-main"><strong>Семейный чат</strong><small>{chat.title}</small></span>
        <span className="chat-action">Открыть</span>
      </button>
      :<button className="chat-row" key={chat.chatId} onClick={()=>void openDirect(chat)} disabled={openingId===chat.chatId}>
        <span className="chat-avatar" aria-hidden="true">{chat.title.slice(0,1).toUpperCase()}</span>
        <span className="chat-main"><strong>{chat.title}</strong><small>Личный защищённый чат</small></span>
        <span className="chat-action">{openingId===chat.chatId?'Открываем…':'Открыть'}</span>
      </button>)}</div>
  </section>;
}
