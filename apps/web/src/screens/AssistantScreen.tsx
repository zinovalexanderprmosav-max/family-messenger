import {useEffect,useMemo,useState} from 'react';
import {api} from '../api/client.js';

type ProviderMode='auto'|'ollama'|'openrouter';
type AssistantStatus={
  providers:{
    ollama:{configured:boolean;model:string};
    openrouter:{configured:boolean;model:string};
  };
};
type UiMessage={role:'user'|'assistant';content:string;provider?:string;model?:string};
type AssistantResponse={provider:'ollama'|'openrouter';model:string;content:string};

const QUICK_PROMPTS=[
  'Составь семейный список покупок на неделю',
  'Помоги спланировать выходные',
  'Составь список дел по дому',
  'Придумай быстрое семейное меню на сегодня'
];

function errorText(error:unknown){
  if(!(error instanceof Error))return 'Не удалось получить ответ.';
  if(error.message==='assistant_not_configured')return 'ИИ пока не подключён. Настройте Ollama или OpenRouter на сервере.';
  if(error.message==='ollama_not_configured')return 'Локальный Ollama пока не настроен.';
  if(error.message==='ollama_unavailable')return 'Локальный Ollama сейчас недоступен.';
  if(error.message==='openrouter_not_configured')return 'OpenRouter пока не настроен.';
  if(error.message==='openrouter_auth_failed')return 'Ключ OpenRouter не принят.';
  if(error.message==='openrouter_rate_limited')return 'Бесплатный лимит OpenRouter временно исчерпан.';
  return error.message;
}

export function AssistantScreen(){
  const [status,setStatus]=useState<AssistantStatus|null>(null);
  const [provider,setProvider]=useState<ProviderMode>('auto');
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

  const providerLabel=useMemo(()=>{
    if(provider==='ollama')return 'Локальный Ollama';
    if(provider==='openrouter')return 'OpenRouter Free';
    return 'Авто';
  },[provider]);

  async function ask(text:string){
    const normalized=text.trim();
    if(!normalized||busy)return;
    const next:UiMessage[]=[...messages,{role:'user',content:normalized}];
    setMessages(next);setDraft('');setBusy(true);setError('');
    try{
      const response=await api<AssistantResponse>('/v1/assistant/chat',{
        method:'POST',
        body:JSON.stringify({
          provider,
          messages:next.map(message=>({role:message.role,content:message.content}))
        })
      });
      setMessages(current=>[...current,{
        role:'assistant',content:response.content,provider:response.provider,model:response.model
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
      <label className="assistant-provider">
        <span>Режим</span>
        <select value={provider} onChange={event=>setProvider(event.target.value as ProviderMode)}>
          <option value="auto">Авто</option>
          <option value="ollama">Локальный Ollama</option>
          <option value="openrouter">OpenRouter Free</option>
        </select>
      </label>
    </header>

    <div className="assistant-status">
      <span className={status?.providers.ollama.configured?'ready':''}>● Ollama {status?.providers.ollama.configured?'настроен':'не настроен'}</span>
      <span className={status?.providers.openrouter.configured?'ready':''}>● OpenRouter {status?.providers.openrouter.configured?'настроен':'не настроен'}</span>
      <strong>{providerLabel}</strong>
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
        <div>{message.content}</div>
        {message.role==='assistant'&&message.provider&&<small>{message.provider==='ollama'?'Локальный':'Облачный'} · {message.model}</small>}
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
