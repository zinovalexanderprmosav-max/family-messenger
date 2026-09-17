# Phase 3C1 Primary Administrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Every production behavior change follows RED → GREEN → regression verification.

**Goal:** Add a persisted primary administrator to each family, expose it through the family API, and make promotion/demotion of the secondary administrator controllable only by the primary administrator without changing the existing `admin | member` role model.

**Architecture:** Keep the current membership roles unchanged. Add nullable `families.primary_admin_member_id`, backfill existing families to their earliest active administrator, and set the creator as primary inside the existing bootstrap transaction. Administrator mutation routes authorize against the family-level primary id plus the active admin membership. The database column remains nullable for legacy-repair compatibility, while service code enforces the primary-admin invariant for privileged mutations.

**Tech Stack:** TypeScript, Fastify 5, PostgreSQL 16, Vitest 5, GitHub Actions, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-17-family-admin-device-trust-design.md`

## Global constraints

- Work only on `feat/phase3c1-primary-admin`; do not modify `main`.
- Preserve Phase 3B2 safe checkpoint `4d21eb029c477c7e5fd8360a978a922d822292cd`.
- Keep membership roles exactly `admin` and `member`; do not introduce an `owner` role.
- Allow at most two active administrators: one primary and zero/one secondary.
- A family with `primary_admin_member_id = NULL` may still be read, but privileged administrator mutations return `primary_administrator_not_configured`.
- Do not implement member removal, device revocation, second-device enrollment, key transfer, key rotation, or 3C5 UI in this plan.
- Every new behavior gets a failing test first and the failure must be observed before implementation.
- Do not weaken existing E2EE/direct-chat behavior.

---

## Task 1 — Primary-admin persistence, legacy backfill, and bootstrap

**Files:**
- Create: `.github/workflows/phase3c1-ci.yml`
- Create: `apps/server/test/family-admin.test.ts`
- Modify: `apps/server/src/db/migrations/001_core.sql`
- Modify: `apps/server/src/families/repository.ts`

### 1.1 Create branch-specific full CI

- [ ] Add `.github/workflows/phase3c1-ci.yml`, copied from the proven Phase 3B2 workflow but triggered only on `feat/phase3c1-primary-admin`.
- [ ] Keep PostgreSQL 16, Node `22.16.0`, and the exact regression command sequence:

```yaml
- run: npm install --no-audit --no-fund
- run: npm run typecheck
- run: npm test -w apps/server -- --run
- run: npm test -w apps/web -- --run
- run: npm test -w packages/crypto -- --run --passWithNoTests
- run: npm test -w packages/protocol -- --run --passWithNoTests
- run: npm run build
```

### 1.2 RED — bootstrap must persist the creator as primary administrator

- [ ] Create `apps/server/test/family-admin.test.ts` using the real PostgreSQL pool and `buildApp({pool})`, matching the existing server integration-test style.
- [ ] Use a `beforeEach` truncate equivalent to the existing direct-chat test.
- [ ] Add a test that calls `POST /v1/families/bootstrap` with a valid bootstrap payload, reads the returned `familyId` and `memberId`, then checks the stored family value.
- [ ] Before the schema change, use JSON conversion so the test fails as an assertion rather than with `column does not exist`:

```ts
const stored = await pool.query<{primary_admin_member_id:string|null}>(`
  SELECT to_jsonb(families)->>'primary_admin_member_id' AS primary_admin_member_id
  FROM families
  WHERE id=$1
`, [body.familyId]);

expect(stored.rows[0]?.primary_admin_member_id).toBe(body.memberId);
```

- [ ] Run only this test and confirm **RED** because the value is `null`.

```bash
npm test -w apps/server -- --run test/family-admin.test.ts
```

Expected: test fails on the primary-admin assertion, not on setup or syntax.

### 1.3 RED — migration must backfill the earliest active administrator

- [ ] In the same test file, import `migrate` from `../src/db/migrate.js`.
- [ ] Seed a legacy family with two active administrators and deterministic timestamps, leaving the family with no primary id.
- [ ] Make the second inserted admin older by explicit `created_at`, for example `2026-01-01` versus `2026-02-01`, then call `await migrate(pool)` again.
- [ ] Read the primary id using the same `to_jsonb(families)` expression and expect the earliest admin id.
- [ ] Add a tie-break test only if timestamps are equal: smaller `member_id` ordering must make the result deterministic.
- [ ] Run the focused test and observe **RED** because current `001_core.sql` performs no primary-admin backfill.

### 1.4 GREEN — extend the existing idempotent core migration

- [ ] Do **not** introduce a new migration framework in 3C1. The current startup migrator re-runs `001_core.sql`; extend that idempotent file after all referenced tables exist and before `COMMIT`.
- [ ] Add the column:

```sql
ALTER TABLE families
  ADD COLUMN IF NOT EXISTS primary_admin_member_id UUID;
```

- [ ] Add the foreign key once, safely on repeated startup:

```sql
DO $$
BEGIN
  ALTER TABLE families
    ADD CONSTRAINT families_primary_admin_member_fk
    FOREIGN KEY (primary_admin_member_id)
    REFERENCES members(id)
    ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
```

- [ ] Backfill only families that currently have no configured primary administrator:

```sql
UPDATE families f
SET primary_admin_member_id = (
  SELECT fm.member_id
  FROM family_memberships fm
  WHERE fm.family_id=f.id
    AND fm.role='admin'
    AND fm.status='active'
  ORDER BY fm.created_at, fm.member_id
  LIMIT 1
)
WHERE f.primary_admin_member_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM family_memberships fm
    WHERE fm.family_id=f.id
      AND fm.role='admin'
      AND fm.status='active'
  );
```

- [ ] In `createFamilyBootstrap`, immediately after creating the creator’s active admin membership, set the family primary id in the same transaction:

```ts
await tx.query(
  `UPDATE families SET primary_admin_member_id=$1 WHERE id=$2`,
  [memberId,familyId]
);
```

### 1.5 Verify GREEN and checkpoint

- [ ] Run:

```bash
npm test -w apps/server -- --run test/family-admin.test.ts
npm run typecheck
```

Expected: both primary-persistence tests pass.

- [ ] Verify the Phase 3C1 GitHub Actions run is green before moving on.
- [ ] Commit checkpoint:

```bash
git add .github/workflows/phase3c1-ci.yml apps/server/test/family-admin.test.ts apps/server/src/db/migrations/001_core.sql apps/server/src/families/repository.ts
git commit -m "feat: persist primary family administrator"
```

---

## Task 2 — Expose `primaryAdminMemberId` in family summary

**Files:**
- Modify: `apps/server/test/family-admin.test.ts`
- Modify: `apps/server/src/families/repository.ts`

### 2.1 RED — family summary includes the primary administrator id

- [ ] Add an integration test that bootstraps a family, keeps the session cookie returned by the bootstrap response, then calls `GET /v1/family`.
- [ ] Assert:

```ts
expect(response.statusCode).toBe(200);
expect(response.json()).toMatchObject({
  id: bootstrap.familyId,
  primaryAdminMemberId: bootstrap.memberId
});
```

- [ ] Run the focused test and observe **RED** because the current summary omits the field.

### 2.2 GREEN — repository returns the family-level id

- [ ] Change the family query in `getFamilySummary` to select `primary_admin_member_id`.
- [ ] Return it as camelCase without changing existing member role strings:

```ts
return {
  id: row.id,
  displayName: row.display_name,
  primaryAdminMemberId: row.primary_admin_member_id,
  familyChatId: chat.rows[0]?.id ?? null,
  members: ...
};
```

- [ ] Do not change `App.tsx` in 3C1. Extra server response data is backward-compatible; visual labeling belongs to 3C5.

### 2.3 Verify and checkpoint

- [ ] Run:

```bash
npm test -w apps/server -- --run test/family-admin.test.ts
npm run typecheck
```

- [ ] Commit:

```bash
git add apps/server/test/family-admin.test.ts apps/server/src/families/repository.ts
git commit -m "feat: expose primary administrator in family summary"
```

---

## Task 3 — Only primary administrator may promote the secondary administrator

**Files:**
- Modify: `apps/server/test/family-admin.test.ts`
- Modify: `apps/server/src/families/routes.ts`
- Modify only if necessary: `apps/server/src/families/repository.ts`

### 3.1 Extend test helpers

- [ ] Add a helper that creates one family containing:
  - Alex — primary admin, active device/session;
  - Mama — ordinary member, active device/session;
  - Vika — ordinary member, active device/session.
- [ ] Store `families.primary_admin_member_id = Alex` explicitly in this helper.
- [ ] Generate distinct session tokens and CSRF values per device.

### 3.2 RED — permission and limit behavior

- [ ] Test: Alex promotes Mama through `POST /v1/family/admins/:memberId/promote`; expect `204`, Mama becomes active `admin`, and `family.admin.promoted` is audited.
- [ ] Test: after Mama is promoted, Mama tries to promote Vika; expect `403` with:

```json
{"error":"primary_administrator_required"}
```

This must be checked before the two-admin limit so a secondary administrator does not receive a misleading `administrator_limit_reached` response.

- [ ] Test: after Mama is promoted, Alex tries to promote Vika; expect `409` with:

```json
{"error":"administrator_limit_reached"}
```

- [ ] Test: a legacy family with an active admin but `primary_admin_member_id = NULL` tries to promote; expect `409` with:

```json
{"error":"primary_administrator_not_configured"}
```

- [ ] Run the focused suite and confirm the new authorization tests are **RED** against the current `assertAdmin` behavior.

### 3.3 GREEN — replace generic admin authorization for administrator mutations

- [ ] In `routes.ts`, replace the promotion route’s generic `assertAdmin` check with `assertPrimaryAdministrator`.
- [ ] Validate both the configured primary id and its membership invariant in one query:

```ts
async function assertPrimaryAdministrator(
  tx: import('pg').PoolClient,
  principal: SessionPrincipal
){
  const result=await tx.query<{
    primary_admin_member_id:string|null;
    actor_role:string|null;
    actor_status:string|null;
    primary_role:string|null;
    primary_status:string|null;
  }>(`
    SELECT
      f.primary_admin_member_id,
      actor.role AS actor_role,
      actor.status AS actor_status,
      primary_membership.role AS primary_role,
      primary_membership.status AS primary_status
    FROM families f
    LEFT JOIN family_memberships actor
      ON actor.family_id=f.id AND actor.member_id=$2
    LEFT JOIN family_memberships primary_membership
      ON primary_membership.family_id=f.id
     AND primary_membership.member_id=f.primary_admin_member_id
    WHERE f.id=$1
  `,[principal.familyId,principal.memberId]);

  const row=result.rows[0];
  if(
    !row?.primary_admin_member_id ||
    row.primary_role!=='admin' ||
    row.primary_status!=='active'
  ){
    throw Object.assign(
      new Error('primary_administrator_not_configured'),
      {statusCode:409}
    );
  }

  if(
    row.primary_admin_member_id!==principal.memberId ||
    row.actor_role!=='admin' ||
    row.actor_status!=='active'
  ){
    throw Object.assign(
      new Error('primary_administrator_required'),
      {statusCode:403}
    );
  }
}
```

- [ ] Keep repository-level row locking and the existing two-admin count check inside `promoteAdministrator`.
- [ ] Keep `administrator_limit_reached` mapped to HTTP `409`.
- [ ] Keep `member_not_found` family-scoped and map it to `404` if the route does not already return that status.

### 3.4 Verify and checkpoint

- [ ] Run:

```bash
npm test -w apps/server -- --run test/family-admin.test.ts
npm test -w apps/server -- --run
npm run typecheck
```

- [ ] Commit:

```bash
git add apps/server/test/family-admin.test.ts apps/server/src/families/routes.ts apps/server/src/families/repository.ts
git commit -m "feat: restrict administrator promotion to primary"
```

---

## Task 4 — Primary administrator may demote the secondary; primary is protected

**Files:**
- Modify: `apps/server/test/family-admin.test.ts`
- Modify: `apps/server/src/families/repository.ts`
- Modify: `apps/server/src/families/routes.ts`

### 4.1 RED — demotion behavior

- [ ] Test: Alex promotes Mama and then calls `POST /v1/family/admins/:mamaId/demote`; expect `204`, Mama becomes `member`, and audit event `family.admin.demoted` contains `memberId`.
- [ ] Test: Alex calls demote targeting Alex; expect `409` with:

```json
{"error":"primary_administrator_protected"}
```

Then re-read membership and assert Alex is still active `admin` and the family’s primary id is unchanged.

- [ ] Test: promoted Mama attempts to demote an administrator; expect `403 primary_administrator_required`.
- [ ] Test: demoting a non-existent/out-of-family member returns `404 member_not_found`.
- [ ] Run the focused suite and confirm **RED** because the demote endpoint/function does not yet exist.

### 4.2 GREEN — repository demotion mutation

- [ ] Add `demoteAdministrator(tx,familyId,memberId)` in `repository.ts`.
- [ ] Lock the family row with `FOR UPDATE` and read `primary_admin_member_id`.
- [ ] Behavior order:
  1. missing family → `family_not_found`;
  2. null/invalid primary invariant → `primary_administrator_not_configured`;
  3. target equals primary → `primary_administrator_protected`;
  4. update only an active `admin` target to `member`;
  5. if no target row updated → `member_not_found`.

Minimal mutation shape:

```ts
const result=await tx.query(`
  UPDATE family_memberships
  SET role='member'
  WHERE family_id=$1
    AND member_id=$2
    AND role='admin'
    AND status='active'
`,[familyId,memberId]);
```

### 4.3 GREEN — route and audit event

- [ ] Add:

```text
POST /v1/family/admins/:memberId/demote
```

- [ ] Require session, CSRF, and `assertPrimaryAdministrator` before repository mutation.
- [ ] Append `family.admin.demoted` with `{memberId}`.
- [ ] Map stable errors:
  - `primary_administrator_not_configured` → `409`;
  - `primary_administrator_protected` → `409`;
  - `administrator_limit_reached` → `409`;
  - `member_not_found` → `404`;
  - authorization error retains its embedded `403`.
- [ ] If useful, extract one small `sendFamilyAdminError(reply,error)` helper for the promotion/demotion routes; do not refactor unrelated route code.

### 4.4 Verify and checkpoint

- [ ] Run:

```bash
npm test -w apps/server -- --run test/family-admin.test.ts
npm test -w apps/server -- --run
npm run typecheck
```

- [ ] Commit:

```bash
git add apps/server/test/family-admin.test.ts apps/server/src/families/repository.ts apps/server/src/families/routes.ts
git commit -m "feat: protect primary admin during demotion"
```

---

## Task 5 — Full regression, review, and 3C1 checkpoint

**Files:** no new production scope; only fixes directly required by verification are allowed.

### 5.1 Run complete verification

- [ ] Run exactly:

```bash
npm run typecheck
npm test -w apps/server -- --run
npm test -w apps/web -- --run
npm test -w packages/crypto -- --run --passWithNoTests
npm test -w packages/protocol -- --run --passWithNoTests
npm run build
```

Expected: every command exits successfully with no new warnings/errors attributable to 3C1.

### 5.2 Review scope against the 3B2 checkpoint

- [ ] Compare `feat/phase3c1-primary-admin` against `4d21eb029c477c7e5fd8360a978a922d822292cd`.
- [ ] Expected changed production/test surfaces are limited to:
  - `docs/superpowers/specs/...`
  - `docs/superpowers/plans/...`
  - `.github/workflows/phase3c1-ci.yml`
  - `apps/server/src/db/migrations/001_core.sql`
  - `apps/server/src/families/repository.ts`
  - `apps/server/src/families/routes.ts`
  - `apps/server/test/family-admin.test.ts`
- [ ] Any unrelated production change must be removed or separately justified before completion.

### 5.3 Mandatory completion gates

- [ ] Use `superpowers:requesting-code-review` and address concrete findings.
- [ ] Use `superpowers:verification-before-completion`; do not claim success from stale CI or earlier commands.
- [ ] Confirm the latest `Phase 3C1 CI` GitHub Actions run for the final head SHA has conclusion `success`.
- [ ] Record the final branch head SHA and CI run/job ids as the safe 3C1 checkpoint.
- [ ] Do **not** merge into `main` unless the user explicitly requests it.
- [ ] Finish the branch with `superpowers:finishing-a-development-branch` only after all tests and review gates are green.

## Acceptance criteria for Phase 3C1

- New family creator is persisted as `primary_admin_member_id` in the same bootstrap transaction.
- Existing families are deterministically backfilled to their earliest active administrator without changing role strings.
- `GET /v1/family` includes `primaryAdminMemberId`.
- Only the configured active primary administrator can promote or demote the secondary administrator.
- The configured primary administrator cannot be demoted.
- A third active administrator cannot be created.
- A family without a configured/valid primary administrator rejects privileged mutations with `primary_administrator_not_configured` rather than silently treating any admin as primary.
- Promotion and demotion create audit events.
- Phase 3B direct chats and the full web/server/crypto/protocol build remain green.
- `main` remains unchanged.
