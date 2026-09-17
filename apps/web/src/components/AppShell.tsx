import type { ReactNode } from 'react';
import { BottomNav } from './BottomNav.js';

export type AppSection='chats'|'contacts'|'profile'|'devices';

export function AppShell({active,onSelect,children}:{active:AppSection;onSelect:(section:AppSection)=>void;children:ReactNode}){
  return <div className="app-shell">
    <main className="app-main">{children}</main>
    <BottomNav active={active} onSelect={onSelect}/>
  </div>;
}
