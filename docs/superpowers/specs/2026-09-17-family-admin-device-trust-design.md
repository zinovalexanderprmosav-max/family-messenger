# Phase 3C — administrator hierarchy and device trust design

Date: 2026-09-17
Status: design approved in chat; written spec awaiting user review; implementation not started

## Context

Phase 3B introduced encrypted one-to-one chats. The current family model stores only `admin` and `member`, allows up to two active admins, and has no explicit primary administrator. Device enrollment for invitations always creates a new family member, so it cannot safely add a second phone to an existing member. Existing direct chats also do not have a key envelope for a newly added device.

Phase 3C must add administrator hierarchy and safe device management without weakening the existing E2EE model.

## Goals

1. One immutable primary administrator per family during Phase 3C.
2. At most one secondary administrator in addition to the primary administrator.
3. Primary administrator can appoint/remove the secondary administrator and manage all non-primary family members and their devices.
4. Secondary administrator can manage ordinary members and their devices, but cannot remove, demote, or revoke devices belonging to the primary administrator.
5. A member can add a new device to their own account through a dedicated same-member device enrollment flow rather than a normal family invitation.
6. Existing private-chat keys for a new device are transferred only from an already trusted device belonging to the same member.
7. The server never receives plaintext conversation keys.
8. Existing Phase 3B behavior remains compatible.

## Non-goals for the first implementation slice

The first implementation slice, 3C1, does not yet add member deletion, device revocation UI, new-device QR enrollment, private-chat key transfer, or conversation-key rotation. Those are separate slices 3C2–3C5 below.

## Data model

### Primary administrator

Add nullable `primary_admin_member_id UUID` to `families`, referencing `members(id)` with `ON DELETE RESTRICT`.

The column stays nullable at the database schema level because current family bootstrap creates the family before the member. The service layer guarantees that the field is populated inside the same bootstrap transaction before commit. This avoids a risky reorder of bootstrap creation logic.

For existing families, a migration backfills `primary_admin_member_id` with the earliest active administrator by `family_memberships.created_at`, using `member_id` as the deterministic tie-breaker. If a legacy family has no active administrator, the migration leaves the field null and privileged administrator mutations return `primary_administrator_not_configured` until the family is repaired.

The service invariant is: a configured `primary_admin_member_id` must identify an active `admin` membership in the same family.

The existing membership role values remain unchanged:

- `admin`
- `member`

Primary versus secondary administrator is determined by comparing the member id with `families.primary_admin_member_id`. This minimizes compatibility risk across existing API responses and UI code.

### Administrator limit

There may be at most two active `admin` memberships per family:

- exactly one primary administrator under normal operation;
- zero or one secondary administrator.

Promoting a second secondary administrator while one already exists returns `administrator_limit_reached`.

## Permission model

### Primary administrator

May:

- appoint an active ordinary member as secondary administrator;
- demote the secondary administrator back to ordinary member;
- remove the secondary administrator from the family;
- remove ordinary members;
- revoke devices belonging to secondary/ordinary members;
- manage their own secondary devices.

May not:

- remove or demote themselves;
- transfer primary ownership in Phase 3C;
- revoke their currently authenticated device through the same request that is using that device.

### Secondary administrator

May:

- remove ordinary members;
- revoke devices belonging to ordinary members;
- manage their own secondary devices.

May not:

- promote/demote administrators;
- remove the primary administrator;
- revoke any device belonging to the primary administrator;
- remove themselves through an administrator action.

### Ordinary member

May:

- use their own active devices;
- start same-member enrollment for a new device;
- approve key transfer from one of their already trusted devices.

May not manage other family members or devices.

## API direction

Existing family-summary responses keep `role: 'admin' | 'member'` for compatibility and add enough information for the client to distinguish primary from secondary administrator. The preferred representation is a family-level `primaryAdminMemberId` field rather than introducing a third role string.

Administrator mutations must authorize against both membership role and `primary_admin_member_id`; checking only `role='admin'` is no longer sufficient.

Audit events must be written for administrator promotion/demotion, member removal, device revocation, device enrollment, and key provisioning.

## Device enrollment architecture

Normal family invitation remains for adding a new person.

Adding another device for an existing member uses a separate one-time flow: “Добавить моё устройство”. The enrollment token is bound to the existing member, has a short expiration, is single-use, and results in a `pending_key` device for that same member.

An already active device of the same member confirms the new device and provisions required key envelopes. Another family administrator cannot decrypt or provision that member’s private direct-chat keys.

## Private-chat key provisioning

When a new device is enrolled for an existing member:

1. The server identifies all current chats in which that member participates and the current key version of each chat.
2. The trusted existing device of that same member locally opens each conversation key it already possesses.
3. It seals each key to the new device’s encryption public key.
4. It uploads only sealed envelopes.
5. The server validates that envelopes cover the required chat/key-version set before activation.
6. The new device becomes `active` only after required envelopes are stored.

For direct chats, no other participant or administrator may substitute for the same-member trusted device. The server continues to know chat ids and membership metadata, but never plaintext chat keys.

If the member has no remaining trusted active device, recovery of old private-chat history is intentionally unavailable in Phase 3C. A later recovery design would need an explicit user-approved recovery mechanism rather than weakening E2EE.

## Device revocation and future confidentiality

Revocation immediately:

- marks the device `revoked`;
- invalidates its active sessions;
- blocks further server API and realtime access.

A revoked device may still retain keys and ciphertext that were previously stored locally. Therefore future confidentiality requires key rotation for chats accessible to that device. Phase 3C must rotate to a new conversation-key version for affected chats before considering revocation fully complete for production security.

For direct chats, new key material must be created and distributed only to remaining active participant devices. For the family chat, the same current E2EE envelope model is used for remaining active devices.

Key rotation will be implemented as a focused sub-slice after basic revocation behavior is established and covered by tests. Until that sub-slice is complete, device revocation is not considered production-complete security behavior.

## Implementation slices

### 3C1 — administrator hierarchy

- migration adds/backfills `families.primary_admin_member_id`;
- new family bootstrap sets creator as primary administrator in the same transaction;
- family summary exposes `primaryAdminMemberId`;
- only primary administrator can appoint/demote the secondary administrator;
- attempts against the primary administrator are rejected;
- maximum two active admins remains enforced.

### 3C2 — member removal and device revocation

- permission matrix above;
- session invalidation;
- audit records;
- current-device safety checks;
- conversation-key rotation support split into an explicit focused sub-slice.

### 3C3 — add own second device

- separate same-member enrollment token/QR;
- token is short-lived, one-use, and member-bound;
- creates a `pending_key` device under the existing member.

### 3C4 — securely provision existing chat keys

- same-member trusted-device approval;
- exact required chat/key-version envelope set validation;
- activate only after required envelopes exist;
- never expose plaintext conversation keys to server or administrators.

### 3C5 — mobile-first device management UI

- clearly label primary administrator, secondary administrator, ordinary member;
- show each member’s devices and status;
- expose only actions permitted by the permission matrix;
- provide “Добавить моё устройство” separately from “Пригласить человека”.

## Error behavior

Expected stable error codes include:

- `primary_administrator_not_configured`
- `primary_administrator_required`
- `primary_administrator_protected`
- `administrator_limit_reached`
- `member_not_found`
- `device_not_found`
- `device_protected`
- `cannot_revoke_current_device`
- `device_key_set_changed`
- `device_key_envelope_not_found`
- `device_enrollment_expired`
- `device_enrollment_consumed`
- `trusted_device_required`

HTTP status selection should preserve existing conventions: authentication/authorization errors use 401/403 as appropriate, missing family-scoped resources use 404, stale/concurrent key state uses 409.

## Testing strategy

All behavior changes use test-first development.

3C1 minimum coverage:

1. family bootstrap records the creator as `primary_admin_member_id`;
2. migration backfills the earliest active administrator for existing families;
3. family summary returns `primaryAdminMemberId`;
4. primary administrator can promote one secondary administrator;
5. secondary administrator cannot promote another administrator;
6. primary administrator cannot be demoted or targeted by protected actions;
7. third active administrator is rejected;
8. existing Phase 3B server/web/crypto/protocol tests and production build remain green.

Later slices add permission-matrix tests, session invalidation tests, same-member device enrollment tests, exact envelope-set validation, race/conflict tests, and key-rotation tests.

## Compatibility and rollout

`main` remains untouched until explicit approval to merge. Phase 3B2 remains a safe checkpoint at commit `4d21eb029c477c7e5fd8360a978a922d822292cd`.

Phase 3C work proceeds on a separate branch. Each slice is kept small and gets its own RED → GREEN → full-regression checkpoint before the next slice begins.
