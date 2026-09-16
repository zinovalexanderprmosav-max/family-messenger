# Family Messenger — Phase 2

Private family messenger PWA with client-side end-to-end encryption, durable offline text sending, realtime synchronization, QR onboarding, device approval, and System / Light / Dark themes.

## Implemented

- PWA for iPhone, Android and desktop browsers.
- Family bootstrap with first administrator.
- Single-use QR invitations; the token stays in the URL fragment and is removed from the address bar after consumption.
- Device identity using X25519-compatible encryption keys and Ed25519 signing keys.
- PIN-protected local keystore using Argon2id + XChaCha20-Poly1305.
- Pending-device approval by an administrator; the server receives only a sealed conversation-key envelope.
- End-to-end encrypted text messages using XChaCha20-Poly1305.
- PostgreSQL persistence of ciphertext and routing metadata only.
- Cookie session + CSRF protection.
- WebSocket reconcile signal plus canonical HTTP synchronization.
- Durable encrypted IndexedDB outbox.
- Local-first text sending: encrypt -> persist locally -> attempt delivery.
- FIFO resend after connectivity returns.
- Outbox survives reload/browser/PWA restart.
- Server-side `messageId` idempotency: exact replay returns the original canonical message; conflicting reuse returns HTTP 409.
- Visible states: `Ожидает сети`, `Отправляется...`, `Отправлено`.
- Offline banner: `Нет связи — сообщения сохраняются на устройстве`.
- Automatic resend on browser `online` event and WebSocket reconnect.
- System / Light / Dark theme preference, persisted per device.
- Approved graphite/teal dark interface across onboarding, chat, admin, QR, pending approval, offline and reconnect states.
- QR invitation remains on a white scanning surface in dark mode.
- PWA shell v2 pre-caches the currently built hashed JS/CSS assets and removes obsolete Family Messenger shell caches.

`Доставлено` receipts, media attachments, voice/video, link previews, push notifications and cloud backup are intentionally not part of Phase 2.

## Verification status

Phase 2 is continuously verified by `.github/workflows/phase2-ci.yml` on branch `feat/phase2-offline-dark-theme` with Node.js 22.16.0.

The CI pipeline runs:

```bash
npm install --no-audit --no-fund
npm run test -w apps/web -- --run
npm run test -w apps/server -- --run --passWithNoTests
npm run test -w packages/crypto -- --run --passWithNoTests
npm run test -w packages/protocol -- --run --passWithNoTests
npm run typecheck
npm run build
```

## Local development

Requirements:

- Node.js 22.12 or newer.
- npm 10 or newer.
- Docker Desktop / Docker Engine with Compose for local PostgreSQL.

From the project root:

```bash
npm install
npm run dev:db
npm run typecheck
npm test -- --run
npm run build
```

Run the development processes in separate terminals:

```bash
npm run dev -w apps/server
```

```bash
npm run dev -w apps/web -- --host 0.0.0.0
```

Open `http://localhost:5173`.

## Phase 2 verification

Use two independent browser sessions (for example Chrome plus Edge InPrivate) so each has its own cookies, IndexedDB and device keys.

### Online regression

1. Create a family on client A.
2. Create a QR invitation.
3. Open the invitation link on client B and join with a separate device/PIN.
4. Approve client B from client A after checking its fingerprint.
5. Exchange text messages in both directions.
6. Reload both clients and confirm the encrypted history remains readable after unlock.

### Offline queue

1. On client A use browser DevTools Network -> Offline, or disconnect its network.
2. Send `offline-1` and `offline-2`.
3. Both messages must appear immediately as `Ожидает сети`.
4. The chat must show `Нет связи — сообщения сохраняются на устройстве`.
5. Reload/close and reopen client A while still offline, then unlock it with the PIN.
6. Both queued messages must still be visible.
7. Restore network connectivity.
8. The queue must automatically progress through `Отправляется...` to `Отправлено` in the original order.
9. Client B must receive each message exactly once.
10. Reload both clients and confirm one canonical copy of each message remains.

### Themes

1. Select `Системная`, `Светлая` and `Тёмная` in turn.
2. Reload after each explicit selection and confirm it persists.
3. In `Системная`, change browser/OS color-scheme emulation and confirm the interface follows it.
4. Check welcome/create/join, pending approval, main chat, family management, QR invitation, offline banner and reconnect state.
5. Confirm the QR code always remains on a light/white panel.

### PWA offline shell

1. Open the deployed Phase 2 application online once and allow the service worker to install.
2. Put the browser offline.
3. Reload/open the PWA again.
4. The application shell must load from cache and locally stored encrypted/queued messages must remain available after PIN unlock.

## Development database

The development Compose definition uses PostgreSQL 17 on `localhost:5432`:

- database: `family`
- user: `family`
- password: `family-dev-only`

These credentials are development-only.

## Branches

- Stable public Phase 1: `main` until Phase 2 manual acceptance.
- Phase 2 implementation/preview: `feat/phase2-offline-dark-theme`.

Do not merge Phase 2 into `main` until the separate Render preview has passed the two-client online/offline/theme verification above.

## Deployment

The repository Dockerfile builds the web client and runs the Fastify server behind Caddy on Render. Production requires:

- `NODE_ENV=production`
- `DATABASE_URL=<Render Internal Database URL>`

The PostgreSQL port must not be exposed publicly.

An Oracle single-VM path is also retained under `infra/oracle/README.md` for later self-hosting.
