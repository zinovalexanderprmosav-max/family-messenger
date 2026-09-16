# Family Messenger — Phase 2 design

Date: 2026-09-16
Branch: `feat/phase2-offline-dark-theme`

## Goal

Make the current Phase 1 messenger resilient to temporary loss of network connectivity and introduce the approved dark visual theme without changing the current end-to-end encryption model.

## Scope

Phase 2 includes:

- durable offline sending for text messages;
- local encrypted outbox persisted in IndexedDB;
- automatic ordered resend after connectivity returns;
- server-side idempotency for repeated delivery of the same `messageId`;
- visible connection state and message-send state;
- dark theme matching the approved visual mockups;
- theme modes: System / Light / Dark;
- persistence of the selected theme on the device.

Phase 2 does not yet add media attachments, voice messages, video, link previews, push notifications, or cloud backup. Those remain later phases.

## User experience

### Main chat — online

The normal chat remains the primary view. When network access is available, the header shows `В сети`. Outgoing text messages are encrypted on the client, persisted locally first, sent to the server, and then shown as confirmed.

### No connection

When the browser loses connectivity, the header and chat show a compact warning:

`Нет связи — сообщения сохраняются на устройстве`

The composer remains usable. Sending while offline does not show an error. The message appears immediately in the conversation with status:

`Ожидает сети`

### Outbox

Unsent encrypted envelopes are stored locally. The outbox survives page reload, browser restart, and PWA restart.

The queue is FIFO per chat. Each entry contains only ciphertext plus routing metadata required for delivery. Plaintext is never written to the outbox.

### Connectivity restored

When the browser reports that connectivity has returned, or when the app starts while there are queued items, the client flushes the outbox in order.

UI progression:

`Ожидает сети` -> `Отправляется...` -> `Отправлено`

If sending fails again because the network is still unavailable, the item returns to `Ожидает сети` and remains durable.

### Device restart / browser reload

On reload, the client restores:

- existing encrypted message envelopes;
- sync cursor;
- encrypted outbox;
- theme preference.

After the user unlocks the local key store with the PIN, queued message text can be rendered locally from its encrypted envelope and the queue can resume.

## IndexedDB design

Upgrade the database from version 1 to version 2.

Existing stores stay intact:

- `keystore`
- `profile`
- `messages`
- `sync`

Add store:

`outbox`

Suggested record:

```ts
type OutboxEntry = {
  messageId: string;
  chatId: string;
  senderDeviceId: string;
  envelope: NewMessageEnvelope;
  createdAt: string;
  state: 'queued' | 'sending';
  attemptCount: number;
  lastAttemptAt?: string;
};
```

Primary key: `messageId`.

Index: `chatId`.

Queue ordering uses `createdAt` with `messageId` as deterministic tiebreaker.

## Sending flow

Current Phase 1 behavior sends to the API first. Phase 2 changes this order:

1. Validate active local profile.
2. Unlock/load current chat key.
3. Create `messageId` locally.
4. Encrypt the message payload into a `NewMessageEnvelope`.
5. Persist the encrypted envelope to `outbox` as `queued`.
6. Show the message immediately in the UI.
7. Attempt delivery if the client is online.
8. On server acknowledgement, persist the canonical `StoredMessageEnvelope` in `messages`.
9. Remove the matching `outbox` item.
10. Reconcile the normal server cursor.

The local write is therefore the durability boundary, not the network request.

## Outbox flush behavior

A single flush worker runs per browser tab/app instance.

Triggers:

- application startup after profile/key unlock;
- browser `online` event;
- successful WebSocket reconnect;
- manual send while already online and queue non-empty.

Rules:

- never run two flush loops concurrently;
- send one queued item at a time to preserve user-visible order;
- stop on network transport failure;
- continue past a successful idempotent replay response;
- do not delete an outbox entry until a canonical server envelope is received and stored locally.

## Server idempotency

The server already treats `messageId` as the client-generated identity. Phase 2 formalizes idempotent POST behavior.

For `POST /v1/chats/:chatId/messages`:

- if `messageId` does not exist, insert it and assign the next server sequence;
- if the same `messageId` already exists for the same chat and sender device, return the existing canonical stored envelope;
- if the same `messageId` is reused with conflicting chat/sender/ciphertext metadata, reject the request as a conflict.

This prevents duplicate messages after ambiguous network failures where the server committed the message but the client did not receive the response.

## Reconciliation

Server sequence remains authoritative for confirmed messages.

Queued local messages have no server sequence yet. The UI merges:

- confirmed local `messages` ordered by server sequence;
- queued local outbox items ordered by local creation time.

When a queued item becomes confirmed, the outbox representation disappears and the canonical message entry takes its place without duplicating the bubble.

## Connectivity model

`navigator.onLine` is only a hint, not proof of server reachability.

The UI may display offline immediately when the browser says offline. When browser state says online, actual delivery success determines whether the queue can flush.

A failed fetch caused by a network transport error leaves the message queued. Authentication, authorization, validation, or crypto-related HTTP errors are not silently retried as connectivity failures; they surface as an actionable error state.

## Message status model

Phase 2 user-visible statuses for own messages:

- `Ожидает сети` — safely stored locally, not yet confirmed by server;
- `Отправляется...` — an outbox flush is currently attempting delivery;
- `Отправлено` — server returned the canonical stored envelope.

`Доставлено` to another device is reserved for a later delivery-receipt phase and is not claimed in Phase 2.

## Dark theme

The approved dark mode is the primary visual direction.

Visual principles:

- background: deep graphite/navy, not pure black;
- surfaces/cards: slightly lighter graphite;
- borders: low-contrast cool gray;
- outgoing bubbles: muted teal/green-blue;
- incoming bubbles: dark neutral gray;
- primary actions: brighter teal;
- online states: green/teal;
- offline warning: restrained dark red/rose rather than a saturated alarm red;
- text: high-contrast off-white;
- secondary text: cool gray;
- QR area always uses a light/white panel for reliable scanning.

The final UI follows the approved screens:

1. Main chat — online.
2. QR invitation.
3. Pending-device approval.
4. Device confirmed / family member list.
5. Offline chat with queued messages.
6. Connectivity-restored state with automatic resend.

## Theme modes

Three settings:

- `system`
- `light`
- `dark`

Default for new installations: `system`.

Theme preference is stored locally on the device and applied before the main React UI renders where practical to avoid a bright flash on startup.

`system` follows `prefers-color-scheme` dynamically.

## Accessibility

- Maintain readable text contrast in both themes.
- Connection state is represented by text as well as color.
- Send-state icons never carry meaning alone; labels remain available.
- Focus rings remain visible in dark mode.
- QR card contrast is preserved.

## Files expected to change

Client:

- `apps/web/src/local/db.ts`
- new `apps/web/src/local/outbox.ts`
- `apps/web/src/flows/messages.ts`
- chat screen/components that render connection/send state
- app startup/realtime wiring for queue flushing
- styles/theme tokens
- new local theme preference module or equivalent

Server:

- message repository/route for idempotent `messageId` handling
- tests for duplicate POST behavior and conflict behavior

## Testing requirements

### Client automated tests

- IndexedDB v1 -> v2 migration preserves existing data and creates `outbox`.
- Sending while API is unreachable creates a durable queued envelope.
- Plaintext is not present in the outbox record.
- Reloading the local DB preserves the queue.
- Flush sends FIFO order.
- Successful acknowledgement stores the canonical message and deletes outbox entry.
- Network failure during flush leaves the item queued.
- Two flush triggers do not produce parallel duplicate send loops.
- Theme preference persists.
- System theme reacts to media-query changes.

### Server automated tests

- First POST inserts and returns canonical sequence.
- Repeating identical `messageId` returns the same stored envelope without adding a second row.
- Conflicting reuse of `messageId` returns conflict.

### Manual Render verification

Use two independent browser sessions as in Phase 1:

1. Confirm normal online messaging still works.
2. Set one browser offline using browser devtools/network or disconnect network.
3. Send two text messages.
4. Confirm both appear immediately as `Ожидает сети`.
5. Reload/close and reopen the offline client.
6. Confirm queued messages remain visible after unlock.
7. Restore network.
8. Confirm the two messages are automatically delivered in the original order.
9. Confirm the second client receives each message exactly once.
10. Reload both clients and confirm history remains consistent.
11. Switch System / Light / Dark and confirm persistence after reload.

## Deployment

Implementation is developed on `feat/phase2-offline-dark-theme`.

After automated and manual verification, deploy the branch to Render, repeat the two-client test, and only then merge Phase 2 into `main`.

## Acceptance criteria

Phase 2 is accepted when:

- text messages can be composed and safely queued without network access;
- queued messages survive browser/PWA restart;
- messages automatically resend when connectivity returns;
- repeated delivery attempts cannot create duplicate server messages;
- confirmed conversation history remains correct after reload;
- the approved dark UI is implemented across the six defined screens;
- System / Light / Dark modes work and persist;
- existing Phase 1 QR onboarding, device approval, E2E encryption, and realtime chat continue to work.
