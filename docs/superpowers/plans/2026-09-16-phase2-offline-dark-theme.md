# Phase 2 Offline Queue and Dark Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable offline text sending and the approved dark visual theme without weakening the current end-to-end encryption or breaking Phase 1 onboarding, approval, realtime sync, and reload persistence.

**Architecture:** The client becomes local-first for outgoing text: it encrypts first, stores the encrypted envelope in IndexedDB `outbox`, renders it immediately, and flushes queued envelopes in FIFO order when connectivity is usable. The server treats `messageId` as an idempotency key and returns the original canonical envelope for exact replays while rejecting conflicting reuse. Theme selection is device-local (`system` / `light` / `dark`) and applied through CSS variables before the main UI paints.

**Tech Stack:** React 19.3, TypeScript, Vite/Vitest, IndexedDB via `idb`, `fake-indexeddb`, Fastify 5, PostgreSQL, libsodium-based existing crypto, Render deployment.

**Spec:** `docs/superpowers/specs/2026-09-16-phase2-offline-dark-theme-design.md`

## Global Constraints

- Keep plaintext out of the outbox; queued records contain only encrypted envelopes plus routing/status metadata.
- Preserve the existing E2E message envelope schema and current chat key handling.
- Server sequence remains authoritative for confirmed messages.
- `navigator.onLine` is only a hint; transport success/failure decides whether flush can continue.
- Never run two outbox flush loops concurrently in one app instance.
- FIFO per chat; remove an outbox item only after the canonical server envelope is stored locally.
- Duplicate POST of the same `messageId` and identical encrypted metadata returns the original canonical envelope.
- Conflicting reuse of `messageId` returns HTTP 409.
- Phase 2 statuses are exactly `Ожидает сети`, `Отправляется...`, `Отправлено`; no `Доставлено` receipt in this phase.
- Theme modes are exactly `system`, `light`, `dark`; default is `system`.
- QR remains on a light card in dark mode.
- No media, voice, video, link previews, push notifications, or backup in Phase 2.

---

### Task 1: IndexedDB v2 and durable encrypted outbox

**Files:**
- Modify: `apps/web/src/local/db.ts`
- Create: `apps/web/src/local/outbox.ts`
- Create: `apps/web/src/local/outbox.test.ts`

**Interfaces:**
- Consumes: `EncryptedMessageEnvelope` from `@family-messenger/protocol`, existing `getDb()`.
- Produces:
  - `type OutboxEntry = { messageId:string; chatId:string; senderDeviceId:string; envelope:EncryptedMessageEnvelope; createdAt:string; state:'queued'|'sending'; attemptCount:number; lastAttemptAt?:string }`
  - `enqueueOutbox(entry: OutboxEntry): Promise<void>`
  - `listOutbox(chatId: string): Promise<OutboxEntry[]>`
  - `markOutboxSending(messageId: string, at: string): Promise<void>`
  - `markOutboxQueued(messageId: string): Promise<void>`
  - `removeOutbox(messageId: string): Promise<void>`

- [ ] **Step 1: Write failing migration/outbox tests**

Create `apps/web/src/local/outbox.test.ts` using `fake-indexeddb/auto` and Vitest. Cover:

```ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearLocalData, getDb, resetDbHandleForTests } from './db.js';
import { enqueueOutbox, listOutbox } from './outbox.js';

beforeEach(async () => {
  indexedDB.deleteDatabase('family-messenger');
  resetDbHandleForTests();
});

describe('outbox', () => {
  it('creates the outbox store in database version 2', async () => {
    const db = await getDb();
    expect(db.objectStoreNames.contains('outbox')).toBe(true);
  });

  it('persists encrypted envelopes without plaintext fields', async () => {
    await enqueueOutbox({
      messageId: '11111111-1111-4111-8111-111111111111',
      chatId: '22222222-2222-4222-8222-222222222222',
      senderDeviceId: '33333333-3333-4333-8333-333333333333',
      envelope: {
        messageId: '11111111-1111-4111-8111-111111111111',
        chatId: '22222222-2222-4222-8222-222222222222',
        senderDeviceId: '33333333-3333-4333-8333-333333333333',
        keyVersion: 1,
        nonce: 'bm9uY2U=',
        ciphertext: 'Y2lwaGVydGV4dA=='
      },
      createdAt: '2026-09-16T10:00:00.000Z',
      state: 'queued',
      attemptCount: 0
    });
    const [stored] = await listOutbox('22222222-2222-4222-8222-222222222222');
    expect(stored?.envelope.ciphertext).toBe('Y2lwaGVydGV4dA==');
    expect(JSON.stringify(stored)).not.toContain('secret plaintext');
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm run test -w apps/web -- --run src/local/outbox.test.ts
```

Expected: FAIL because `outbox` store/module does not exist.

- [ ] **Step 3: Upgrade IndexedDB and implement outbox helpers**

Change `getDb()` to open version `2`. In `upgrade(db, oldVersion)` create existing stores only when `oldVersion < 1`, and create `outbox` only when `oldVersion < 2`, so upgrades preserve Phase 1 data.

Add to `FamilyDb`:

```ts
outbox:{
  key:string;
  value:OutboxEntry;
  indexes:{chatId:string;createdAt:string};
};
```

`outbox.ts` should sort `listOutbox()` by `createdAt`, then `messageId`, and update `attemptCount` when marking `sending`.

Update `clearLocalData()` to include `outbox`.

- [ ] **Step 4: Run test and typecheck GREEN**

```bash
npm run test -w apps/web -- --run src/local/outbox.test.ts
npm run typecheck -w apps/web
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/local/db.ts apps/web/src/local/outbox.ts apps/web/src/local/outbox.test.ts
git commit -m "feat: add durable encrypted outbox"
```

---

### Task 2: Server idempotency with conflict detection

**Files:**
- Create: `apps/server/src/messages/idempotency.ts`
- Create: `apps/server/src/messages/idempotency.test.ts`
- Modify: `apps/server/src/messages/repository.ts`
- Modify: `apps/server/src/messages/routes.ts`

**Interfaces:**
- Produces:
  - `sameEnvelope(a: EncryptedMessageEnvelope, b: EncryptedMessageEnvelope): boolean`
  - `insertMessageEnvelope(...): Promise<{kind:'inserted'|'replayed';stored:StoredMessageEnvelope}|{kind:'conflict'}>`

- [ ] **Step 1: Write failing pure idempotency tests**

```ts
import { describe, expect, it } from 'vitest';
import { sameEnvelope } from './idempotency.js';

const base = {
  messageId:'11111111-1111-4111-8111-111111111111',
  chatId:'22222222-2222-4222-8222-222222222222',
  senderDeviceId:'33333333-3333-4333-8333-333333333333',
  keyVersion:1,
  nonce:'bm9uY2U=',
  ciphertext:'Y2lwaGVydGV4dA=='
};

it('accepts exact encrypted replay', () => expect(sameEnvelope(base, {...base})).toBe(true));
it('rejects conflicting ciphertext reuse', () => expect(sameEnvelope(base, {...base,ciphertext:'ZGlmZmVyZW50'})).toBe(false));
it('rejects conflicting routing reuse', () => expect(sameEnvelope(base, {...base,chatId:'44444444-4444-4444-8444-444444444444'})).toBe(false));
```

- [ ] **Step 2: Run RED**

```bash
npm run test -w apps/server -- --run src/messages/idempotency.test.ts
```

Expected: FAIL because helper does not exist.

- [ ] **Step 3: Implement repository replay/conflict semantics**

`sameEnvelope()` compares all six immutable envelope fields: `messageId`, `chatId`, `senderDeviceId`, `keyVersion`, `nonce`, `ciphertext`.

In `repository.ts`, when `message_id` exists, select the full stored envelope plus `sequence` and `accepted_at`. Return `kind:'replayed'` only when `sameEnvelope(existing, envelope)` is true; otherwise return `kind:'conflict'`.

On an INSERT race where `ON CONFLICT DO NOTHING` wins elsewhere, reload the full row and apply the same comparison before returning.

In `routes.ts`:

```ts
if (result.kind === 'conflict') {
  await tx.query('ROLLBACK');
  return reply.code(409).send({error:'message_id_conflict'});
}
```

Publish realtime only for `kind:'inserted'`; exact replays return HTTP 200 with the existing canonical envelope.

- [ ] **Step 4: Run GREEN and typecheck**

```bash
npm run test -w apps/server -- --run src/messages/idempotency.test.ts
npm run typecheck -w apps/server
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/messages/idempotency.ts apps/server/src/messages/idempotency.test.ts apps/server/src/messages/repository.ts apps/server/src/messages/routes.ts
git commit -m "feat: make message delivery idempotent"
```

---

### Task 3: Local-first send and serialized outbox flush

**Files:**
- Modify: `apps/web/src/flows/messages.ts`
- Create: `apps/web/src/flows/messages.test.ts`

**Interfaces:**
- `VisibleMessage` becomes:

```ts
export type SendState='queued'|'sending'|'sent';
export type VisibleMessage={
  messageId:string;
  text:string;
  sentAt:string;
  senderDeviceId:string;
  sequence?:string;
  sendState:SendState;
};
```

- Produces:
  - `sendTextMessage(text:string,pin:string): Promise<VisibleMessage>` — persists queue before network.
  - `flushOutbox(chatId:string,pin:string): Promise<void>` — serialized FIFO worker.
  - `readLocalVisibleMessages(chatId:string,pin:string): Promise<VisibleMessage[]>` — merges confirmed messages plus queued items without duplicate bubbles.

- [ ] **Step 1: Write failing offline and flush tests**

Use `fake-indexeddb/auto` and `vi.stubGlobal('fetch', ...)`.

Required cases:

```ts
it('keeps an encrypted queued message when fetch throws', async () => { /* fetch throws TypeError; outbox length remains 1 */ });
it('flushes two queued messages in FIFO order', async () => { /* assert fetch body messageIds in enqueue order */ });
it('removes an outbox item only after canonical ack is stored', async () => { /* outbox 0, messages 1 */ });
it('does not run two flush loops concurrently', async () => { /* call flushOutbox twice; max concurrent POSTs === 1 */ });
it('merges queued and confirmed messages without duplicate messageId', async () => { /* one bubble after ack */ });
```

- [ ] **Step 2: Run RED**

```bash
npm run test -w apps/web -- --run src/flows/messages.test.ts
```

Expected: FAIL because current `sendTextMessage()` POSTs before local persistence and no flush worker exists.

- [ ] **Step 3: Implement local-first send**

In `sendTextMessage()`:

1. load active profile + current key;
2. generate `messageId` and payload timestamp;
3. encrypt once;
4. `enqueueOutbox(...state:'queued')`;
5. call `flushOutbox()` only when `navigator.onLine !== false`;
6. return local visible state even if transport fails.

Use one module-level promise guard:

```ts
let flushPromise:Promise<void>|null=null;
export function flushOutbox(chatId:string,pin:string){
  if(flushPromise)return flushPromise;
  flushPromise=flushOutboxInner(chatId,pin).finally(()=>{flushPromise=null;});
  return flushPromise;
}
```

For network `TypeError`, put current entry back to `queued` and stop. For HTTP application errors, also return it to `queued` but rethrow so the UI can show a meaningful error.

- [ ] **Step 4: Implement merged local rendering**

Decrypt confirmed `messages` normally. Decrypt each outbox envelope with the current chat key, derive `sentAt` from its encrypted payload, map state to `queued`/`sending`, and merge by timestamp; when a `messageId` exists in confirmed messages, omit the outbox copy.

- [ ] **Step 5: Run GREEN**

```bash
npm run test -w apps/web -- --run src/flows/messages.test.ts
npm run typecheck -w apps/web
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/flows/messages.ts apps/web/src/flows/messages.test.ts
git commit -m "feat: send text through offline outbox"
```

---

### Task 4: Connectivity triggers and chat status UX

**Files:**
- Modify: `apps/web/src/realtime/socket.ts`
- Modify: `apps/web/src/screens/FamilyChatScreen.tsx`
- Modify: `apps/web/src/components/ConnectionBadge.tsx`
- Modify: `apps/web/src/components/MessageBubble.tsx`
- Create: `apps/web/src/components/MessageBubble.test.tsx`

**Interfaces:**
- Extend `connectRealtime()` input with optional `onOnline?:()=>Promise<void>|void` and call it after successful reconcile/open.
- `MessageBubble` renders own-message status labels from `message.sendState`.

- [ ] **Step 1: Write failing status rendering test**

Use `react-dom/server` to avoid adding another test dependency:

```ts
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { MessageBubble } from './MessageBubble.js';

it('shows queued state for own message',()=>{
  const html=renderToStaticMarkup(<MessageBubble mine message={{messageId:'1',text:'test',sentAt:'2026-09-16T10:00:00.000Z',senderDeviceId:'dev',sendState:'queued'}}/>);
  expect(html).toContain('Ожидает сети');
});
```

- [ ] **Step 2: Run RED**

```bash
npm run test -w apps/web -- --run src/components/MessageBubble.test.tsx
```

Expected: FAIL because status labels are absent.

- [ ] **Step 3: Wire automatic flush triggers**

In `FamilyChatScreen`, after PIN unlock:

- initial `readLocalVisibleMessages()`;
- call `flushOutbox()` once on startup, then refresh visible messages;
- add `window.addEventListener('online', ...)` that sets `connecting`, flushes, reconciles, refreshes local view;
- add `offline` listener that sets `offline` immediately;
- pass `onOnline` to realtime so WebSocket recovery also flushes;
- after `sendTextMessage()`, refresh local visible messages immediately rather than restoring draft on transport failure.

When offline, render banner text exactly:

`Нет связи — сообщения сохраняются на устройстве`

When reconnecting with queued items, show:

`Соединение восстановлено — отправляем сообщения…`

- [ ] **Step 4: Render send states**

In `MessageBubble` for `mine===true`:

```ts
const status = message.sendState==='queued'
  ? 'Ожидает сети'
  : message.sendState==='sending'
    ? 'Отправляется...'
    : 'Отправлено';
```

Keep status text visible; icons may be decorative only.

- [ ] **Step 5: Run GREEN and full web tests**

```bash
npm run test -w apps/web -- --run src/components/MessageBubble.test.tsx
npm run test -w apps/web -- --run
npm run typecheck -w apps/web
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/realtime/socket.ts apps/web/src/screens/FamilyChatScreen.tsx apps/web/src/components/ConnectionBadge.tsx apps/web/src/components/MessageBubble.tsx apps/web/src/components/MessageBubble.test.tsx
git commit -m "feat: show offline and send states"
```

---

### Task 5: Theme persistence and pre-paint theme application

**Files:**
- Create: `apps/web/src/local/theme.ts`
- Create: `apps/web/src/local/theme.test.ts`
- Create: `apps/web/src/components/ThemeControl.tsx`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Produces:

```ts
export type ThemePreference='system'|'light'|'dark';
export function loadThemePreference():ThemePreference;
export function saveThemePreference(value:ThemePreference):void;
export function applyTheme(value:ThemePreference):()=>void;
```

- `applyTheme()` sets `document.documentElement.dataset.theme` to resolved `light` or `dark`. In `system`, subscribe to `(prefers-color-scheme: dark)` and return an unsubscribe function.

- [ ] **Step 1: Write failing theme tests**

Cover:

```ts
it('defaults to system');
it('persists dark preference in localStorage');
it('resolves system to dark when media query matches');
it('updates resolved theme when media query changes');
```

Stub `window.matchMedia` with an object supporting `addEventListener`/`removeEventListener`.

- [ ] **Step 2: Run RED**

```bash
npm run test -w apps/web -- --run src/local/theme.test.ts
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement theme module and control**

`ThemeControl` presents three accessible options: `Системная`, `Светлая`, `Тёмная`. Saving immediately reapplies the theme.

In `main.tsx`, call `applyTheme(loadThemePreference())` before `createRoot(...)` to minimize a bright flash.

Mount `ThemeControl` in the authenticated app shell and also make it available on unauthenticated center-card screens via a small top-right fixed control so every approved screen can switch theme.

- [ ] **Step 4: Run GREEN**

```bash
npm run test -w apps/web -- --run src/local/theme.test.ts
npm run typecheck -w apps/web
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/local/theme.ts apps/web/src/local/theme.test.ts apps/web/src/components/ThemeControl.tsx apps/web/src/main.tsx apps/web/src/App.tsx
git commit -m "feat: add persistent theme modes"
```

---

### Task 6: Approved dark visual system across all screens

**Files:**
- Modify: `apps/web/src/styles/app.css`
- Modify: `apps/web/src/screens/AdminScreen.tsx`
- Modify: `apps/web/src/screens/PendingApprovalScreen.tsx`
- Modify only if needed for semantic class hooks: `apps/web/src/screens/WelcomeScreen.tsx`, `CreateFamilyScreen.tsx`, `JoinFamilyScreen.tsx`

**Interfaces:**
- CSS variables define all theme colors. Components consume semantic classes, not hard-coded dark colors.

- [ ] **Step 1: Add explicit theme tokens**

Define light tokens on `:root,[data-theme='light']` and dark tokens on `[data-theme='dark']`. Use the approved direction:

```css
:root,[data-theme='light']{
  --bg:#f4f8f7;--surface:#ffffff;--surface-2:#f0f4f3;--text:#263532;
  --muted:#71817e;--border:#dfe9e6;--accent:#357f70;--accent-strong:#14b8b0;
  --mine:#dff1eb;--incoming:#f0f4f3;--danger-bg:#f5e9e9;--danger:#854141;
}
[data-theme='dark']{
  --bg:#08131c;--surface:#0f1c26;--surface-2:#162530;--text:#f1f6f8;
  --muted:#95a9b7;--border:#263946;--accent:#0ea5a7;--accent-strong:#18c6c8;
  --mine:#0b4c50;--incoming:#24323d;--danger-bg:#3a1d25;--danger:#ff9aa9;
}
```

Replace current literal UI colors with these variables. Preserve visible focus rings.

- [ ] **Step 2: Match the six approved states**

Ensure CSS and semantic wrappers support:

1. online main chat;
2. QR invitation with white/light `.qr-box` card even in dark mode;
3. pending-device card with approve/reject styling hooks (do not add rejection behavior in this phase if backend does not support it; only current approve behavior remains functional);
4. confirmed-device/admin state;
5. offline warning plus queued statuses;
6. reconnect success banner and sending statuses.

Do not invent delivery receipts.

- [ ] **Step 3: Build and inspect responsive output**

```bash
npm run build -w apps/web
```

Expected: Vite build succeeds. Inspect desktop ~1440px and mobile ~390px widths in browser. Confirm QR stays high-contrast and scannable.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/styles/app.css apps/web/src/screens/AdminScreen.tsx apps/web/src/screens/PendingApprovalScreen.tsx apps/web/src/screens/WelcomeScreen.tsx apps/web/src/screens/CreateFamilyScreen.tsx apps/web/src/screens/JoinFamilyScreen.tsx
git commit -m "feat: implement approved dark interface"
```

---

### Task 7: Regression suite, production build, and Render verification

**Files:**
- Modify: `README.md` with Phase 2 test procedure and theme/offline notes.
- No application behavior changes unless a failing test exposes a defect; fix such defects in the owning task's files and rerun the relevant tests.

**Interfaces:**
- Final deliverable is branch `feat/phase2-offline-dark-theme` ready for Render deployment and two-client verification.

- [ ] **Step 1: Run full automated verification**

```bash
npm run typecheck
npm test -- --run
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 2: Verify existing Phase 1 behavior locally or on branch deployment**

Check:

- existing family/profile still opens after IndexedDB v1->v2 upgrade;
- QR join works;
- pending device approval works;
- online text exchange works in two independent sessions;
- reload preserves confirmed history.

- [ ] **Step 3: Verify offline scenario exactly**

Using browser devtools Network -> Offline on client A:

1. send `offline-1`;
2. send `offline-2`;
3. both show `Ожидает сети` immediately;
4. reload client A while still offline; unlock with PIN; both remain visible;
5. restore network;
6. both transition through `Отправляется...` to `Отправлено` in original order;
7. client B receives each exactly once;
8. reload both clients and confirm consistent history.

- [ ] **Step 4: Verify theme scenario**

On each of System / Light / Dark:

- reload and confirm preference persistence;
- in System mode, switch OS/browser color-scheme emulation and confirm live update;
- check welcome, create/join, pending approval, main chat, admin/QR, offline/reconnect states;
- verify QR remains on a light panel.

- [ ] **Step 5: Update README with the verified flow**

Add a `Phase 2 verification` section containing the exact offline and theme steps above and a note that `Доставлено` receipts are not yet implemented.

- [ ] **Step 6: Final verification after README-only change**

```bash
npm run typecheck
npm test -- --run
npm run build
```

Expected: all exit 0.

- [ ] **Step 7: Commit**

```bash
git add README.md
git commit -m "docs: add Phase 2 verification guide"
```

---

## Self-review result

- Spec coverage: offline durability, FIFO resend, restart survival, idempotency, conflict rejection, UI statuses, connectivity banners, theme modes, dark visuals, accessibility, and manual Render verification are each mapped to tasks above.
- Placeholder scan: no TBD/TODO/future-fill instructions are used.
- Type consistency: the plan consistently uses `EncryptedMessageEnvelope`, `StoredMessageEnvelope`, `OutboxEntry`, `SendState`, and the exact `system|light|dark` preference values.
- Scope guard: media, push, link previews, delivery receipts, and backup are intentionally excluded from this plan.
