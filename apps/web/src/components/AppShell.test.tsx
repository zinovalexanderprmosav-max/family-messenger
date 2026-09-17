import { renderToStaticMarkup } from 'react-dom/server';
import { describe,expect,it } from 'vitest';
import { AppShell } from './AppShell.js';

const noop=()=>{};

describe('Phase 3 authenticated app shell',()=>{
  it('shows the four approved navigation destinations',()=>{
    const html=renderToStaticMarkup(<AppShell active="chats" onSelect={noop}><div>content</div></AppShell>);
    expect(html).toContain('Чаты');
    expect(html).toContain('Контакты');
    expect(html).toContain('Профиль');
    expect(html).toContain('Устройства');
  });

  it('marks the active destination without numbering navigation buttons',()=>{
    const html=renderToStaticMarkup(<AppShell active="contacts" onSelect={noop}><div>content</div></AppShell>);
    expect(html).toContain('aria-current="page"');
    expect(html).not.toMatch(/>\s*[1-4][.)]\s*(Чаты|Контакты|Профиль|Устройства)/);
  });
});
