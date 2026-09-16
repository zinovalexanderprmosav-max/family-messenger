# Family Messenger Phase 3A Identity, Chats and Devices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approved `owner | admin | member` permission model, automatic contacts, unique one-to-one chats, up to three devices per member, device linking/management, and cryptographic key rotation after device/member revocation without regressing Phase 2 text/offline behavior.

**Architecture:** The server remains authoritative for membership, role, device status, chat membership, direct-chat uniqueness and rotation state. Clients still own all plaintext and conversation keys. A revoked device immediately loses sessions/API access; every affected chat enters a server-side `rotation_required` state that blocks new messages until an active chat participant generates a fresh conversation key and uploads sealed envelopes for all remaining active devices. The web client becomes a multi-chat shell with Chats, Contacts, Profile and Devices while reusing the existing encrypted outbox and message synchronization.

**Tech Stack:** React 19.3, TypeScript, Vite/Vitest, IndexedDB via `idb`, Fastify 5, PostgreSQL 17, libsodium, WebSocket reconcile events, GitHub Actions, Render.

**Spec:** `docs/superpowers/specs/2026-09-16-family-messenger-phase3-design.md`

## Global Constraints

- Exactly one active `owner` per family and at most one active secondary `admin`.
- Owner cannot be removed/demoted by another user and owner devices cannot be managed by secondary admin.
- Each member has at most 3 `active` or `pending_key` devices.
- Ordinary members can manage only their own devices; secondary admin can manage self and ordinary members; owner can manage all devices.
- The final active owner device cannot be revoked unless another active owner device exists.
- Server never receives plaintext messages, private keys, conversation keys, PINs or decrypted history.
- Direct chat is unique per unordered pair of active members in one family.
- Revoked/removed users are denied API/WebSocket access immediately.
- After revocation/removal, affected chats block new sends until a fresh key version is distributed to remaining active devices.
- Preserve Phase 2 text states exactly: `Ожидает сети`, `Отправляется...`, `Отправлено`; do not add delivery/read receipts.
- Preserve existing graphite/teal System/Light/Dark theme and white QR scan surfaces.
- TDD: every behavior change starts with a failing test and each task ends with its focused test plus workspace typecheck.

---

### Task 1: Phase 3 identity/database migration

**Files:**
- Create: `apps/server/src/db/migrations/002_phase3_identity_chats_devices.sql`
- Modify: `apps/server/src/db/migrate.ts`
- Create: `apps/server/src/db/migrate.test.ts`

**Interfaces:**
- Consumes: current Phase 2 schema in `001_core.sql`.
- Produces database support for `owner`, device last-seen, direct-pair uniqueness, device-link tokens, and key-rotation requests.

- [ ] **Step 1: Write a failing migration test**

Create `migrate.test.ts` against `TEST_DATABASE_URL`. After `migrate(pool)` assert:

```ts
const roles = await pool.query(`SELECT pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conname='family_memberships_role_check'`);
expect(roles.rows[0].definition).toContain('owner');

const tables = await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('direct_chat_pairs','device_links','chat_key_rotation_requests') ORDER BY tablename`);
expect(tables.rows.map(r=>r.tablename)).toEqual(['chat_key_rotation_requests','device_links','direct_chat_pairs']);
```

Also seed a Phase 2-style family with two admins before applying 002 and verify the earliest active admin becomes `owner` and the other remains `admin`.

- [ ] **Step 2: Run RED**

```bash
TEST_DATABASE_URL=postgres://family:family-dev-only@localhost:5432/family npm run test -w apps/server -- --run src/db/migrate.test.ts
```

Expected: FAIL because migration 002 is absent and role constraint excludes `owner`.

- [ ] **Step 3: Add the migration**

`002_phase3_identity_chats_devices.sql` must be idempotent and contain these concrete changes:

```sql
ALTER TABLE family_memberships DROP CONSTRAINT IF EXISTS family_memberships_role_check;
ALTER TABLE family_memberships ADD CONSTRAINT family_memberships_role_check CHECK (role IN ('owner','admin','member'));

WITH ranked AS (
  SELECT family_id,member_id,row_number() OVER (PARTITION BY family_id ORDER BY created_at,member_id) rn
  FROM family_memberships WHERE role='admin' AND status='active'
)
UPDATE family_memberships fm SET role='owner'
FROM ranked r WHERE fm.family_id=r.family_id AND fm.member_id=r.member_id AND r.rn=1
AND NOT EXISTS (SELECT 1 FROM family_memberships x WHERE x.family_id=fm.family_id AND x.role='owner' AND x.status='active');

CREATE UNIQUE INDEX IF NOT EXISTS one_active_owner_per_family ON family_memberships(family_id) WHERE role='owner' AND status='active';
CREATE UNIQUE INDEX IF NOT EXISTS one_active_secondary_admin_per_family ON family_memberships(family_id) WHERE role='admin' AND status='active';
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS direct_chat_pairs (
  chat_id UUID PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  member_low UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  member_high UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  CHECK (member_low <> member_high),
  UNIQUE(family_id,member_low,member_high)
);

CREATE TABLE IF NOT EXISTS device_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_by_device_id UUID NOT NULL REFERENCES devices(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_key_rotation_requests (
  chat_id UUID PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
  from_key_version INTEGER NOT NULL,
  to_key_version INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('device_revoked','member_removed')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
```

Before adding `one_active_secondary_admin_per_family`, demote any active admins beyond the oldest remaining one to `member` so the migration is deterministic on legacy data.

- [ ] **Step 4: Make migration runner execute ordered files**

Change `migrate.ts` to read `001_core.sql` then `002_phase3_identity_chats_devices.sql` in that order. Keep both migrations safe to run on every server start; do not rewrite production data destructively.

- [ ] **Step 5: Run GREEN**

```bash
npm run test -w apps/server -- --run src/db/migrate.test.ts
npm run typecheck -w apps/server
```

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/db
 git commit -m "feat: add Phase 3 identity schema"
```

---

### Task 2: Server-side active membership and role authorization

**Files:**
- Create: `apps/server/src/auth/permissions.ts`
- Create: `apps/server/src/auth/permissions.test.ts`
- Modify: `apps/server/src/auth/session.ts`
- Modify: `apps/server/src/auth/device-auth.ts`
- Modify: `apps/server/src/realtime/routes.ts`
- Modify: `apps/server/src/families/repository.ts`
- Modify: `apps/server/src/families/routes.ts`
- Modify: `apps/server/src/invitations/routes.ts`
- Modify: `apps/server/src/keys/routes.ts`

**Interfaces:**
- Produces `type FamilyRole='owner'|'admin'|'member'`.
- Produces `requireOwner(principal)`, `requireAdministrator(principal)`, `assertCanManageMember(...)`, `assertCanManageDevice(...)`.
- Extends `SessionPrincipal` with `role` and active membership semantics.

- [ ] **Step 1: Write failing permission matrix tests**

Test the pure permission helpers with the exact matrix:

```ts
expect(canManageMember({actorRole:'owner',actorMemberId:'o',targetRole:'admin',targetMemberId:'a'})).toBe(true);
expect(canManageMember({actorRole:'admin',actorMemberId:'a',targetRole:'owner',targetMemberId:'o'})).toBe(false);
expect(canManageMember({actorRole:'admin',actorMemberId:'a',targetRole:'member',targetMemberId:'m'})).toBe(true);
expect(canManageMember({actorRole:'member',actorMemberId:'m1',targetRole:'member',targetMemberId:'m2'})).toBe(false);
expect(canManageDevice({actorRole:'member',actorMemberId:'m',targetRole:'member',targetMemberId:'m'})).toBe(true);
expect(canManageDevice({actorRole:'admin',actorMemberId:'a',targetRole:'owner',targetMemberId:'o'})).toBe(false);
```

- [ ] **Step 2: Run RED**

```bash
npm run test -w apps/server -- --run src/auth/permissions.test.ts
```

- [ ] **Step 3: Implement permission helpers and session role lookup**

`findSession()` must join `family_memberships`, require `status='active'`, and return role. A removed membership must behave as unauthenticated even when an old session row exists. Update `devices.last_seen_at=now()` after a successful auth completion and on authenticated requests with a lightweight update.

Use centralized helpers everywhere; delete ad-hoc `role='admin'` checks. `requireAdministrator` accepts owner or admin. Only owner can promote/demote the secondary admin.

- [ ] **Step 4: Make bootstrap owner-first**

Change `createFamilyBootstrap()` to insert first membership with role `owner`. Update `getFamilySummary()` role types and include `currentMemberId`/roles needed by UI.

- [ ] **Step 5: Run GREEN and regression tests**

```bash
npm run test -w apps/server -- --run src/auth/permissions.test.ts
npm run test -w apps/server -- --run
npm run typecheck -w apps/server
```

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/auth apps/server/src/families apps/server/src/invitations apps/server/src/keys apps/server/src/realtime
 git commit -m "feat: enforce owner admin member permissions"
```

---

### Task 3: Contacts, member management and device inventory APIs

**Files:**
- Create: `apps/server/src/members/repository.ts`
- Create: `apps/server/src/members/routes.ts`
- Create: `apps/server/src/members/routes.test.ts`
- Create: `apps/server/src/devices/repository.ts`
- Create: `apps/server/src/devices/routes.ts`
- Create: `apps/server/src/devices/routes.test.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `packages/protocol/src/index.ts`

**Interfaces:**
- `GET /v1/contacts` -> `{items:[{memberId,displayName,role}]}` active family members excluding current member.
- `GET /v1/members` -> member list including current role/device counts for administration.
- `POST /v1/family/admin/:memberId` and `DELETE /v1/family/admin/:memberId` owner-only.
- `DELETE /v1/members/:memberId` owner/admin permission-aware removal.
- `GET /v1/devices` -> devices visible/manageable to current member.
- `PATCH /v1/devices/:deviceId` body `{deviceName}`.
- `DELETE /v1/devices/:deviceId` revokes device subject to permission/last-owner-device rule.

- [ ] **Step 1: Add protocol schemas and failing route tests**

Add `FamilyRoleSchema`, `RenameDeviceRequest`, contact/member/device response schemas. Route tests must cover owner managing admin/member, secondary admin blocked from owner, member blocked from another member, and last active owner device revocation returning `409 owner_last_device`.

- [ ] **Step 2: Run RED**

```bash
npm run test -w apps/server -- --run src/members/routes.test.ts src/devices/routes.test.ts
```

- [ ] **Step 3: Implement repositories/routes**

Device list includes `deviceId,memberId,memberDisplayName,memberRole,deviceName,status,createdAt,lastSeenAt,encryptionPublicKey`. Never return private keys. Rename preserves status. Revocation deletes all `sessions` for target device, sets `status='revoked', revoked_at=now()`, appends audit event, then creates pending rotation requests for every chat containing the target member/device as described in Task 6.

Member removal sets membership `removed`, revokes every device/session for that member, and schedules affected chat rotations. Owner target must always return 403.

- [ ] **Step 4: Register routes and run GREEN**

```bash
npm run test -w apps/server -- --run src/members/routes.test.ts src/devices/routes.test.ts
npm run typecheck -w apps/server
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/members apps/server/src/devices apps/server/src/app.ts packages/protocol/src/index.ts
 git commit -m "feat: add contacts members and device management APIs"
```

---

### Task 4: Link another device to the same member

**Files:**
- Create: `apps/server/src/device-links/repository.ts`
- Create: `apps/server/src/device-links/routes.ts`
- Create: `apps/server/src/device-links/routes.test.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `apps/web/src/flows/join.ts`
- Create: `apps/web/src/flows/device-link.ts`
- Create: `apps/web/src/screens/LinkDeviceScreen.tsx`
- Create: `apps/web/src/screens/AcceptDeviceLinkScreen.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- `POST /v1/device-links` creates a 15-minute single-use token for the authenticated member only.
- `POST /v1/device-links/inspect` consumes only hash-safe token input and returns family/member display metadata.
- `POST /v1/device-links/accept` creates a `pending_key` device for the existing member; it does not create a new member or membership.
- Hash route `/#/device-link?token=...`; token is removed from browser address after capture.

- [ ] **Step 1: Write failing server tests**

Cover: same member id retained, fourth non-revoked device rejected with `409 device_limit_reached`, expired/used token rejected, token is single use.

- [ ] **Step 2: Run RED**

```bash
npm run test -w apps/server -- --run src/device-links/routes.test.ts
```

- [ ] **Step 3: Implement server link flow**

Generate 32-byte base64url token, persist SHA-256 only, 15-minute expiry. Call existing `assertDeviceCapacity()` before inserting the pending device. Issue a pending-device session so the new device can poll its key envelope exactly as the existing join flow does.

- [ ] **Step 4: Write failing web token/parser flow tests**

Test URL hash extraction, removal with `history.replaceState`, and profile preservation of the existing `memberId` returned by server.

- [ ] **Step 5: Implement web link screens**

Trusted device shows QR and copyable link. New device asks only for a device name and its local PIN, not a new member name. It generates a fresh device identity and enters the normal pending approval screen.

- [ ] **Step 6: Run GREEN**

```bash
npm run test -w apps/server -- --run src/device-links/routes.test.ts
npm run test -w apps/web -- --run
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/device-links apps/server/src/app.ts packages/protocol/src/index.ts apps/web/src/flows apps/web/src/screens apps/web/src/App.tsx
 git commit -m "feat: link additional member devices"
```

---

### Task 5: Canonical direct chats and sealed key setup

**Files:**
- Create: `apps/server/src/chats/repository.ts`
- Create: `apps/server/src/chats/routes.ts`
- Create: `apps/server/src/chats/routes.test.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `packages/protocol/src/index.ts`
- Create: `apps/web/src/flows/chats.ts`
- Create: `apps/web/src/flows/chats.test.ts`
- Modify: `apps/web/src/local/keystore.ts`

**Interfaces:**
- `GET /v1/chats` lists the family chat and direct chats in which current active member participates.
- `POST /v1/direct-chats/:memberId/prepare` atomically returns existing canonical direct chat or creates it in a `keys_pending` state and returns all active recipient devices/public keys for the two members.
- `POST /v1/chats/:chatId/keys/initialize` accepts `{keyVersion:1,envelopes:[{deviceId,sealedKeyEnvelope}]}` from either direct-chat participant and activates chat keys exactly once.

- [ ] **Step 1: Write failing canonical-pair tests**

Two concurrent requests A→B and B→A must resolve to the same `chatId`. A request to self, removed member, or another family must fail.

- [ ] **Step 2: Run RED**

```bash
npm run test -w apps/server -- --run src/chats/routes.test.ts
```

- [ ] **Step 3: Implement canonical pair transaction**

Canonicalize two UUID strings by lexical order before inserting into `direct_chat_pairs`. Use one DB transaction and the unique `(family_id,member_low,member_high)` index as concurrency backstop. Insert exactly two `chat_members` rows.

- [ ] **Step 4: Add client direct-key creation**

`openOrCreateDirectChat(memberId,pin)` calls prepare. If key not initialized, generate a 32-byte conversation key locally, seal it independently to every returned active device encryption public key, initialize server envelopes, and save the local key. If already initialized but current device lacks local key, fetch its current sealed envelope and unwrap with current device identity.

- [ ] **Step 5: Write/execute client tests**

Mock two active devices per participant and assert four sealed envelopes are produced without including plaintext key material in the request JSON.

```bash
npm run test -w apps/web -- --run src/flows/chats.test.ts
npm run test -w apps/server -- --run src/chats/routes.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/chats apps/server/src/app.ts packages/protocol/src/index.ts apps/web/src/flows/chats* apps/web/src/local/keystore.ts
 git commit -m "feat: add canonical encrypted direct chats"
```

---

### Task 6: Rotation protocol for revoked devices and removed members

**Files:**
- Create: `apps/server/src/keys/rotation.ts`
- Create: `apps/server/src/keys/rotation.test.ts`
- Modify: `apps/server/src/keys/routes.ts`
- Modify: `apps/server/src/keys/repository.ts`
- Modify: `apps/server/src/messages/routes.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `apps/server/src/realtime/hub.ts`
- Create: `apps/web/src/flows/key-rotation.ts`
- Create: `apps/web/src/flows/key-rotation.test.ts`
- Modify: `apps/web/src/realtime/socket.ts`

**Interfaces:**
- `GET /v1/key-rotations` returns pending rotations for chats the active member still belongs to plus active recipient devices/public keys.
- `POST /v1/chats/:chatId/key-rotation` body `{toKeyVersion,envelopes:[{deviceId,sealedKeyEnvelope}]}`.
- Realtime event `{type:'keys.rotation_required',chatId,toKeyVersion}`.
- Message POST returns `409 key_rotation_required` while rotation is pending.

- [ ] **Step 1: Write failing rotation server tests**

Cover: revoke creates one pending rotation per affected chat; revoked device omitted from recipients; removed member's devices omitted; a message under old key is rejected while pending; completion must include exactly all active recipient devices; completion inserts one new `conversation_key_versions` row and marks request complete atomically.

- [ ] **Step 2: Run RED**

```bash
npm run test -w apps/server -- --run src/keys/rotation.test.ts
```

- [ ] **Step 3: Implement server rotation state machine**

Use DB locks on `chat_key_rotation_requests` and current version. Never accept a caller-supplied plaintext key. Verify every envelope device belongs to an active member of the chat and every active device is represented once. Publish `keys.rotation_required` after scheduling and reconcile after completion.

- [ ] **Step 4: Write failing client rotation test**

Given a pending request and three recipient public keys, assert client generates one random key, seals three envelopes, uploads them, saves the new local chat key, and never serializes the raw key in request JSON.

- [ ] **Step 5: Implement automatic rotation worker**

On authenticated startup, browser `online`, and rotation realtime event, `processPendingRotations(pin)` tries rotations for chats where the current member is still active. Multiple same-chat attempts must be idempotent: server accepts the first canonical completion and later clients fetch the new current envelope.

- [ ] **Step 6: Run GREEN**

```bash
npm run test -w apps/server -- --run src/keys/rotation.test.ts
npm run test -w apps/web -- --run src/flows/key-rotation.test.ts
npm run test -w apps/server -- --run
npm run test -w apps/web -- --run
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/keys apps/server/src/messages apps/server/src/realtime packages/protocol/src/index.ts apps/web/src/flows/key-rotation* apps/web/src/realtime/socket.ts
 git commit -m "feat: rotate chat keys after revocation"
```

---

### Task 7: Multi-chat encrypted outbox and reusable chat screen

**Files:**
- Modify: `apps/web/src/flows/messages.ts`
- Modify: `apps/web/src/flows/messages.test.ts`
- Create: `apps/web/src/screens/ChatScreen.tsx`
- Remove after replacement: `apps/web/src/screens/FamilyChatScreen.tsx`
- Modify: `apps/web/src/components/MessageBubble.tsx`
- Modify: `apps/web/src/components/MessageBubble.test.tsx`
- Modify: `apps/web/src/realtime/socket.ts`

**Interfaces:**
- `sendTextMessage(chatId:string,text:string,pin:string): Promise<VisibleMessage>`.
- Per-chat flush serialization via `Map<string,Promise<void>>`, not one global `flushPromise`.
- `ChatScreen({chatId,title,subtitle})` reuses the same family/direct encrypted message logic.

- [ ] **Step 1: Extend failing message tests**

Create two chat IDs and assert messages use the requested chat, two chats may flush concurrently, same chat still serializes, and confirmed ordering stays server sequence based.

- [ ] **Step 2: Run RED**

```bash
npm run test -w apps/web -- --run src/flows/messages.test.ts
```

- [ ] **Step 3: Generalize message flow**

Remove `profile.familyChatId` from `sendTextMessage`; caller supplies `chatId`. Keep encrypted outbox shape unchanged. Replace singleton flush promise with a map keyed by chatId and delete map entry in `finally`.

- [ ] **Step 4: Replace family-only UI with reusable ChatScreen**

Pass sender member display names from chat/member metadata so incoming bubbles no longer say generic `Семья`. Keep send-state labels unchanged.

- [ ] **Step 5: Run GREEN**

```bash
npm run test -w apps/web -- --run src/flows/messages.test.ts src/components/MessageBubble.test.tsx
npm run typecheck -w apps/web
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/flows/messages* apps/web/src/screens apps/web/src/components/MessageBubble*
 git commit -m "feat: support encrypted messages across multiple chats"
```

---

### Task 8: Approved mobile-first navigation, contacts, profile and devices UI

**Files:**
- Modify: `apps/web/src/App.tsx`
- Create: `apps/web/src/components/AppShell.tsx`
- Create: `apps/web/src/components/BottomNav.tsx`
- Create: `apps/web/src/screens/ChatsScreen.tsx`
- Create: `apps/web/src/screens/ContactsScreen.tsx`
- Create: `apps/web/src/screens/ProfileScreen.tsx`
- Create: `apps/web/src/screens/DevicesScreen.tsx`
- Create: `apps/web/src/screens/FamilyManagementScreen.tsx`
- Modify: `apps/web/src/screens/AdminScreen.tsx` or fold its invite/pending content into `FamilyManagementScreen.tsx`
- Modify: `apps/web/src/api/types.ts`
- Modify: `apps/web/src/styles/app.css`
- Modify: `apps/web/src/styles/app.test.ts`
- Create: `apps/web/src/components/AppShell.test.tsx`

**Interfaces:**
- Bottom navigation labels exactly `Чаты`, `Контакты`, `Профиль`, `Устройства`.
- Chats screen shows family chat first plus direct chats.
- Contacts screen opens/creates direct chat on tap.
- Profile displays role as `Главный администратор`, `Администратор`, or `Участник`.
- Devices screen supports add-device QR, rename and permission-aware revoke actions.

- [ ] **Step 1: Write failing shell/render tests**

Static render tests assert all four nav labels, owner role label, no management action rendered for forbidden target, and QR container retains `.qr-box`.

- [ ] **Step 2: Run RED**

```bash
npm run test -w apps/web -- --run src/components/AppShell.test.tsx src/styles/app.test.ts
```

- [ ] **Step 3: Implement screens and routing state**

Use local React state/hash routes; do not add a router dependency. Preserve onboarding/join/pending screens outside authenticated shell. Move global theme control into Profile on mobile while keeping it accessible on larger screens.

- [ ] **Step 4: Extend approved CSS**

Keep existing exact dark palette values. Add soft rounded chat/contact/device rows, fixed mobile bottom nav with safe-area inset, desktop two-column shell, and destructive action confirmation styling. Do not use sharp cards or numbered controls.

- [ ] **Step 5: Run GREEN and full Phase 2 regression**

```bash
npm run test -w apps/web -- --run
npm run typecheck
npm run build -w apps/web
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
 git commit -m "feat: add family messenger navigation and management UI"
```

---

### Task 9: Phase 3A CI with PostgreSQL integration verification

**Files:**
- Create: `.github/workflows/phase3-ci.yml`
- Modify: `README.md`

**Interfaces:**
- CI runs for `feat/phase3-family-contacts-media`.
- PostgreSQL 17 service exposes test DB to server migration/route integration tests.

- [ ] **Step 1: Add workflow**

Use Node `22.16.0`, PostgreSQL `17`, database/user/password `family/family/family-dev-only`, health checks, and environment:

```yaml
env:
  TEST_DATABASE_URL: postgres://family:family-dev-only@localhost:5432/family
  DATABASE_URL: postgres://family:family-dev-only@localhost:5432/family
  NODE_ENV: test
```

Run in order:

```bash
npm install --no-audit --no-fund
npm run test -w packages/protocol -- --run --passWithNoTests
npm run test -w packages/crypto -- --run --passWithNoTests
npm run test -w apps/server -- --run
npm run test -w apps/web -- --run
npm run typecheck
npm run build
```

- [ ] **Step 2: Update README Phase 3A state and manual smoke checklist**

Document roles, contacts, direct chat, device links, revocation/rotation, branch name, and explicitly state media/APK are delivered in later Phase 3 plans, not yet complete at 3A.

- [ ] **Step 3: Push and inspect CI result**

Expected: every test, typecheck and build step succeeds. If anything fails, use systematic debugging before changing implementation.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/phase3-ci.yml README.md
 git commit -m "ci: verify Phase 3 identity chats and devices"
```

## Phase 3A Exit Gate

Phase 3A is complete only when automated tests prove the permission matrix, device limit/linking, direct-chat uniqueness, session invalidation, rotation blocking/completion, multi-chat encrypted offline text, and the approved navigation UI; the Phase 3 CI run is green; and no Phase 2 text/theme/PWA regression is present.