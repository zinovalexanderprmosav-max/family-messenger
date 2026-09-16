import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MessageBubble } from './MessageBubble.js';

const base={messageId:'11111111-1111-4111-8111-111111111111',text:'Тест',sentAt:'2026-09-16T10:00:00.000Z',senderDeviceId:'device'};

describe('MessageBubble send state',()=>{
  it('shows waiting status for an own queued message',()=>{
    const html=renderToStaticMarkup(<MessageBubble mine message={{...base,sendState:'queued'}}/>);
    expect(html).toContain('Ожидает сети');
  });

  it('shows sending and sent states for own messages',()=>{
    expect(renderToStaticMarkup(<MessageBubble mine message={{...base,sendState:'sending'}}/>)).toContain('Отправляется...');
    expect(renderToStaticMarkup(<MessageBubble mine message={{...base,sendState:'sent',sequence:'1'}}/>)).toContain('Отправлено');
  });

  it('does not show an outgoing send state on incoming messages',()=>{
    const html=renderToStaticMarkup(<MessageBubble mine={false} message={{...base,sendState:'sent',sequence:'1'}}/>);
    expect(html).not.toContain('Отправлено');
  });
});
