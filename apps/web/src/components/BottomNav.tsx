import type { AppSection } from './AppShell.js';

const items:Array<{id:AppSection;label:string}>=[
  {id:'chats',label:'Чаты'},
  {id:'contacts',label:'Контакты'},
  {id:'profile',label:'Профиль'},
  {id:'devices',label:'Устройства'}
];

export function BottomNav({active,onSelect}:{active:AppSection;onSelect:(section:AppSection)=>void}){
  return <nav className="bottom-nav" aria-label="Основная навигация">
    {items.map(item=><button
      key={item.id}
      type="button"
      className={`bottom-nav-button${active===item.id?' active':''}`}
      aria-current={active===item.id?'page':undefined}
      onClick={()=>onSelect(item.id)}
    >{item.label}</button>)}
  </nav>;
}
