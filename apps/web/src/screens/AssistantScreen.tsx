import {useEffect,useState} from 'react';
import {api} from '../api/client.js';

type AssistantStatus={
  providers:{
    openrouter:{configured:boolean;model:string};
  };
};
type UiMessage={role:'user'|'assistant';content:string;model?:string};
type AssistantResponse={provider:'openrouter';model:string;content:string};

function formatInline(text:string){
  return text.split(/(\\*\\*[^*]+\\*\\*)/g).filter(Boolean).map((part,index)=>
    part.startsWith('**')&&part.endsWith('**')
      ? <strong key={index}>{part.slice(2,-2)}</strong>
      : <span key={index}>{part}</span>
  );
}

function AssistantContent({content}:{content:string}){
  return <div className="assistant-markdown">{content.split('\\n').map((raw,index)=>{
    const line=raw.trimEnd();
    if(!line.trim())return <div className="assistant-md-spacer" key={index}/>;
    if(line.startsWith('### '))return <h4 key={index}>{formatInline(line.slice(4))}</h4>;
    if(line.startsWith('## '))return <h3 key={index}>{formatInline(line.slice(3))}</h3>;
    if(line.startsWith('# '))return <h3 key={index}>{formatInline(line.slice(2))}</h3>;
    if(/^[-*] /.test(line))return <div className="assistant-md-list" key={index}><span>•</span><div>{formatInline(line.slice(2))}</div></div>;
    const numbered=line.match(/^(\d+)[.)]\s+(.*)$/);
    if(numbered)return <div className="assistant-md-list" key={index}><span>{numbered[1]}.</span><div>{formatInline(numbered[2]??'')}</div></div>;
    return <p key={index}>{formatInline(line)}</p>;
  })}</div>;
}

const QUICK_PROMPTS=[
  'Составь семейный список покупок на неделю',
  'Помоги спланировать выходные',
  'Составь список дел по дому',
  'Придумай быстрое семейное меню на сегодня'
];

function errorText(error:unknown){
  if(!(error instanceof Error))return 'Не удалось получить ответ.';
  if(error.message==='openrouter_not_configured')return 'Семейный помощник пока не подключён.';
  if(error.message==='openrouter_auth_failed')return 'Ключ помощника не принят сервером.';
  if(error.message==='openrouter_rate_limited')return 'Бесплатный лимит помощника временно исчерпан.';
  if(error.message==='openrouter_unavailable')return 'Семейный помощник временно недоступен.';
  return error.message;
}

export function AssistantScreen(){
  const [status,setStatus]=useState<AssistantStatus|null>(null);
  const [messages,setMessages]=useState<UiMessage[]>([]);
  const [draft,setDraft]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  useEffect(()=>{
    let cancelled=false;
    void api<AssistantStatus>('/v1/assistant/status')
      .then(value=>{if(!cancelled)setStatus(value);})
      .catch(err=>{if(!cancelled)setError(errorText(err));});
    return()=>{cancelled=true;};
  },[]);

  async function ask(text:string){
    const normalized=text.trim();
    if(!normalized||busy)return;
    const next:UiMessage[]=[...messages,{role:'user',content:normalized}];
    setMessages(next);setDraft('');setBusy(true);setError('');
    try{
      const response=await api<AssistantResponse>('/v1/assistant/chat',{
        method:'POST',
        body:JSON.stringify({
          messages:next.map(message=>({role:message.role,content:message.content}))
        })
      });
      setMessages(current=>[...current,{
        role:'assistant',content:response.content,model:response.model
      }]);
    }catch(err){setError(errorText(err));}
    finally{setBusy(false);}
  }

  return <section className="assistant-screen">
    <header className="assistant-header">
      <div className="assistant-title">
        <div className="assistant-orb">AI</div>
        <div>
          <span className="eyebrow">Семейный помощник</span>
          <h2>Помощник</h2>
          <p>Получает только то, что вы сами отправляете ему в этот раздел.</p>
        </div>
      </div>
    </header>

    <div className="assistant-status">
      <span className={status?.providers.openrouter.configured?'ready':''}>
        ● ИИ {status?.providers.openrouter.configured?'подключён':'не подключён'}
      </span>
      <strong>OpenRouter Free</strong>
    </div>

    <div className="assistant-thread">
      {messages.length===0&&<div className="assistant-empty">
        <div className="assistant-orb large">AI</div>
        <h3>Чем помочь семье?</h3>
        <p>Списки покупок, планы, идеи, тексты, бытовые вопросы и другое.</p>
        <div className="assistant-quick-prompts">
          {QUICK_PROMPTS.map(prompt=><button type="button" key={prompt} onClick={()=>void ask(prompt)}>{prompt}</button>)}
        </div>
      </div>}
      {messages.map((message,index)=><article key={index} className={'assistant-message '+message.role}>
        {message.role==='assistant'?<AssistantContent content={message.content}/>:<div>{message.content}</div>}
        {message.role==='assistant'&&message.model&&<small>ИИ · {message.model}</small>}
      </article>)}
      {busy&&<article className="assistant-message assistant thinking"><span className="assistant-thinking">● ● ●</span></article>}
    </div>

    {error&&<div className="assistant-error">{error}</div>}

    <form className="assistant-composer" onSubmit={event=>{event.preventDefault();void ask(draft);}}>
      <textarea value={draft} onChange={event=>setDraft(event.target.value)} rows={1} placeholder="Спросить семейного помощника…" disabled={busy}/>
      <button className="send" aria-label="Отправить помощнику" disabled={busy||!draft.trim()}>➤</button>
    </form>
  </section>;
}
