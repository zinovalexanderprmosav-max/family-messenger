# Family Messenger Phase 3B Encrypted Media, Links and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add clickable links, end-to-end encrypted resumable photo/video/file attachments, durable attachment retry, and an end-to-end encrypted member recovery vault so newly approved devices can restore authorized history.

**Architecture:** Message plaintext remains client-only. Attachments are transformed when requested, chunked, encrypted locally with a random content key, persisted as ciphertext in IndexedDB, and uploaded as opaque chunks through an `AttachmentStore` abstraction backed by S3-compatible storage in production. The encrypted chat message carries an encrypted attachment manifest containing file name/type/size, attachment id, content key and nonce-prefix data. Each member also has an opaque encrypted recovery vault whose plaintext contains only that member's authorized chat-key material; the recovery key is generated and held client-side and exported as a QR/code.

**Tech Stack:** React 19.3, TypeScript, Vite/Vitest, IndexedDB, Canvas/createImageBitmap, optional browser MediaRecorder/captureStream path, Fastify 5, PostgreSQL 17, libsodium XChaCha20-Poly1305, `@aws-sdk/client-s3`, S3-compatible object storage.

**Spec:** `docs/superpowers/specs/2026-09-16-family-messenger-phase3-design.md`

## Global Constraints

- Server never receives plaintext attachment bytes, original file names, MIME details from the decrypted manifest, plaintext conversation keys, plaintext recovery keys, PINs or decrypted message bodies.
- Production attachment bytes never use the Render ephemeral filesystem.
- Every attachment chunk is encrypted before it enters IndexedDB outbox or network transport.
- Attachment jobs survive reload/browser/PWA restart and resume with stable ids.
- General files are byte-for-byte unchanged before encryption.
- Photo modes are `auto`, `hd`, `original`; video modes are `normal`, `high`, `original` with explicit Original fallback when safe transcoding is unavailable.
- A failed optional link preview never blocks the text message.
- Recovery vault is per member; owner/admin never gains another member's private direct-chat keys through the server.
- If all trusted devices and recovery material are lost, old E2E history is unrecoverable; UI states this explicitly.
- Keep Phase 2/3A send statuses; do not add delivery/read receipts.

---

### Task 1: General encrypted message payload union and clickable links

**Files:**
- Modify: `packages/crypto/src/message-envelope.ts`
- Modify: `packages/crypto/src/index.ts`
- Create: `packages/crypto/src/message-envelope.test.ts`
- Modify: `apps/web/src/flows/messages.ts`
- Modify: `apps/web/src/components/MessageBubble.tsx`
- Modify: `apps/web/src/components/MessageBubble.test.tsx`
- Create: `apps/web/src/components/MessageText.tsx`
- Create: `apps/web/src/components/MessageText.test.tsx`

**Interfaces:**
- `type MessagePayload = TextMessagePayload | AttachmentMessagePayload`.
- `encryptMessage(input:{...,payload:MessagePayload})` and `decryptMessage(envelope,key)`.
- Keep backward-compatible `encryptTextMessage`/`decryptTextMessage` wrappers for existing tests/callers until all code migrates.

- [ ] **Step 1: Write failing crypto union tests**

Test text roundtrip and attachment-manifest roundtrip. Attachment payload shape:

```ts
type AttachmentMessagePayload={
  kind:'attachment';
  sentAt:string;
  caption?:string;
  attachment:{
    attachmentId:string;
    fileName:string;
    mimeType:string;
    originalSize:number;
    encryptedSize:number;
    chunkSize:number;
    chunkCount:number;
    contentKey:string;
    noncePrefix:string;
    mediaKind:'photo'|'video'|'file';
    quality:'auto'|'hd'|'normal'|'high'|'original';
    preview?:{attachmentId:string;contentKey:string;noncePrefix:string;encryptedSize:number;chunkSize:number;chunkCount:number};
  };
};
```

- [ ] **Step 2: Run RED**

```bash
npm run test -w packages/crypto -- --run src/message-envelope.test.ts
```

- [ ] **Step 3: Implement union encryption/decryption**

Use the existing message AAD unchanged so legacy text envelopes remain valid. Validate parsed payload by `kind`; reject malformed attachment manifest with `invalid_message_payload`.

- [ ] **Step 4: Add safe link rendering**

`MessageText` recognizes only `http://` and `https://` URLs, renders `<a target="_blank" rel="noopener noreferrer">`, and leaves surrounding text escaped by React. Add an optional local card containing hostname and full URL. Attempt client-side metadata enrichment only when `fetch(url,{mode:'cors'})` succeeds and returned content is HTML; otherwise keep the deterministic hostname card.

- [ ] **Step 5: Run GREEN**

```bash
npm run test -w packages/crypto -- --run
npm run test -w apps/web -- --run src/components/MessageText.test.tsx src/components/MessageBubble.test.tsx
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/crypto/src apps/web/src/components apps/web/src/flows/messages.ts
 git commit -m "feat: support attachment payloads and safe links"
```

---

### Task 2: Attachment database schema and S3 store abstraction

**Files:**
- Create: `apps/server/src/db/migrations/003_phase3_attachments_recovery.sql`
- Modify: `apps/server/src/db/migrate.ts`
- Create: `apps/server/src/attachments/store.ts`
- Create: `apps/server/src/attachments/memory-store.ts`
- Create: `apps/server/src/attachments/s3-store.ts`
- Create: `apps/server/src/attachments/store.test.ts`
- Modify: `apps/server/src/config.ts`
- Modify: `apps/server/package.json`
- Modify: `.env.example`

**Interfaces:**
- `AttachmentStore.put(key:string,bytes:Uint8Array):Promise<void>`
- `AttachmentStore.get(key:string):Promise<Uint8Array|null>`
- `AttachmentStore.delete(key:string):Promise<void>`
- `AttachmentStore.exists(key:string):Promise<boolean>`

- [ ] **Step 1: Write failing store contract tests**

Run the same test suite against `MemoryAttachmentStore`; verify overwrite is deterministic and missing get returns null. Add unit tests for S3 object-key construction without making a network call.

- [ ] **Step 2: Add migration**

Create:

```sql
CREATE TABLE IF NOT EXISTS attachments (
  id UUID PRIMARY KEY,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  uploader_device_id UUID NOT NULL REFERENCES devices(id),
  encrypted_size BIGINT NOT NULL CHECK(encrypted_size>=0),
  chunk_size INTEGER NOT NULL CHECK(chunk_size>0),
  chunk_count INTEGER NOT NULL CHECK(chunk_count>0),
  status TEXT NOT NULL CHECK(status IN ('uploading','complete','aborted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS attachment_chunks (
  attachment_id UUID NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK(chunk_index>=0),
  encrypted_size INTEGER NOT NULL CHECK(encrypted_size>0),
  object_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(attachment_id,chunk_index)
);
CREATE INDEX IF NOT EXISTS attachments_chat ON attachments(chat_id,created_at);
```

Also create recovery tables used later:

```sql
CREATE TABLE IF NOT EXISTS member_recovery_vaults (
  member_id UUID PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version>0),
  nonce TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 3: Implement S3 adapter**

Add `@aws-sdk/client-s3`. Config fields are exact environment names:

```text
S3_ENDPOINT
S3_REGION
S3_BUCKET
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
S3_FORCE_PATH_STYLE
```

Production startup fails clearly if required S3 settings are absent once attachment routes are enabled; test mode injects `MemoryAttachmentStore`.

- [ ] **Step 4: Run GREEN**

```bash
npm run test -w apps/server -- --run src/attachments/store.test.ts
npm run typecheck -w apps/server
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/db apps/server/src/attachments apps/server/src/config.ts apps/server/package.json .env.example
 git commit -m "feat: add durable encrypted attachment storage"
```

---

### Task 3: Resumable opaque attachment upload/download API

**Files:**
- Create: `apps/server/src/attachments/repository.ts`
- Create: `apps/server/src/attachments/routes.ts`
- Create: `apps/server/src/attachments/routes.test.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `packages/protocol/src/index.ts`

**Interfaces:**
- `POST /v1/chats/:chatId/attachments` JSON `{attachmentId,encryptedSize,chunkSize,chunkCount}`.
- `GET /v1/attachments/:attachmentId/status` -> `{status,receivedChunks:number[]}`.
- `PUT /v1/attachments/:attachmentId/chunks/:chunkIndex` body `application/octet-stream`.
- `POST /v1/attachments/:attachmentId/complete`.
- `GET /v1/attachments/:attachmentId/chunks/:chunkIndex` returns ciphertext bytes.
- `DELETE /v1/attachments/:attachmentId` cancels uploader-owned incomplete upload.

- [ ] **Step 1: Write failing route tests using MemoryAttachmentStore**

Cover chat authorization, stable id replay, out-of-range chunk, duplicate identical chunk accepted, conflicting duplicate rejected, status resume list, complete rejected while chunks missing, non-chat-member download denied.

- [ ] **Step 2: Run RED**

```bash
npm run test -w apps/server -- --run src/attachments/routes.test.ts
```

- [ ] **Step 3: Implement routes**

Object key format is server-derived only:

```text
families/{familyId}/attachments/{attachmentId}/{chunkIndex}
```

Never accept an object key from the client. Limit encrypted chunk size to 4 MiB and `chunkCount` to 4096. Track encrypted byte totals; quota checks compare encrypted totals only.

- [ ] **Step 4: Run GREEN**

```bash
npm run test -w apps/server -- --run src/attachments/routes.test.ts
npm run typecheck -w apps/server
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/attachments apps/server/src/app.ts packages/protocol/src/index.ts
 git commit -m "feat: add resumable encrypted attachment API"
```

---

### Task 4: Client attachment crypto and IndexedDB ciphertext job queue

**Files:**
- Create: `packages/crypto/src/attachment-crypto.ts`
- Modify: `packages/crypto/src/index.ts`
- Create: `packages/crypto/src/attachment-crypto.test.ts`
- Modify: `apps/web/src/local/db.ts`
- Create: `apps/web/src/local/attachment-jobs.ts`
- Create: `apps/web/src/local/attachment-jobs.test.ts`
- Create: `apps/web/src/api/raw.ts`

**Interfaces:**
- `generateAttachmentKey():Promise<Uint8Array>`.
- `generateNoncePrefix():Promise<Uint8Array>` returns 16 random bytes.
- `attachmentChunkNonce(prefix16,index)` returns 24 bytes `prefix16 || uint64be(index)`.
- `encryptAttachmentChunk/decryptAttachmentChunk` use XChaCha20-Poly1305 with AAD `fm:attachment:v1|attachmentId|chunkIndex`.
- IndexedDB v3 store `attachmentJobs` keyed by attachmentId; store contains ciphertext chunks as `ArrayBuffer[]`, never original bytes.

- [ ] **Step 1: Write crypto tests**

Verify per-index nonce uniqueness, chunk roundtrip, wrong attachment id/index fails authentication, and serialized queue does not contain the original marker text for a small test file.

- [ ] **Step 2: Run RED**

```bash
npm run test -w packages/crypto -- --run src/attachment-crypto.test.ts
npm run test -w apps/web -- --run src/local/attachment-jobs.test.ts
```

- [ ] **Step 3: Implement crypto and IndexedDB v3**

Queue type includes `attachmentId,chatId,messageId,encryptedSize,chunkSize,chunkCount,chunks,state,receivedChunks,createdAt,manifestPayload` where `manifestPayload` is the already prepared attachment metadata needed to construct the encrypted chat message; no plaintext binary bytes are retained.

- [ ] **Step 4: Implement raw API helper**

`rawApi(path,options)` adds same-origin credentials and CSRF for writes but does not force JSON content type. It returns `Response` after translating non-2xx JSON errors consistently with `api()`.

- [ ] **Step 5: Run GREEN**

```bash
npm run test -w packages/crypto -- --run
npm run test -w apps/web -- --run src/local/attachment-jobs.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/crypto/src apps/web/src/local apps/web/src/api/raw.ts
 git commit -m "feat: queue encrypted attachment chunks locally"
```

---

### Task 5: Photo processing modes and encrypted previews

**Files:**
- Create: `apps/web/src/media/photos.ts`
- Create: `apps/web/src/media/photos.test.ts`
- Create: `apps/web/src/media/prepare-attachment.ts`
- Create: `apps/web/src/media/prepare-attachment.test.ts`

**Interfaces:**
- `preparePhoto(file,quality)` returns `{bytes,mimeType,width,height}`.
- `auto`: max dimension 1600, JPEG quality 0.82.
- `hd`: max dimension 2560, JPEG quality 0.90.
- `original`: exact `file.arrayBuffer()` bytes and original MIME.
- preview: max dimension 480, JPEG quality 0.72.

- [ ] **Step 1: Write tests with injectable image codec adapter**

Avoid flaky browser image decoding in unit tests by injecting `{decode,encode}` adapter. Assert scale math preserves aspect ratio and Original never calls encoder.

- [ ] **Step 2: Implement browser adapter**

Use `createImageBitmap`, canvas/offscreen canvas when available, and `canvas.toBlob`. Preserve orientation through decoded bitmap; if decode fails, surface `photo_format_unsupported` and offer Original.

- [ ] **Step 3: Prepare/encrypt photo job**

`prepareAttachmentJob` transforms photo, creates encrypted preview and main chunks, writes only ciphertext job data to IndexedDB, then releases plaintext buffers.

- [ ] **Step 4: Run GREEN**

```bash
npm run test -w apps/web -- --run src/media/photos.test.ts src/media/prepare-attachment.test.ts
npm run typecheck -w apps/web
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/media
 git commit -m "feat: add photo quality modes and encrypted previews"
```

---

### Task 6: Video capability path and Original fallback

**Files:**
- Create: `apps/web/src/media/video.ts`
- Create: `apps/web/src/media/video.test.ts`
- Modify: `apps/web/src/media/prepare-attachment.ts`

**Interfaces:**
- `getVideoQualityCapabilities()` -> `{normal:boolean,high:boolean,original:true}`.
- Safe transform path requires `HTMLCanvasElement.captureStream`, `MediaRecorder`, playable source video, and a supported output MIME selected with `MediaRecorder.isTypeSupported`.
- If any prerequisite is missing, only `original` is enabled; UI must say `Сжатие видео недоступно на этом устройстве — отправим оригинал`.

- [ ] **Step 1: Write capability/fallback tests**

Stub missing `MediaRecorder` and assert Normal/High false. Stub supported recorder/captureStream and assert they become available. Verify Original always returns exact bytes.

- [ ] **Step 2: Implement bounded transcode path**

Normal target: max 720p, target bitrate 2.5 Mbps. High target: max 1080p, target bitrate 5 Mbps. Use realtime canvas/video capture only when the required APIs work; cancellable operation; never silently downgrade quality. If runtime transcode fails, return a typed error that UI converts to explicit Original choice.

- [ ] **Step 3: Run GREEN**

```bash
npm run test -w apps/web -- --run src/media/video.test.ts
npm run typecheck -w apps/web
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/media/video* apps/web/src/media/prepare-attachment.ts
 git commit -m "feat: add video quality capability and fallback"
```

---

### Task 7: Attachment upload worker, encrypted message ack and download

**Files:**
- Create: `apps/web/src/flows/attachments.ts`
- Create: `apps/web/src/flows/attachments.test.ts`
- Modify: `apps/web/src/flows/messages.ts`
- Modify: `apps/web/src/realtime/socket.ts`
- Create: `apps/web/src/media/download-attachment.ts`
- Create: `apps/web/src/media/download-attachment.test.ts`

**Interfaces:**
- `queueAttachment(chatId,file,options,pin)` creates ciphertext job and visible pending message.
- `flushAttachmentJobs(chatId,pin,onProgress?)` resumes from server status and uploads only missing chunks.
- After upload complete, encrypt and enqueue the attachment manifest as a normal chat message with stable `messageId`; remove attachment ciphertext job only after canonical message ack.
- `downloadAttachment(manifest)` fetches encrypted chunks, decrypts locally and returns `Blob`.

- [ ] **Step 1: Write failing flow tests**

Cover offline queue, resume from chunks `[0,2]`, upload only missing `[1,3]`, reload persistence, canonical message id replay, job removal only after message ack, and decryption download roundtrip.

- [ ] **Step 2: Run RED**

```bash
npm run test -w apps/web -- --run src/flows/attachments.test.ts src/media/download-attachment.test.ts
```

- [ ] **Step 3: Implement serialized per-attachment workers**

Use a `Map<attachmentId,Promise<void>>`. Browser `online` and WebSocket reconnect trigger both text and attachment flush. Cancellation marks local job cancelled and calls server DELETE for incomplete remote upload when online.

- [ ] **Step 4: Run GREEN**

```bash
npm run test -w apps/web -- --run src/flows/attachments.test.ts src/media/download-attachment.test.ts
npm run typecheck -w apps/web
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/flows apps/web/src/media apps/web/src/realtime/socket.ts
 git commit -m "feat: resume encrypted attachments across reconnects"
```

---

### Task 8: Media/file composer and message UI

**Files:**
- Create: `apps/web/src/components/AttachmentPicker.tsx`
- Create: `apps/web/src/components/AttachmentPicker.test.tsx`
- Create: `apps/web/src/components/AttachmentBubble.tsx`
- Create: `apps/web/src/components/AttachmentBubble.test.tsx`
- Modify: `apps/web/src/screens/ChatScreen.tsx`
- Modify: `apps/web/src/components/MessageBubble.tsx`
- Modify: `apps/web/src/styles/app.css`

**Interfaces:**
- `+` menu: `Фото или видео`, `Документ`, `Любой файл`, `Поделиться ссылкой`.
- Photo quality selector `Авто`, `HD`, `Оригинал`.
- Video selector only enables supported modes and always `Оригинал`.
- Upload UI shows progress, `Отмена`, `Повторить`; completed attachment supports preview/open/save locally.

- [ ] **Step 1: Write render/interaction tests**

Assert exact Russian labels, disabled unsupported video modes, file input accept patterns, progress/cancel state, and no server plaintext metadata in mocked request body.

- [ ] **Step 2: Implement UI**

Use hidden `<input type=file>` with camera/gallery compatible `accept="image/*,video/*"` for media and unrestricted file input for general files. Do not request persistent camera permission just to select existing media.

- [ ] **Step 3: Run GREEN plus visual CSS regression**

```bash
npm run test -w apps/web -- --run src/components/AttachmentPicker.test.tsx src/components/AttachmentBubble.test.tsx src/styles/app.test.ts
npm run build -w apps/web
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components apps/web/src/screens/ChatScreen.tsx apps/web/src/styles/app.css
 git commit -m "feat: add encrypted media and file chat UI"
```

---

### Task 9: Per-member encrypted recovery vault crypto and API

**Files:**
- Create: `packages/crypto/src/recovery-vault.ts`
- Modify: `packages/crypto/src/index.ts`
- Create: `packages/crypto/src/recovery-vault.test.ts`
- Modify: `packages/crypto/src/pin-keystore.ts`
- Create: `apps/server/src/recovery/repository.ts`
- Create: `apps/server/src/recovery/routes.ts`
- Create: `apps/server/src/recovery/routes.test.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `packages/protocol/src/index.ts`

**Interfaces:**
- `generateRecoveryKey():Promise<Uint8Array>` 32 random bytes.
- Vault plaintext `{memberId,version,chatKeys:Record<chatId,{keyVersion,key}>}`.
- `encryptRecoveryVault(vault,recoveryKey)` -> `{version,nonce,ciphertext}` using AAD `family-messenger:recovery:v1|memberId|version`.
- `PUT /v1/recovery-vault` stores opaque `{version,nonce,ciphertext}` for current member only with monotonic version.
- `GET /v1/recovery-vault` returns current member's opaque vault only.

- [ ] **Step 1: Write crypto tests**

Roundtrip, wrong recovery key fails, ciphertext does not contain serialized chat key marker, and version is AAD-bound.

- [ ] **Step 2: Write server tests**

Member A cannot fetch/write member B vault; stale version returns 409; server stores bytes without inspecting plaintext.

- [ ] **Step 3: Implement crypto/API and extend PIN keystore**

Extend `PlainKeystore` with optional:

```ts
recovery?:{key:string;vaultVersion:number};
```

Old encrypted keystores without this property remain valid.

- [ ] **Step 4: Run GREEN**

```bash
npm run test -w packages/crypto -- --run src/recovery-vault.test.ts
npm run test -w apps/server -- --run src/recovery/routes.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/crypto/src packages/protocol/src/index.ts apps/server/src/recovery apps/server/src/app.ts
 git commit -m "feat: add end to end encrypted recovery vault"
```

---

### Task 10: Recovery setup, QR export, automatic vault refresh and new-device restore

**Files:**
- Create: `apps/web/src/flows/recovery.ts`
- Create: `apps/web/src/flows/recovery.test.ts`
- Create: `apps/web/src/screens/RecoveryScreen.tsx`
- Create: `apps/web/src/screens/RecoveryRestoreScreen.tsx`
- Modify: `apps/web/src/screens/ProfileScreen.tsx`
- Modify: `apps/web/src/screens/PendingApprovalScreen.tsx`
- Modify: `apps/web/src/flows/chats.ts`
- Modify: `apps/web/src/flows/key-rotation.ts`
- Modify: `apps/web/src/local/keystore.ts`

**Interfaces:**
- Recovery export URI contains only client recovery material: `fm-recovery:v1:<base64url-key>`; never uploaded/logged.
- `setupRecovery(pin)` creates recovery key, uploads first opaque vault, stores recovery key PIN-encrypted.
- `refreshRecoveryVault(pin)` runs after new chat key or rotation.
- `restoreRecovery(code,pin)` downloads current member vault, decrypts locally, merges authorized chat keys into local keystore.

- [ ] **Step 1: Write failing flow tests**

Assert uploaded JSON lacks plaintext chat keys/recovery key, QR value is not sent to server, restore merges keys but never overwrites a higher local key version with an older vault version.

- [ ] **Step 2: Implement setup and warning UI**

Before dismissing first setup, show: `Если потерять все подтверждённые устройства и код восстановления, старую зашифрованную историю восстановить будет невозможно.` Require explicit checkbox acknowledgment before hiding the setup prompt.

- [ ] **Step 3: Integrate newly approved device restore**

After device approval and family current key is obtained, offer `Восстановить историю` with QR/code input. Device remains usable for new messages without recovery, but old direct histories with missing keys remain locked until restored.

- [ ] **Step 4: Run GREEN**

```bash
npm run test -w apps/web -- --run src/flows/recovery.test.ts
npm run test -w apps/web -- --run
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/flows apps/web/src/screens apps/web/src/local/keystore.ts
 git commit -m "feat: restore encrypted history with recovery QR"
```

---

### Task 11: Storage quota/status and Phase 3B CI

**Files:**
- Create: `apps/server/src/attachments/quota.ts`
- Create: `apps/server/src/attachments/quota.test.ts`
- Modify: `apps/server/src/attachments/routes.ts`
- Modify: `apps/web/src/screens/ProfileScreen.tsx`
- Modify: `.github/workflows/phase3-ci.yml`
- Modify: `README.md`

**Interfaces:**
- `GET /v1/storage` -> `{usedEncryptedBytes,limitEncryptedBytes}`.
- Default family encrypted-byte limit from `ATTACHMENT_QUOTA_BYTES`, validated positive integer; explicit production configuration documented.

- [ ] **Step 1: Write quota tests**

Reject initialization that would exceed limit with `413 storage_quota_exceeded`; completed and uploading attachments count; aborted uploads do not.

- [ ] **Step 2: Implement quota/status UI**

Show human-readable encrypted storage use in Profile/Storage. Do not claim plaintext/original-size accounting.

- [ ] **Step 3: Expand CI**

Keep PostgreSQL service from Phase 3A. Add crypto media/recovery tests and web attachment tests. S3 adapter unit tests must not need external credentials; integration uses `MemoryAttachmentStore`.

- [ ] **Step 4: Full verification**

```bash
npm run test -w packages/protocol -- --run --passWithNoTests
npm run test -w packages/crypto -- --run
npm run test -w apps/server -- --run
npm run test -w apps/web -- --run
npm run typecheck
npm run build
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/attachments apps/web/src/screens/ProfileScreen.tsx .github/workflows/phase3-ci.yml README.md
 git commit -m "ci: verify encrypted media and recovery"
```

## Phase 3B Exit Gate

Phase 3B is complete only when text links are safe/clickable; photo/video/file attachments are encrypted before local persistence/network; resume/retry survives restart; production storage is S3-compatible; recovery vault is opaque to server and restorable with client-held recovery material; and all Phase 3A/Phase 2 regression suites remain green.