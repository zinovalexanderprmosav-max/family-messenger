import { useEffect,useState } from 'react';
import { api } from '../api/client.js';

export type ContactItem={memberId:string;displayName:string;role:'owner'|'admin'|'member'};

const roleLabel=(role:ContactItem['role'])=>role==='owner'?'Главный администратор':role==='admin'?'Администратор':'Участник';

export function ContactsScreen({onOpen}:{onOpen:(contact:ContactItem)=>Promise<void>}){
  const [items,setItems]=useState<ContactItem[]>([]);
  const [loading,setLoading]=useState(true);
  const [openingId,setOpeningId]=useState<string|null>(null);
  const [error,setError]=useState('');

  useEffect(()=>{
    let disposed=false;
    void api<{items:ContactItem[]}>('/v1/contacts').then(response=>{
      if(!disposed)setItems(response.items);
    }).catch(reason=>{
      if(!disposed)setError(reason instanceof Error?reason.message:'Не удалось загрузить контакты');
    }).finally(()=>{
      if(!disposed)setLoading(false);
    });
    return()=>{disposed=true;};
  },[]);

  async function open(contact:ContactItem){
    setOpeningId(contact.memberId);setError('');
    try{await onOpen(contact);}catch(reason){setError(reason instanceof Error?reason.message:'Не удалось открыть чат');}
    finally{setOpeningId(null);}
  }

  return <section className="panel section-screen">
    <h2>Контакты</h2>
    <p className="hint">Все активные члены семьи доступны для личного защищённого чата.</p>
    {loading&&<p className="hint">Загрузка контактов…</p>}
    {error&&<p className="error" role="alert">{error}</p>}
    {!loading&&items.length===0&&!error&&<p className="hint">Других участников пока нет.</p>}
    <div className="contact-list">{items.map(contact=><button className="contact-row" key={contact.memberId} onClick={()=>void open(contact)} disabled={openingId===contact.memberId}>
      <span className="contact-avatar" aria-hidden="true">{contact.displayName.slice(0,1).toUpperCase()}</span>
      <span className="contact-main"><strong>{contact.displayName}</strong><small>{roleLabel(contact.role)}</small></span>
      <span className="contact-action">{openingId===contact.memberId?'Открываем…':'Написать'}</span>
    </button>)}</div>
  </section>;
}
