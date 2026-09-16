// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';

const css=readFileSync(new URL('./app.css',import.meta.url),'utf8');

describe('approved Phase 2 visual system',()=>{
  it('defines a dedicated dark theme palette',()=>{
    expect(css).toContain("[data-theme='dark']");
    expect(css).toContain('--bg:#08131c');
    expect(css).toContain('--surface:#0f1c26');
    expect(css).toContain('--accent-strong:#18c6c8');
  });

  it('keeps QR invitations on a light scanning surface',()=>{
    expect(css).toMatch(/\.qr-box\{[^}]*background:#fff/);
  });

  it('styles offline, reconnect and outgoing send states',()=>{
    expect(css).toContain('.offline-notice');
    expect(css).toContain('.reconnect-notice');
    expect(css).toContain('.status-queued');
    expect(css).toContain('.status-sending');
    expect(css).toContain('.status-sent');
  });
});
