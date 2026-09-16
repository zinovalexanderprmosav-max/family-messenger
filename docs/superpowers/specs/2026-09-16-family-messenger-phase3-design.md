# Family Messenger Phase 3 Design

## Status

Approved product direction from the September 16, 2026 discussion. Phase 3 builds on `feat/phase2-offline-dark-theme` and preserves the existing client-side end-to-end encrypted text flow, durable offline outbox, QR onboarding, device approval, realtime reconcile, PWA shell, and System/Light/Dark themes.

## Goal

Turn the Phase 2 family-only text chat into a complete private family messenger with:

- one shared family chat;
- automatic family contacts;
- one-to-one private chats;
- one person with up to three trusted devices;
- owner/admin/member permissions;
- administrator device management;
- encrypted photos, videos and files;
- clickable links and link cards;
- a complete two-device acceptance test using the owner's iPhone and Windows work PC;
- an installable Android APK;
- an installable iPhone PWA as the initial iOS deliverable.

## Chosen architecture

Phase 3 keeps one shared React/PWA product core for iPhone, desktop browser and Android. The Android APK is a thin native shell around the same hosted application so it uses the same HTTPS origin, IndexedDB, E2E crypto, media code and server API instead of creating a second messenger implementation.

Alternatives considered and rejected for this phase:

1. **PWA only** — simplest, but does not satisfy the required APK deliverable.
2. **Separate native Android and iOS clients** — strongest native integration but duplicates the UI, crypto and sync logic and would significantly expand the first complete release.
3. **Shared PWA core + Android shell** — selected because it produces one functional product across iPhone, desktop and Android while preserving a real APK deliverable.

The initial iPhone product is the installable PWA. A native iOS wrapper/TestFlight build can be a later phase if it becomes useful.

## Main navigation

The authenticated application has four primary destinations:

1. **Chats** — shared family chat plus recent direct chats.
2. **Contacts** — every active family member appears automatically; tapping a contact opens or creates the unique direct chat for that pair.
3. **Profile** — current member identity, role, theme and security/recovery controls.
4. **Devices** — current member's devices; owner/admin management is also available from member management.

The approved visual direction remains: soft graphite surfaces, teal accent, rounded cards/buttons, System/Light/Dark modes, light QR surfaces, and mobile-first layout.

## Roles and permissions

Exactly one family member is `owner`.

### Owner

- cannot be removed or demoted by another member;
- owner devices cannot be renamed or revoked by the secondary admin;
- can invite members and approve first devices;
- can remove any non-owner member;
- can rename/revoke any non-owner device;
- can manage their own devices;
- can appoint or remove the one secondary admin;
- can manage the whole family;
- cannot revoke the last usable owner device unless another owner device is active or a recovery handoff prevents lockout.

### Secondary admin

At most one secondary admin exists in Phase 3.

- can invite members and approve first devices;
- can remove ordinary members;
- can manage devices of ordinary members;
- can manage their own devices;
- cannot remove/demote the owner;
- cannot manage owner devices;
- cannot appoint another admin.

### Member

- participates in family and private chats;
- manages only their own devices;
- cannot manage other members.

The database role set becomes `owner | admin | member`. Existing families without an owner are migrated by promoting their current first administrator to `owner`.

## Members, contacts and direct chats

Every active family membership automatically appears in Contacts. There are no friend requests inside one family.

A direct chat is unique for an unordered pair of active family members. The server prevents duplicate direct chats for the same pair. Direct chats contain exactly those two members.

When a contact is opened for the first time, the client requests the canonical direct chat. If it does not exist, the server creates it and the client creates a fresh conversation key and sealed key envelopes for every currently active device belonging to the two participants.

The family chat remains a separate `kind='family'` chat containing all active family members.

## Multi-device model

A person can have at most **3 active or pending devices**.

### New family member

Owner/admin creates a short-lived, single-use QR invitation. The new person scans it, enters their display name, chooses a personal PIN, generates local device keys and waits for approval.

### Additional device for an existing person

From an already trusted device, the member selects **Add device** and confirms their PIN. The app creates a short-lived, single-use device-link QR tied to the existing member. The new device scans it, generates fresh device keys and becomes pending until approved by an authorized device/admin.

The server rejects a fourth active/pending device.

## Device management and revocation

Each device has:

- a user-editable device name;
- created-at time;
- last-seen time;
- state: pending / active / revoked;
- a short cryptographic fingerprint used during approval.

Owner can manage all devices. Secondary admin can manage their own and ordinary-member devices but not owner devices. Ordinary members manage only their own devices.

Revoking a device:

1. invalidates all server sessions for that device;
2. changes its state to revoked;
3. excludes it from new conversation-key distributions;
4. rotates affected chat keys so the revoked device cannot decrypt future messages;
5. keeps server audit metadata for the action.

Previously decrypted local content on an offline/lost device cannot be remotely erased reliably; the product states this limitation clearly.

## Secure history and recovery

A newly approved device should be able to restore the member's encrypted history without giving the family owner access to another person's private chat keys.

Each member therefore has an end-to-end encrypted recovery vault:

- a high-entropy recovery key is generated client-side;
- the recovery key is shown as a recovery QR/code and never uploaded in plaintext;
- the vault contains the conversation keys required by that member;
- the server stores only encrypted vault bytes plus version metadata;
- trusted devices update the vault when new chat keys/versions are received;
- a new approved device restores from an existing trusted device or from the recovery QR/code;
- the local recovery material remains PIN-encrypted in IndexedDB using the existing Argon2id + XChaCha20-Poly1305 pattern.

If all devices and the recovery code are lost, old E2E history cannot be recovered. The onboarding UI must explain this once during recovery setup.

## Messages and links

Text messages keep the Phase 2 local-first durable encrypted outbox.

Plain URLs inside a message become tappable. Link preview metadata is fetched client-side when practical so the server does not need plaintext message bodies. A preview is optional: failure to generate one never blocks sending the text message.

No read/delivery receipt will be presented as implemented until a dedicated receipt protocol exists. Phase 3 continues to guarantee the current send states (`Ожидает сети`, `Отправляется...`, `Отправлено`).

## Encrypted photos, videos and files

Every attachment is encrypted on the sending device before upload. The server/object store receives ciphertext and non-sensitive routing metadata only.

Each attachment message includes an encrypted manifest with:

- original file name;
- MIME type;
- original size;
- encrypted blob identifier;
- content key / nonce data wrapped inside the message's encrypted payload;
- preview/thumbnail metadata where applicable.

The encrypted binary store is accessed through an `AttachmentStore` server abstraction so storage can move without changing the messenger protocol. Development tests use a local/test implementation; the deployed service uses durable S3-compatible object storage.

### Photos

The sender sees:

- **Auto** — resize/compress for fast family sharing;
- **HD** — higher-resolution compressed copy;
- **Original** — exact original bytes.

Photo transformations happen locally before encryption.

### Video

The sender sees:

- **Normal quality**;
- **High quality**;
- **Original**.

Video compression is performed locally when the current platform supports the selected transform. If a browser/device cannot safely transcode that video format, the UI explicitly offers Original instead of silently changing quality.

### Files

PDF, DOCX, XLSX, ZIP and other general files are sent unchanged before encryption. File name/type/size shown in the chat come from the encrypted attachment manifest after local decryption.

Attachment upload supports progress, cancellation, retry and resumable chunk upload. The encrypted outbox keeps the attachment job until server acknowledgement so a temporary network failure does not lose the send.

## Media durability

Encrypted media is not stored in the Render web-service filesystem. Production uses durable S3-compatible object storage. The server stores attachment references and ciphertext metadata in PostgreSQL.

A storage quota/status view is available to owner and current member. Quota enforcement is server-side and errors are surfaced before local outbox removal.

## Family member removal

Removing a member:

- disables the membership;
- revokes all of that member's sessions/devices in the family;
- removes them from Contacts;
- rotates the family chat key for the remaining active members;
- rotates affected direct-chat keys as necessary;
- keeps old ciphertext/history for remaining authorized participants;
- prevents the removed member from receiving future keys/messages.

## Offline behavior

Phase 2 offline guarantees continue for text. Phase 3 extends them to attachment jobs:

- message/attachment job is created locally first;
- encrypted metadata and upload state survive reload/restart;
- upload resumes after connectivity returns;
- completed server acknowledgement removes the pending job;
- duplicate retries use stable IDs and server idempotency.

First-time joining, device approval and recovery requiring remote history remain network-required.

## Android APK

Phase 3 includes an Android project that produces an installable APK from the same application core.

Requirements:

- package id is stable;
- HTTPS-only production endpoint;
- file chooser and camera/gallery attachment selection work;
- external links open safely;
- back navigation behaves like a normal Android application;
- IndexedDB/local storage persists across restarts;
- dark/light/system theme follows the same application preference;
- the build pipeline produces a test-installable APK artifact automatically.

A debug/test-signed APK is sufficient for family acceptance. Production release signing is kept outside source control and can be added after acceptance.

## iPhone deliverable

The initial iPhone deliverable remains the installable PWA:

- opened once from Safari over HTTPS;
- added to Home Screen;
- launches standalone;
- retains encrypted IndexedDB state;
- uses the same family/direct/media functionality as desktop/Android;
- keeps the Phase 2 service-worker offline shell.

## Acceptance test environment

The principal real-world acceptance test uses the owner's available devices:

- **Device A:** owner's iPhone, installed as the PWA from Safari;
- **Device B:** owner's Windows work PC in an independent browser profile/session.

This pair is deliberately treated as two independent devices with separate cookies, IndexedDB databases and device keypairs.

The final acceptance sequence is:

1. create or reset a dedicated test family;
2. verify owner role and owner device list;
3. invite a second test member from the second browser/device;
4. approve the new member/device;
5. verify automatic Contacts;
6. verify shared family chat in both directions;
7. create/open a direct chat and verify only the two participants can access it;
8. send text and clickable links;
9. send Auto/HD/Original photo cases where supported;
10. send video in available quality modes and Original fallback;
11. send a general file;
12. interrupt network during text and attachment sends, reload, restore network, and verify one canonical copy after automatic retry;
13. add/rename/revoke a test device and verify permissions;
14. verify owner cannot be removed/managed by secondary admin;
15. verify secondary admin permissions against an ordinary member;
16. verify a newly approved device restores authorized encrypted history using the recovery flow;
17. verify System/Light/Dark themes and white QR surfaces;
18. reload both devices and verify stable canonical history with no duplicates;
19. build the Android APK in CI and install/smoke-test it on an Android emulator or available Android device;
20. run typecheck, unit/integration suites, production web build and Android build before release acceptance.

The iPhone + Windows test is the main functional acceptance. The APK remains a mandatory build deliverable and receives its own install/start/media-selection smoke test.

## Security boundaries

The server must never receive plaintext message bodies, plaintext attachment contents, plaintext conversation keys, plaintext member recovery keys, personal PINs or decrypted private keys.

QR invitation/device-link tokens remain short-lived and single-use. Sensitive invite/recovery material is not logged.

Revoked devices are denied API/WebSocket access and future key material.

## Phase 3 completion criteria

Phase 3 is complete only when:

- owner/admin/member permissions are enforced server-side and represented correctly in UI;
- contacts and direct chats work;
- up to three devices per member work;
- revocation prevents future decryption by the revoked device after key rotation;
- photos/videos/files are E2E encrypted and durable;
- text/attachment retry is idempotent and survives restart;
- the iPhone + Windows acceptance sequence passes;
- the Android APK artifact builds and passes install/start smoke testing;
- the iPhone PWA installs and launches standalone;
- automated tests, typecheck and production builds are green;
- no Phase 2 regression is left unresolved.
