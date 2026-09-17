# Phase 3C2 — member removal, device revocation, and key-rotation design

Date: 2026-09-17
Status: design approved in chat; written spec awaiting user review; implementation not started
Base checkpoint: `feat/phase3c1-primary-admin` at `5566903aad3eb08f8fa6a4e65ff06499d30e2687`

## Context

Phase 3C1 established one immutable primary administrator, at most one secondary administrator, and protected administrator mutations with active-device checks.

Phase 3C2 adds member removal and device revocation without weakening the current end-to-end-encryption model. Revoking server access alone is not sufficient because a removed or revoked device may still retain previously delivered conversation keys and ciphertext. Therefore 3C2 must separate immediate access cutoff from cryptographic future-confidentiality repair.

## Goals

1. Immediately block a revoked device from new HTTP API, authentication, and realtime access.
2. Invalidate all sessions belonging to a revoked device.
3. Allow authorized administrators and a member themself to revoke permitted devices according to the Phase 3C permission matrix.
4. Soft-remove family members rather than physically deleting their historical data.
5. Revoke all devices and sessions of a removed member in the same transaction as membership removal.
6. Preserve historical messages for remaining authorized participants.
7. Make direct chats with a removed member read-only for future writes.
8. Detect chats whose current key was known to a revoked device and require cryptographic key rotation before new messages may be sent.
9. Keep plaintext conversation keys entirely client-side.
10. Preserve Phase 3B and 3C1 behavior.

## Non-goals

Phase 3C2 does not add:

- same-member new-device QR enrollment — Phase 3C3;
- trusted-device provisioning of historical chat keys to a new device — Phase 3C4;
- full mobile device-management UI — Phase 3C5;
- transfer of primary-administrator ownership;
- server-side generation or decryption of conversation keys;
- restoration of private history when a member has no remaining trusted device.

## Permission model

All mutating endpoints require:

- a valid session;
- `deviceStatus === 'active'`;
- valid CSRF;
- an active family membership for the acting member.

### Revoking a device

A member may revoke another device that belongs to the same member, but may not revoke the currently authenticated device through that request.

The primary administrator may revoke:

- devices of the secondary administrator;
- devices of ordinary members;
- their own other devices.

The primary administrator may not revoke their currently authenticated device through the same request.

The secondary administrator may revoke:

- devices of ordinary members;
- their own other devices.

The secondary administrator may not revoke:

- any device belonging to the primary administrator;
- a device belonging to another administrator;
- their currently authenticated device through the same request.

An ordinary member may revoke only their own other devices.

### Removing a member

The primary administrator may remove:

- the secondary administrator;
- any ordinary member.

The primary administrator may not remove themself.

The secondary administrator may remove ordinary members only.

The secondary administrator may not remove:

- the primary administrator;
- themself;
- another administrator.

An ordinary member may not use the administrator removal endpoint.

Protected attempts use stable errors rather than silently succeeding.

## API design

### Revoke a device

`POST /v1/family/devices/:deviceId/revoke`

Success: `204 No Content`.

Errors:

- `device_not_active` → `403` for an acting session whose device is not active;
- `device_not_found` → `404` when the target device is outside the actor's family or absent;
- `device_protected` → `403` when the permission matrix protects the target device;
- `cannot_revoke_current_device` → `409` when the target equals the acting device;
- `administrator_required` → `403` when another member's device is targeted by an ordinary member.

The route is idempotent only after family-scoped lookup confirms the target: an already revoked target returns `204` and does not create duplicate rotation requirements or duplicate audit events unless implementation evidence shows a clearer existing repository convention. The intended final behavior is single logical revocation.

### Remove a member

`POST /v1/family/members/:memberId/remove`

Success: `204 No Content`.

Errors:

- `member_not_found` → `404`;
- `primary_administrator_protected` → `409`;
- `administrator_required` → `403`;
- `member_protected` → `403` for protected secondary-admin/self-removal cases not covered by the primary-admin invariant;
- `device_not_active` → `403` for a non-active acting device.

Removing an already removed family membership returns `204` without duplicating audit events.

## Immediate device revocation transaction

Revocation runs in one database transaction:

1. Lock the target device row and family membership rows required for authorization.
2. Re-evaluate the permission matrix under the lock.
3. Reject current-device revocation.
4. Set target device `status='revoked'` and `revoked_at=now()` if not already revoked.
5. Delete all `sessions` for the target device.
6. Delete unused or outstanding `auth_challenges` for the target device.
7. Determine every current chat/key-version for which the revoked device has a key envelope and which remains writable for at least one legitimate participant.
8. Create deduplicated `rotation_required` records for those chat/current-key-version pairs.
9. Append `device.revoked` audit event with target `deviceId`, target `memberId`, and reason/source.
10. Commit.

After commit, the realtime layer actively closes live WebSocket connections registered for that exact `deviceId`.

## Realtime connection ownership

The current realtime hub is family-scoped only. Phase 3C2 changes registration metadata so each connection is tracked by at least:

- `familyId`;
- `deviceId`.

The hub gains a device-scoped disconnect operation such as `disconnectDevice(deviceId, code, reason)`.

On successful revocation/removal, the route calls the hub after transaction commit. This prevents a revoked device from keeping an already-open realtime channel until its next reconnect.

New websocket connections continue to require a valid session and an active device. Existing `revoked` blocking remains, and 3C2 strengthens it to reject any status other than `active`.

## Member removal transaction

Member removal is soft deletion at the family-membership layer.

In one database transaction:

1. Lock the target `family_memberships` row and family primary-admin state.
2. Re-evaluate actor and target authorization.
3. Reject protected primary/self/admin cases.
4. Change `family_memberships.status` from `active` to `removed`.
5. Revoke all target member devices in the same family, setting `revoked_at` where needed.
6. Delete all sessions and outstanding auth challenges for those devices.
7. Create deduplicated rotation requirements for continuing writable chats whose current key was available to any revoked device.
8. Mark direct chats involving the removed member as not writable for future messages.
9. Append one `family.member.removed` audit event and device-level revocation audit events or a deterministic aggregated revocation detail, chosen consistently in implementation.
10. Commit.

After commit, all realtime connections belonging to the removed member's devices are closed.

The global `members` row and historical message rows remain intact.

## Direct-chat write state

A direct chat containing a removed family member becomes read-only for future writes.

Preferred representation: add a nullable or boolean chat write-state field with an explicit reason rather than deleting `chat_members`. The exact schema name may be `write_disabled_at` plus `write_disabled_reason`, or an equivalent small representation chosen during implementation planning.

Message history remains readable by members who remain authorized to that chat and whose device status is active. New `POST /v1/chats/:chatId/messages` requests return `409 chat_read_only` once the chat is disabled.

Removing a member from the family chat does not delete the family chat; future family-chat access is governed by active family membership and rotated keys.

## Active membership authorization

Phase 3C2 closes an existing structural gap: chat authorization must not rely on `chat_members` alone after soft-removal exists.

For family-scoped operations, the acting member must have `family_memberships.status='active'` in the same family. Message send/read and realtime connection establishment must reject a removed membership even if historical `chat_members` rows still exist.

This avoids deleting chat history relationships solely to enforce authorization.

## Rotation requirement data model

Add a small table for pending key rotations. Preferred shape:

```sql
CREATE TABLE chat_key_rotations (
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  from_key_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('required','completed')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY(chat_id,from_key_version),
  FOREIGN KEY(chat_id,from_key_version)
    REFERENCES conversation_key_versions(chat_id,key_version)
    ON DELETE CASCADE
);
```

The final migration may add minimal metadata such as `triggered_by_device_id` only if tests or audit requirements need it. Rotation records must be deduplicated.

A chat with a current `required` rotation is write-blocked.

## Which chats require rotation

When a device is revoked, rotation is required only for a chat when all of the following are true:

1. the revoked device has a `device_key_envelopes` row for that chat's current key version;
2. the chat remains intended to receive future messages;
3. at least one legitimate active participant/device remains.

Examples:

- family chat after one device is revoked → rotation required;
- direct chat where one participant loses one of several devices but both participants remain active → rotation required;
- direct chat whose member is removed from the family and the chat is made permanently read-only → no new writable key is required for that archived direct chat;
- chat with no remaining active recipient devices → no automatic server-side key generation; it stays non-writable/unrecoverable until a later explicit recovery design.

## Rotation completion protocol

The server never generates the new conversation key.

A trusted active device belonging to a current active chat participant performs rotation:

1. Client asks server for the exact required recipient-device set for a pending chat rotation.
2. Server returns current rotation metadata plus active recipient devices and their encryption public keys.
3. Client generates a new random conversation key locally.
4. Client seals that same new key separately to every required active recipient device.
5. Client submits the exact envelope set in one request.
6. Server re-locks and re-validates the rotation, chat membership state, active devices, and exact recipient set.
7. If the set changed, return `409 device_key_set_changed`; store nothing partial.
8. Server creates `conversation_key_versions.key_version = previous + 1`.
9. Server inserts one sealed envelope for every required active device.
10. Server marks the rotation record `completed`.
11. Server writes `chat.key.rotated` audit metadata without plaintext keys.
12. Commit atomically.

Only after completion may new messages use the new key version.

## Rotation endpoints

Preferred server API:

`GET /v1/chats/:chatId/key-rotation`

Returns either no pending rotation or:

- `chatId`;
- `fromKeyVersion`;
- `nextKeyVersion`;
- required active recipient devices with `deviceId`, `memberId`, and `encryptionPublicKey`.

`POST /v1/chats/:chatId/key-rotation`

Body contains:

- `fromKeyVersion`;
- `nextKeyVersion`;
- exact sealed envelope list `{deviceId,sealedKeyEnvelope}`.

Success: `204 No Content` or a compact success payload containing the new key version if needed by the client flow.

Stable conflicts:

- `key_rotation_required` → `409` when sending to a blocked chat;
- `key_rotation_not_required` → `409` when submitting rotation with no pending requirement;
- `key_rotation_stale` → `409` when versions no longer match;
- `device_key_set_changed` → `409` when active recipients changed during preparation;
- `trusted_device_required` → `403` when the acting device is not allowed to rotate that chat;
- `chat_read_only` → `409` for permanently disabled direct chats.

## Trusted device allowed to rotate

The actor must:

- have an active device;
- have an active family membership;
- still be an active `chat_member` of the chat;
- possess the previous/current key envelope for its own device.

This last condition proves the server is asking a device that already had access to the prior conversation key. The client locally opens the prior key if needed, but the server never sees it.

For the family chat, any active remaining family member device satisfying those conditions may perform rotation. For a direct chat, either remaining active participant device satisfying the same conditions may perform rotation.

## Session and authentication behavior

On revocation:

- all `sessions` for the device are deleted immediately;
- outstanding `auth_challenges` for the device are deleted immediately;
- `/v1/auth/challenge` continues to hide revoked devices as `device_not_found`;
- `/v1/auth/complete` cannot succeed for revoked devices;
- existing request handlers continue to reject non-active device status where mutation/read access requires active status.

For removed members, active-membership checks additionally block requests even if an obsolete session somehow survives a race.

## Audit events

Minimum new audit events:

- `device.revoked` with target device/member identifiers;
- `family.member.removed` with target member identifier;
- `chat.key.rotation.required` with chat id and previous key version;
- `chat.key.rotated` with chat id and new key version.

No audit event contains plaintext conversation keys or sealed-envelope contents.

Idempotent repeat requests must not create duplicate logical audit events.

## Error model

New stable errors for 3C2:

- `device_not_found`
- `device_protected`
- `cannot_revoke_current_device`
- `member_not_found`
- `member_protected`
- `primary_administrator_protected`
- `administrator_required`
- `device_not_active`
- `chat_read_only`
- `key_rotation_required`
- `key_rotation_not_required`
- `key_rotation_stale`
- `device_key_set_changed`
- `trusted_device_required`

Existing authentication errors keep their existing meaning.

## Concurrency and atomicity

Device revocation, member removal, and key-rotation completion must use database transactions and row locks.

Important races to handle:

- two administrators revoke the same device concurrently;
- member self-revokes a secondary device while administrator revokes it;
- device set changes while a client is preparing rotation envelopes;
- member is removed while another device is preparing a rotation;
- two trusted devices attempt the same rotation simultaneously;
- message send races with rotation becoming required.

Expected behavior is deterministic idempotency or stable `409` conflicts; never partial envelope storage.

## Implementation slices

### 3C2a — immediate revocation and access cutoff

- branch-specific CI;
- device revoke endpoint and permission matrix;
- session/auth-challenge invalidation;
- device-scoped WebSocket tracking and forced disconnect;
- audit event;
- active membership guards needed for the revoke path.

### 3C2b — soft member removal

- remove-member endpoint and permission matrix;
- soft membership removal;
- revoke all target devices and sessions;
- disconnect all target device sockets;
- direct-chat read-only state;
- active-membership enforcement for messaging/realtime;
- audit event.

### 3C2c — rotation-required server state

- `chat_key_rotations` migration;
- create deduplicated pending rotations on device revocation/removal;
- block message writes while required;
- skip rotation for permanently read-only direct chats;
- expose rotation preparation metadata.

### 3C2d — E2EE rotation completion

- exact active-recipient device set;
- client-side random key generation and per-device sealing;
- atomic new key version + envelopes + completion;
- concurrent/stale-set conflict tests;
- full Phase 3B/3C1 regression and production build.

## Testing strategy

All production behavior follows RED → GREEN.

Minimum 3C2a tests:

1. member revokes own other active device;
2. current device cannot revoke itself;
3. primary revokes secondary/ordinary device;
4. secondary revokes ordinary device;
5. secondary cannot revoke primary/admin device;
6. ordinary member cannot revoke another member device;
7. sessions and auth challenges for target device are invalidated;
8. already-open target WebSocket is disconnected;
9. repeated revoke is logically idempotent;
10. cross-family device id returns `device_not_found`.

Minimum 3C2b tests:

1. primary removes ordinary member;
2. primary removes secondary administrator;
3. primary cannot remove themself;
4. secondary removes ordinary member;
5. secondary cannot remove primary, self, or another admin;
6. removed membership becomes `removed` rather than physically deleted;
7. all removed member devices become revoked and sessions disappear;
8. direct chats with removed member reject new messages with `chat_read_only`;
9. historical messages remain readable by legitimate remaining participants;
10. removed member cannot continue via stale session or websocket.

Minimum 3C2c/3C2d tests:

1. revoking a keyed device creates one deduplicated pending rotation for continuing writable chats;
2. revoked device without current envelope does not create unnecessary rotation;
3. read-only archived direct chat does not require new writable key;
4. pending rotation blocks message send;
5. GET rotation returns exact active recipient devices;
6. submission with missing/extra device envelope returns `device_key_set_changed`;
7. concurrent device-set change returns conflict with no partial writes;
8. successful rotation creates exactly one next key version and exact envelopes;
9. old key version cannot be used for new messages after rotation;
10. two concurrent rotation attempts yield one success and one stable stale/not-required result;
11. server never receives or stores plaintext conversation key material;
12. existing direct-chat, family-chat, web, crypto, protocol, and build checks stay green.

## Compatibility and rollout

- `main` remains untouched until explicit merge approval.
- 3C1 remains a safe checkpoint at `5566903aad3eb08f8fa6a4e65ff06499d30e2687`.
- Phase 3C2 work proceeds on `feat/phase3c2-removal-revocation` created directly from the 3C1 checkpoint.
- Each sub-slice receives its own RED → GREEN → full-regression checkpoint.
- Revocation is not described as production-complete future confidentiality until 3C2d key rotation is implemented and verified.
