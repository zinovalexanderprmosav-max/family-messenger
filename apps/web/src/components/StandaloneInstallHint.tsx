import {useEffect,useState} from 'react';

function isIos(){
  if(typeof navigator==='undefined')return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}
function isStandalone(){
  if(typeof window==='undefined')return false;
  const nav=navigator as Navigator & {standalone?:boolean};
  return Boolean(nav.standalone)||window.matchMedia?.('(display-mode: standalone)').matches===true;
}

export function StandaloneInstallHint(){
  const [show,setShow]=useState(false);
  useEffect(()=>{
    setShow(isIos()&&!isStandalone());
    const media=window.matchMedia?.('(display-mode: standalone)');
    const onChange=()=>setShow(isIos()&&!isStandalone());
    media?.addEventListener?.('change',onChange);
    return()=>media?.removeEventListener?.('change',onChange);
  },[]);
  if(!show)return null;
  return <aside className="install-hint" role="status">
    <div>
      <strong>Полноэкранный режим</strong>
      <span>Safari → Поделиться → На экран «Домой» → открыть Family Messenger с новой иконки.</span>
    </div>
    <button type="button" aria-label="Скрыть подсказку" onClick={()=>setShow(false)}>×</button>
  </aside>;
}
