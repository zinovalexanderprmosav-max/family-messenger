import {useEffect,useState} from 'react';

type About={service:string;version:string;serverTime:string};

export function BuildInfo(){
  const [about,setAbout]=useState<About|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    let stopped=false;
    fetch('/v1/about',{credentials:'same-origin',cache:'no-store'})
      .then(async response=>{
        if(!response.ok)throw new Error(`http_${response.status}`);
        return response.json() as Promise<About>;
      })
      .then(value=>{if(!stopped){setAbout(value);setError('');}})
      .catch(err=>{if(!stopped)setError(err instanceof Error?err.message:'offline');});
    return()=>{stopped=true;};
  },[]);
  return <aside className="build-info" aria-label="Информация о сборке">
    <strong>Family Messenger {about?.version??'0.4.1'}</strong>
    <span>{location.host||'локальный запуск'}</span>
    {about?<span>Сервер отвечает · {new Date(about.serverTime).toLocaleString()}</span>:<span>{error?'Сервер недоступен':'Проверяем сервер…'}</span>}
  </aside>;
}
