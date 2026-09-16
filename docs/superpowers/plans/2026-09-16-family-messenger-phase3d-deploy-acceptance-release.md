# Family Messenger Phase 3D Deployment, Acceptance and Release Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy an isolated Phase 3 preview, run complete automated and real-device acceptance on the owner's iPhone and Windows work PC, build/smoke-test the Android APK, verify security boundaries, and prepare a controlled merge/release without touching stable production until explicit owner approval.

**Architecture:** Phase 3 preview is isolated from the current stable service at both code and data layers: its own Render Web Service, its own PostgreSQL database, and its own S3-compatible encrypted object bucket/prefix. The iPhone PWA and Windows browser exercise the same hosted preview as two independent devices. Android APK is built with that exact preview HTTPS origin. Only after all automated/manual gates pass does the owner decide whether to merge Phase 3 into `main` and update production.

**Tech Stack:** GitHub Actions, Render Docker Web Service, PostgreSQL 17, S3-compatible object storage, Safari iPhone PWA, Windows Chromium browser, Android debug APK.

**Spec:** `docs/superpowers/specs/2026-09-16-family-messenger-phase3-design.md`

## Global Constraints

- Existing stable service `family-messenger-9wd2` and `main` remain unchanged until explicit owner approval after acceptance.
- Phase 3 preview must use a separate database; do not run Phase 3 migrations against the current stable database during preview acceptance.
- Phase 3 preview media must use a separate S3-compatible bucket/prefix; never rely on Render local filesystem durability.
- Do not paste database passwords, S3 secret keys, signing secrets, recovery codes or active invitation tokens into chat.
- Family invite and device-link tokens are short-lived/single-use and stay in URL fragments where designed; regenerate after any screenshot-based acceptance demonstration.
- Acceptance assertions distinguish automated proof from manual observation. Do not claim database/object-store plaintext absence without an actual supported inspection.
- The principal manual functional test is owner's iPhone PWA + owner's Windows work PC as independent devices.
- APK is mandatory and receives separate install/start/media chooser smoke testing.
- No merge to `main`, production deployment or destructive reset without explicit owner approval at the final release gate.

---

### Task 1: Final pre-deploy verification on feature branch

**Files:**
- Modify: `.github/workflows/phase3-ci.yml` if needed
- Modify: `README.md` if verification commands drift

**Interfaces:**
- One Phase 3 CI run covers protocol, crypto, server with PostgreSQL, web, typecheck, production web/server build.
- Android workflow independently covers unit/lint/instrumentation/APK assembly.

- [ ] **Step 1: Trigger/inspect Phase 3 CI at branch HEAD**

Required commands represented by CI:

```bash
npm install --no-audit --no-fund
npm run test -w packages/protocol -- --run --passWithNoTests
npm run test -w packages/crypto -- --run
npm run test -w apps/server -- --run
npm run test -w apps/web -- --run
npm run typecheck
npm run build
```

- [ ] **Step 2: Require all checks green**

If any test/typecheck/build fails, use systematic debugging; do not deploy a red branch.

- [ ] **Step 3: Record exact verified commit SHA in README acceptance section**

Do not use `latest` language alone; include the commit SHA that passed.

- [ ] **Step 4: Commit documentation-only verification update if needed**

```bash
git add README.md .github/workflows/phase3-ci.yml
 git commit -m "docs: record Phase 3 predeploy verification"
```

---

### Task 2: Create isolated Render Phase 3 preview infrastructure

**Files:**
- Create if useful: `docs/deploy/phase3-render-preview.md`
- Modify: `README.md`

**Interfaces:**
- Preview Web Service branch: `feat/phase3-family-contacts-media`.
- Preview database: separate PostgreSQL instance/database from stable production.
- Health endpoint: `/health`.
- Environment contains `NODE_ENV=production`, preview `DATABASE_URL`, S3 variables from Phase 3B, and explicit `ATTACHMENT_QUOTA_BYTES`.

- [ ] **Step 1: Create separate preview PostgreSQL**

Use Render connector/plugin when authorized. Name clearly, e.g. `family-messenger-phase3-db`. Never reuse stable `family-messenger-db` for preview migrations.

- [ ] **Step 2: Create separate Phase 3 Web Service**

Name e.g. `family-messenger-phase3`; Docker runtime; branch `feat/phase3-family-contacts-media`; Frankfurt/nearest supported region consistent with DB; health check `/health`.

- [ ] **Step 3: Configure preview secrets without exposing them in chat**

Set:

```text
NODE_ENV=production
DATABASE_URL=<preview internal database URL>
S3_ENDPOINT=<preview object endpoint>
S3_REGION=<region>
S3_BUCKET=<preview bucket>
S3_ACCESS_KEY_ID=<secret>
S3_SECRET_ACCESS_KEY=<secret>
S3_FORCE_PATH_STYLE=<true|false according to provider>
ATTACHMENT_QUOTA_BYTES=<explicit positive integer>
```

- [ ] **Step 4: Deploy and verify health**

`GET /health` must return 200 with service `family-messenger-server`. Capture the exact preview HTTPS URL for later Android build input; do not guess it.

- [ ] **Step 5: Verify migrations ran only on preview DB**

Use authorized read-only DB query if available: role constraint contains owner and Phase 3 tables exist. Do not query stable DB destructively.

---

### Task 3: Preview browser smoke before real-device acceptance

**Files:**
- Create: `docs/testing/phase3-preview-smoke.md`

**Interfaces:**
- Two independent desktop sessions emulate two devices before involving iPhone.

- [ ] **Step 1: First-load/PWA shell smoke**

Open preview, verify welcome screen, create a dedicated disposable test family, switch themes, reload.

- [ ] **Step 2: Second independent browser session**

Use another browser/profile/incognito with separate cookie and IndexedDB. Join using a newly generated invite QR/link and approve it from first session.

- [ ] **Step 3: Minimum feature smoke**

Verify contacts, family text, one direct text, one clickable link, one small encrypted photo/file, reconnect after temporary offline, and reload without duplicates.

- [ ] **Step 4: Reset/create clean acceptance family**

Do not reuse exposed one-time tokens from smoke. Start the formal acceptance with a fresh family or documented clean state.

---

### Task 4: Install Phase 3 as PWA on owner's iPhone

**Files:**
- Create: `docs/testing/iphone-pwa-acceptance.md`

**Interfaces:**
- Safari opens preview HTTPS once; user uses `Поделиться` -> `На экран «Домой»`; PWA launches standalone.

- [ ] **Step 1: Verify PWA metadata on preview**

Manifest loads, icon renders, `display=standalone`, HTTPS valid, service worker installs.

- [ ] **Step 2: Install on iPhone**

Open exact preview in Safari, add to Home Screen, launch from the icon. Confirm it does not merely open a normal Safari tab.

- [ ] **Step 3: Verify local-state persistence**

Unlock/join test identity, fully close PWA, reopen, confirm profile/keystore remains and PIN is required after in-memory unlock state is lost.

- [ ] **Step 4: Verify iPhone attachment picker**

From chat, select one photo and one file where iOS supports it. Confirm quality selector and encrypted upload progress UI appear.

---

### Task 5: Formal iPhone + Windows acceptance sequence

**Files:**
- Create: `docs/testing/phase3-final-acceptance.md`
- Modify: `README.md` with link to final checklist

**Interfaces:**
- Device A: owner's iPhone PWA.
- Device B: owner's Windows work PC in an independent browser/profile.
- Each device has independent cookies, IndexedDB and keypairs.

- [ ] **Step 1: Create/reset dedicated acceptance family**

On Device A create family. Assert current member is `Главный администратор (Owner)` and only one owner exists.

- [ ] **Step 2: Invite second test member on Device B**

Generate fresh member invite on A, open/scan on B, enter distinct test member name/PIN/device name, approve on A after fingerprint comparison.

- [ ] **Step 3: Automatic contacts**

Both sides show active family members automatically; no friend-request step.

- [ ] **Step 4: Shared family chat**

Send unique text A→B and B→A. Reload both. Each appears exactly once with `Отправлено` only for sender; no fake `Доставлено`.

- [ ] **Step 5: Direct chat isolation**

Tap contact, create/open canonical direct chat, exchange messages. Confirm family chat does not display them and unrelated family member (when added for role test) cannot fetch that direct chat.

- [ ] **Step 6: Links**

Send an HTTPS link. It is clickable; optional preview failure must not block message.

- [ ] **Step 7: Photos**

Send three suitable photo cases: `Авто`, `HD`, `Оригинал`. Verify recipient opens each and Original preserves original byte size/hash when downloaded if platform exposes exact file bytes.

- [ ] **Step 8: Video**

Send supported Normal/High mode where available. On platform without safe transcode, verify explicit Original fallback text. Send Original successfully.

- [ ] **Step 9: General file**

Send a PDF/DOCX/other test file. Recipient downloads/decrypts it; compare SHA-256 to sender original for exact-byte file mode.

- [ ] **Step 10: Offline text retry**

On one client go offline, send `offline-text-1` and `offline-text-2`, reload/reopen offline after shell is installed, confirm queued messages persist, restore network, verify one canonical copy each in FIFO order.

- [ ] **Step 11: Offline attachment retry**

Start a multi-chunk attachment, interrupt network mid-upload, reload/reopen, restore network. Verify upload resumes missing chunks and produces exactly one message/attachment.

- [ ] **Step 12: Additional device lifecycle**

From existing member create Add Device QR, attach a new browser profile/device to same member, confirm max-3 rule, rename it, then revoke a disposable test device.

- [ ] **Step 13: Owner protection**

As secondary admin, attempts to demote/remove owner or rename/revoke owner device are denied. Owner can manage secondary admin and ordinary members.

- [ ] **Step 14: Secondary admin permissions**

Owner appoints test member as secondary admin. Admin can manage ordinary member/device, cannot appoint another admin, cannot touch owner.

- [ ] **Step 15: Revocation key rotation**

After disposable device revocation, affected chat temporarily requires rotation, active device completes it, remaining clients send under new key version. Revoked session/API access fails; future messages cannot be decrypted with old key in automated rotation test evidence.

- [ ] **Step 16: Recovery flow**

Set up per-member recovery, export recovery QR/code privately, approve a fresh device, restore encrypted vault and confirm authorized old family/direct history becomes readable. Do not capture/share active recovery code in screenshots.

- [ ] **Step 17: Theme/QR visual verification**

Check System/Light/Dark on iPhone and Windows; QR backgrounds remain white/light and scan reliably.

- [ ] **Step 18: Canonical reload**

Reload/reopen both devices; verify stable history, no duplicate messages/attachments, direct/family chat list consistent.

Record PASS/FAIL and concise evidence for every step. Any FAIL blocks release until fixed and re-tested.

---

### Task 6: Security-boundary verification on preview

**Files:**
- Create: `docs/testing/phase3-security-verification.md`

**Interfaces:**
- Automated evidence + authorized read-only infrastructure inspection are clearly separated.

- [ ] **Step 1: Automated request-boundary assertions**

Run crypto/web tests that assert plaintext marker strings do not appear in serialized message envelopes, attachment chunks/jobs, recovery vault upload JSON, or direct-chat key initialization JSON.

- [ ] **Step 2: Session/revocation assertions**

Server integration tests prove removed memberships and revoked devices cannot authenticate/API/WebSocket and pending rotations block old-key sends.

- [ ] **Step 3: Read-only PostgreSQL inspection if connector access exists**

For dedicated test messages, inspect `message_envelopes.ciphertext`, recovery ciphertext and attachment metadata. Verify expected routing/ciphertext fields only. Do not claim semantic absence of plaintext beyond what schema/request tests and inspected rows support.

- [ ] **Step 4: Read-only object-store inspection if supported**

Inspect object names/sizes only and, if bytes can be safely sampled through authorized tooling, assert they do not equal the original test file bytes. Do not reveal object credentials.

- [ ] **Step 5: Log review**

Check preview logs for accidental active invite/device-link/recovery values. Invite/device-link URLs place secret in fragment; recovery material is never sent. Regenerate any token shown during troubleshooting.

---

### Task 7: Build APK against exact Phase 3 preview and smoke test

**Files:**
- Update: `docs/testing/android-smoke.md` with actual tested build commit/preview URL host (no secrets)

**Interfaces:**
- Android workflow input `base_url` equals exact Phase 3 preview HTTPS origin.

- [ ] **Step 1: Trigger Android APK workflow at verified branch commit**

Provide exact preview `base_url`; require unit tests, lint, emulator instrumentation and `assembleDebug` green.

- [ ] **Step 2: Download/inspect artifact**

Artifact `family-messenger-android-debug` contains `FamilyMessenger-0.3.0-test.apk`.

- [ ] **Step 3: Install on emulator or available Android device**

Run the 11-step Android smoke checklist: launch, preview load, identity persistence, photo/file/camera chooser, external link, back navigation, themes, restart persistence.

- [ ] **Step 4: Record APK SHA-256**

Record checksum in acceptance notes so the tested file is identifiable. Do not call it release-signed.

---

### Task 8: Final verification-before-completion gate

**Files:**
- Modify: `README.md`
- Create: `docs/testing/phase3-release-report.md`

**Interfaces:**
- Report names exact commit SHA, Phase 3 CI run, Android CI run/artifact checksum, preview URL, and manual checklist PASS/FAIL summary.

- [ ] **Step 1: Re-run full automated verification on final candidate commit**

No code changes after this run unless checks are re-run.

- [ ] **Step 2: Confirm manual acceptance all PASS**

iPhone + Windows is required, Android smoke required. If a platform capability uses documented Original video fallback, that is PASS when behavior matches spec.

- [ ] **Step 3: Write release report**

Explicitly distinguish:

```text
Automated: protocol/crypto/server/web/typecheck/build/Android tests
Manual: iPhone PWA + Windows end-to-end acceptance
Manual: Android APK install/start/media smoke
Infrastructure inspection: only checks actually performed
```

- [ ] **Step 4: Stop before merge and obtain explicit owner approval**

Present final results and ask whether to merge Phase 3 into `main`. Do not merge merely because all tests pass.

---

### Task 9: Controlled merge and production rollout after explicit approval

**Files:**
- Modify only if required: production deployment docs/README

**Interfaces:**
- This task is forbidden until owner explicitly approves merge after Task 8.

- [ ] **Step 1: Merge feature branch into `main` using normal reviewed flow**

Preserve final verified commit ancestry and ensure production CI runs.

- [ ] **Step 2: Prepare production infrastructure before code rollout**

Production database backup/restore point and production S3-compatible encrypted media storage must exist. Apply migrations through normal app startup only after backup is confirmed.

- [ ] **Step 3: Deploy production**

Observe `/health`, startup migrations and logs. Do not reuse Phase 3 disposable test family credentials/tokens as real family setup material.

- [ ] **Step 4: Production smoke**

Open production on one desktop and iPhone; verify load, existing supported data, theme, auth, a fresh test text. Avoid destructive role/device tests on real family until desired.

- [ ] **Step 5: Generate fresh real family/device invitation tokens**

Any invitation token previously shown in screenshots/chat is treated as expired/compromised and not reused.

## Phase 3D Exit Gate

Phase 3D is complete only when the final candidate commit has green automated web/server/crypto/protocol/Android verification; the dedicated preview passes the full iPhone + Windows acceptance; APK artifact passes install/start/media smoke; security claims are limited to evidence actually checked; a release report exists; and production remains untouched until explicit owner merge approval.