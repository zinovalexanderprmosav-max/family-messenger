# Phase 3C2 Removal, Revocation, and Key Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Immediately cut off revoked devices and removed members, preserve legitimate message history, and restore future confidentiality by rotating each affected chat key entirely on a trusted client.

**Architecture:** Keep revocation/removal authorization and database mutations in focused family service/repository modules, then disconnect sockets only after commit through a device-aware realtime hub. Persist read-only chat state and deduplicated pending key rotations in PostgreSQL. A trusted web client generates the next conversation key, seals it once per exact active recipient device set, and submits envelopes atomically; the server never receives plaintext keys.

**Tech Stack:** TypeScript, Fastify 5, PostgreSQL 16, React 19 PWA, libsodium sealed boxes, Vitest 5, npm workspaces, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-17-phase3c2-removal-revocation-design.md`

## Global Constraints

- Work only on `feat/phase3c2-removal-revocation`; do not modify or merge `main` without explicit approval.
- Preserve the Phase 3C1 checkpoint `5566903aad3eb08f8fa6a4e65ff06499d30e2687`.
- Every production behavior follows RED → verify expected failure → GREEN → full regression.
- All mutating endpoints require a valid session, active acting device, active family membership, and valid CSRF.
- Device revocation, member removal, and rotation completion are transactional and use row locks.
- Realtime disconnects occur only after the corresponding transaction commits.
- Physical member, chat-member, and historical message rows are not deleted.
- The server never generates, decrypts, logs, or stores a plaintext conversation key.
- Direct chats involving a removed member become permanently read-only.
- A writable chat with a pending rotation rejects new messages until rotation completes.
- Exact recipient-device-set validation is atomic; partial key-envelope writes are forbidden.
- Repeated revocation/removal requests are logically idempotent and do not duplicate audit events.
- Preserve all Phase 3B and 3C1 API behavior unless the approved specification explicitly tightens authorization.

## Review Focus

- Cross-family device/member identifiers must look absent (`404`) and must not reveal ownership.
- A revoked or removed actor with a stale cookie/socket must lose HTTP and realtime access immediately.
- Two simultaneous revocations/removals/rotations must yield one logical mutation and no duplicate audit/rotation records.
- A recipient-device-set change between GET and POST rotation must return `409 device_key_set_changed` with no partial writes.
- An archived direct chat must remain readable to an eligible remaining member while all future writes stay blocked.

---

### Task 1: Immediate device revocation and realtime cutoff (3C2a)

**Files:**
- Create: `.github/workflows/phase3c2-ci.yml`
- Create: `apps/server/src/families/access.ts`
- Create: `apps/server/src/devices/repository.ts`
- Create: `apps/server/src/devices/routes.ts`
- Create: `apps/server/test/device-revocation.test.ts`
- Create: `apps/server/test/realtime-device-revocation.test.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/auth/session.ts`
- Modify: `apps/server/src/realtime/hub.ts`
- Modify: `apps/server/src/realtime/routes.ts`

**Interfaces:**
- Produces: `requireActivePrincipal(request,pool): Promise<SessionPrincipal>`; `assertActiveMembership(tx, familyId, memberId): Promise<MembershipAccess>`; `revokeDevice(tx,input): Promise<{changed:boolean;targetMemberId:string}>`; `RealtimeHub.register({familyId,deviceId},socket)`; `RealtimeHub.disconnectDevice(deviceId,1008,'revoked')`.
- Produces API: `POST /v1/family/devices/:deviceId/revoke` → `204`.
- Consumes: `requireSession`, `requireCsrf`, `appendAuditEvent`, `families.primary_admin_member_id`.

- [ ] **Step 1: Add branch CI**

Copy `.github/workflows/phase3c1-ci.yml` to `.github/workflows/phase3c2-ci.yml`, rename it `Phase 3C2 CI`, and change the branch filter to `feat/phase3c2-removal-revocation`. Keep PostgreSQL 16, Node 22.16.0, typecheck, all workspace tests, and production build.

- [ ] **Step 2: Write RED HTTP revocation tests**

In `device-revocation.test.ts`, seed a primary administrator, secondary administrator, ordinary members, two devices for the self-revocation case, sessions, challenges, and a second family. Add focused tests for:

```ts
expect(await revoke(otherOwnDevice, ordinaryAuth)).toMatchObject({statusCode:204});
expect(await revoke(currentDevice, ordinaryAuth)).toMatchObject({statusCode:409});
expect(await revoke(secondaryDevice, primaryAuth)).toMatchObject({statusCode:204});
expect(await revoke(memberDevice, secondaryAuth)).toMatchObject({statusCode:204});
expect((await revoke(primaryDevice, secondaryAuth)).json()).toMatchObject({error:'device_protected'});
expect((await revoke(otherMemberDevice, ordinaryAuth)).json()).toMatchObject({error:'administrator_required'});
expect((await revoke(otherFamilyDevice, primaryAuth)).json()).toMatchObject({error:'device_not_found'});
```

Assert successful revocation sets `status='revoked'`, fills `revoked_at`, deletes every target-device session/challenge, and records exactly one `device.revoked` event. Repeat the request and assert `204` plus one audit event.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npm test -w apps/server -- --run test/device-revocation.test.ts
```

Expected: requests fail because the route does not exist; fixtures and database setup succeed.

- [ ] **Step 4: Add shared active-principal and membership guards**

Implement `requireActivePrincipal` as a narrow wrapper over `requireSession`:

```ts
export async function requireActivePrincipal(request:FastifyRequest,pool:DatabasePool){
  const principal=await requireSession(request,pool);
  if(principal.deviceStatus!=='active')
    throw Object.assign(new Error('device_not_active'),{statusCode:403});
  return principal;
}
```

In `families/access.ts`, lock/read the actor membership and return `{role,isPrimary}` only when `status='active'`; otherwise throw `authentication_required` with `401`. Use this helper inside revocation transactions so authorization is re-evaluated under lock.

- [ ] **Step 5: Implement transactional revocation and permission matrix**

In `devices/repository.ts`, lock the target device, family row, actor membership, and target membership. Return `device_not_found` before role evaluation when the device is absent or outside the family. Reject the acting device with `cannot_revoke_current_device`. Enforce the matrix from the spec. For a first revocation:

```sql
UPDATE devices SET status='revoked',revoked_at=now() WHERE id=$1;
DELETE FROM sessions WHERE device_id=$1;
DELETE FROM auth_challenges WHERE device_id=$1;
```

Return `changed:false` for an already-revoked family-scoped device. In `devices/routes.ts`, append `device.revoked` only when `changed`, commit, then call `hub.disconnectDevice(deviceId,1008,'revoked')`.

- [ ] **Step 6: Verify HTTP GREEN**

```bash
npm test -w apps/server -- --run test/device-revocation.test.ts
```

- [ ] **Step 7: Write RED realtime ownership tests**

Test `RealtimeHub` with two sockets in one family but different device ids. `disconnectDevice(deviceA)` must close only A and remove its registration; family publication must still reach B. Add route integration coverage proving a socket opened before revocation receives close code `1008` after commit.

- [ ] **Step 8: Implement device-aware realtime hub**

Replace the family-only set with registrations carrying `{familyId,deviceId,socket}`. `register` accepts both ids; `publish` filters by family; `disconnectDevice` closes and removes every matching registration. Update `/v1/ws` to require active device and active membership and register both identifiers.

- [ ] **Step 9: Verify Task 1 and commit**

```bash
npm test -w apps/server -- --run test/device-revocation.test.ts test/realtime-device-revocation.test.ts
npm run typecheck
npm test
npm run build
git add .github apps/server
git commit -m "feat: revoke devices and cut off realtime access"
```

---

### Task 2: Soft-remove members and archive direct chats (3C2b)

**Files:**
- Create: `apps/server/src/members/repository.ts`
- Create: `apps/server/src/members/routes.ts`
- Create: `apps/server/test/member-removal.test.ts`
- Modify: `apps/server/src/db/migrations/001_core.sql`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/messages/routes.ts`
- Modify: `apps/server/src/direct-chats/routes.ts`
- Modify: `apps/server/src/keys/routes.ts`
- Modify: `apps/server/src/families/routes.ts`
- Modify: `apps/server/src/realtime/routes.ts`

**Interfaces:**
- Produces: `removeFamilyMember(tx,input): Promise<{changed:boolean;revokedDeviceIds:string[]}>`.
- Produces API: `POST /v1/family/members/:memberId/remove` → `204`.
- Produces schema: `chats.write_disabled_at TIMESTAMPTZ NULL`, `chats.write_disabled_reason TEXT NULL` constrained to `member_removed` when present.

- [ ] **Step 1: Write RED removal and history tests**

Cover primary removing ordinary/secondary, primary self-protection, secondary removing ordinary, secondary protection against primary/self/secondary, ordinary rejection, cross-family `member_not_found`, and repeat idempotency. Assert one transaction produces:

- target membership `status='removed'`;
- every target device revoked with sessions/challenges deleted;
- every target socket disconnected after commit;
- direct chats containing the target set to `write_disabled_reason='member_removed'`;
- one `family.member.removed` audit event;
- no deleted `members`, `chat_members`, or `message_envelopes` rows.

Assert an eligible remaining participant can GET old messages, while POST returns `409 {error:'chat_read_only'}`. Assert stale removed-member HTTP and websocket access fail.

- [ ] **Step 2: Verify RED**

```bash
npm test -w apps/server -- --run test/member-removal.test.ts
```

- [ ] **Step 3: Add idempotent direct-chat write-state migration**

Append `ALTER TABLE chats ADD COLUMN IF NOT EXISTS write_disabled_at TIMESTAMPTZ` and `write_disabled_reason TEXT`, plus an idempotent check constraint permitting `NULL` or `member_removed`. Do not delete `chat_members`.

- [ ] **Step 4: Implement locked member-removal transaction**

Lock family and target membership, then actor membership. Enforce the primary/secondary permission matrix exactly. On first removal, update membership, revoke all family-scoped target devices, delete their sessions/challenges, archive target direct chats, and append the single removal audit. Return all revoked device ids; after commit call `disconnectDevice` for each. Repeated removal returns `changed:false` without new audit events.

- [ ] **Step 5: Enforce active membership and read-only state across existing routes**

Use the shared guard in family summary, key retrieval/approval, direct-chat creation/preparation, message read/send, and websocket establishment. In message authorization, return explicit `readOnly`; check it inside the message transaction before insertion so removal cannot race past authorization. Preserve history reads for an active remaining `chat_member`.

- [ ] **Step 6: Verify Task 2 and commit**

```bash
npm test -w apps/server -- --run test/member-removal.test.ts test/direct-chat.test.ts
npm run typecheck
npm test
npm run build
git add apps/server
git commit -m "feat: soft-remove family members"
```

---

### Task 3: Persist and expose pending key rotations (3C2c)

**Files:**
- Create: `apps/server/src/key-rotations/repository.ts`
- Create: `apps/server/src/key-rotations/routes.ts`
- Create: `apps/server/test/key-rotation-required.test.ts`
- Modify: `apps/server/src/db/migrations/001_core.sql`
- Modify: `apps/server/src/devices/repository.ts`
- Modify: `apps/server/src/members/repository.ts`
- Modify: `apps/server/src/messages/routes.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `packages/protocol/src/index.ts`

**Interfaces:**
- Produces table: `chat_key_rotations(chat_id,from_key_version,status,requested_at,completed_at)` with primary key `(chat_id,from_key_version)`.
- Produces: `requireRotationsForRevokedDevices(tx,deviceIds): Promise<RotationRef[]>`.
- Produces API: `GET /v1/chats/:chatId/key-rotation` returning `{status:'not_required'}` or required metadata and exact active recipient devices.
- Produces protocol schemas/types: `KeyRotationStatusResponse`, `KeyRotationDevice`.

- [ ] **Step 1: Write RED rotation-requirement tests**

Test that revoking a device with a current envelope creates exactly one required row for each continuing writable chat; repeat revocation does not duplicate it. Test no rotation when the revoked device lacks the current envelope, when the direct chat is permanently read-only, or when no legitimate active recipient device remains. Test pending rotation blocks message send with `409 key_rotation_required`.

- [ ] **Step 2: Verify RED**

```bash
npm test -w apps/server -- --run test/key-rotation-required.test.ts
```

- [ ] **Step 3: Add rotation schema and repository selection**

Create the approved table and FK. Select each chat's maximum key version, require an envelope for a revoked target device, exclude read-only chats, and require at least one active device belonging to an active membership and chat member. Insert with `ON CONFLICT(chat_id,from_key_version) DO NOTHING`. Audit `chat.key.rotation.required` only for rows actually inserted.

- [ ] **Step 4: Integrate requirement creation into revocation/removal transactions**

Call the repository before transaction commit using the exact revoked device ids. For member removal, archive direct chats before selecting rotations so archived directs are excluded while the family chat remains eligible.

- [ ] **Step 5: Expose exact rotation preparation metadata**

GET must require an active device, active family membership, active `chat_member`, and an envelope for the acting device at `fromKeyVersion`. Return active recipient devices ordered by `device_id`, each with `{deviceId,memberId,encryptionPublicKey}`, plus `fromKeyVersion` and `nextKeyVersion=from+1`. A read-only chat returns `409 chat_read_only`; an unauthorized/unrelated chat returns `404 chat_not_found`.

- [ ] **Step 6: Make message blocking transaction-safe**

Inside the same transaction used to insert a message, lock the current key-version and required-rotation row. Return `key_rotation_required` before `insertMessageEnvelope`; otherwise keep the existing key-version mismatch behavior.

- [ ] **Step 7: Verify Task 3 and commit**

```bash
npm test -w apps/server -- --run test/key-rotation-required.test.ts test/device-revocation.test.ts test/member-removal.test.ts
npm run typecheck
npm test
npm run build
git add apps/server packages/protocol
git commit -m "feat: require chat key rotation after revocation"
```

---

### Task 4: Complete E2EE key rotation on a trusted client (3C2d)

**Files:**
- Create: `apps/server/test/key-rotation-completion.test.ts`
- Create: `apps/web/src/flows/key-rotation-core.ts`
- Create: `apps/web/src/flows/key-rotation.ts`
- Create: `apps/web/test/key-rotation-core.test.ts`
- Create: `apps/web/test/key-rotation-flow.test.ts`
- Modify: `apps/server/src/key-rotations/repository.ts`
- Modify: `apps/server/src/key-rotations/routes.ts`
- Modify: `apps/web/src/flows/messages.ts`
- Modify: `apps/web/src/realtime/socket.ts`
- Modify: `packages/protocol/src/index.ts`

**Interfaces:**
- Produces protocol schema: `CompleteKeyRotationRequest` with `fromKeyVersion`, `nextKeyVersion`, and exact `{deviceId,sealedKeyEnvelope}[]`.
- Produces API: `POST /v1/chats/:chatId/key-rotation` → `204`.
- Produces web flow: `rotateChatKey(chatId,pin): Promise<{keyVersion:number}>`.

- [ ] **Step 1: Write RED server completion tests**

Cover missing/extra/duplicate envelopes (`device_key_set_changed`), no pending rotation (`key_rotation_not_required`), stale versions (`key_rotation_stale`), actor without previous envelope (`trusted_device_required`), read-only chat (`chat_read_only`), and an active-device-set change between GET/POST. Assert every conflict leaves key-version, envelopes, and rotation state unchanged.

For success, assert exactly one next version, one sealed envelope per exact active recipient, `status='completed'`, `completed_at`, one `chat.key.rotated` audit event without envelope contents, and new message acceptance only at the new version. Run two concurrent POSTs and assert one `204`, one stable `409`, and one committed version.

- [ ] **Step 2: Verify server RED**

```bash
npm test -w apps/server -- --run test/key-rotation-completion.test.ts
```

- [ ] **Step 3: Implement atomic completion**

Lock pending rotation, chat/current key version, acting membership/device/envelope, and active recipient devices in deterministic order. Compare sorted unique ids from the request with the locked required set. Insert `nextKeyVersion`, bulk insert envelopes, mark completed, and audit in one transaction. Map uniqueness races to `key_rotation_stale` or `key_rotation_not_required`; never retry partial work.

- [ ] **Step 4: Verify server GREEN**

```bash
npm test -w apps/server -- --run test/key-rotation-completion.test.ts
```

- [ ] **Step 5: Write RED client-core and cryptographic flow tests**

`key-rotation-core.test.ts` must prove the orchestration uses one generated key, creates exactly one envelope for every returned device, posts exact versions, and saves locally only after server success. `key-rotation-flow.test.ts` must use real device identities/libsodium to open two submitted envelopes and prove both contain the same 32-byte key while the POST body contains no plaintext key field.

- [ ] **Step 6: Implement client-side rotation**

In `key-rotation-core.ts`, keep orchestration dependency-injected and deterministic for tests. In `key-rotation.ts`, GET metadata, unlock the current device profile, generate one random key, seal it for every public key, POST exact envelopes, then `saveChatKey(chatId,nextKeyVersion,key,pin)`. Do not overwrite the local key before a successful `204`.

- [ ] **Step 7: Integrate rotation recovery with messaging**

When send receives `key_rotation_required`, invoke `rotateChatKey` once and retry message encryption/send with the new local key. Do not infinite-retry `device_key_set_changed`; refetch once through the normal rotation flow and surface a stable error if the set changes again. Realtime reconcile continues to fetch ciphertext only.

- [ ] **Step 8: Full verification and final branch checkpoint**

```bash
npm test -w apps/server -- --run
npm test -w apps/web -- --run
npm test -w packages/crypto -- --run --passWithNoTests
npm test -w packages/protocol -- --run --passWithNoTests
npm run typecheck
npm run build
git status --short
```

Expected: all tests, typecheck, and production build pass; no plaintext key appears in server logs, database fixtures, audit details, or request schema.

- [ ] **Step 9: Commit and verify branch CI**

```bash
git add apps/server apps/web packages/protocol
git commit -m "feat: rotate chat keys after device revocation"
git push origin feat/phase3c2-removal-revocation
```

Confirm the latest `Phase 3C2 CI` workflow completes successfully. Do not merge to `main`; report the branch SHA and request explicit merge approval.
