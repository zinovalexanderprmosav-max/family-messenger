# Phase 3C1 Primary Administrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted primary administrator to each family, expose it through the family API, and make promotion/demotion of the secondary administrator controllable only by the primary administrator without changing the existing `admin | member` role model.

**Architecture:** Keep current membership roles unchanged. Add nullable `families.primary_admin_member_id`, backfill existing families to their earliest active administrator, and set the creator as primary inside the existing bootstrap transaction. Administrator mutation routes authorize against the family-level primary id plus active membership; repository mutations also enforce the primary-admin invariant so it is not only a route-level rule.

**Tech Stack:** TypeScript, Fastify 5, PostgreSQL 16, Vitest 5, GitHub Actions, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-17-family-admin-device-trust-design.md`

## Global Constraints

- Work only on `feat/phase3c1-primary-admin`; do not modify `main`.
- Preserve Phase 3B2 safe checkpoint `4d21eb029c477c7e5fd8360a978a922d822292cd`.
- Keep membership roles exactly `admin` and `member`; do not introduce an `owner` role.
- Allow at most two active administrators: one primary and zero/one secondary.
- A family with `primary_admin_member_id = NULL` may still be read, but privileged administrator mutations return `primary_administrator_not_configured`.
- The primary administrator is immutable during Phase 3C1 and cannot be promoted again or demoted.
- Do not implement member removal, device revocation, second-device enrollment, key transfer, key rotation, or 3C5 UI in this plan.
- Every new behavior gets a failing test first and the failure must be observed before implementation.
- Do not weaken existing E2EE/direct-chat behavior.

---

### Task 1: Persist and backfill the primary administrator

**Files:**
- Create: `.github/workflows/phase3c1-ci.yml`
- Create: `apps/server/test/family-admin.test.ts`
- Modify: `apps/server/src/db/migrations/001_core.sql`
- Modify: `apps/server/src/families/repository.ts`

**Interfaces:**
- Consumes: existing `buildApp({pool})`, `migrate(pool)`, `POST /v1/families/bootstrap`.
- Produces: nullable database field `families.primary_admin_member_id`; bootstrap invariant that a newly committed family points to its creator member.

- [ ] **Step 1: Add branch-specific CI**

Create `.github/workflows/phase3c1-ci.yml` using the proven Phase 3B2 job, but trigger only on `feat/phase3c1-primary-admin`:

```yaml
name: Phase 3C1 CI

on:
  push:
    branches:
      - feat/phase3c1-primary-admin

jobs:
  full-project:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: family
          POSTGRES_PASSWORD: family-dev-only
          POSTGRES_DB: family
        ports:
          - 5432:5432
        options: >-
          --health-cmd="pg_isready -U family -d family"
          --health-interval=5s
          --health-timeout=5s
          --health-retries=10
    env:
      DATABASE_URL: postgres://family:family-dev-only@127.0.0.1:5432/family
      TEST_DATABASE_URL: postgres://family:family-dev-only@127.0.0.1:5432/family
      NODE_ENV: test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22.16.0
      - run: npm install --no-audit --no-fund
      - run: npm run typecheck
      - run: npm test -w apps/server -- --run
      - run: npm test -w apps/web -- --run
      - run: npm test -w packages/crypto -- --run --passWithNoTests
      - run: npm test -w packages/protocol -- --run --passWithNoTests
      - run: npm run build
```

- [ ] **Step 2: Write the RED bootstrap persistence test**

Create `apps/server/test/family-admin.test.ts` with the real PostgreSQL pool and Fastify app. Use the same truncate list as `direct-chat.test.ts`. Bootstrap a family, read `familyId` and `memberId`, then inspect the row using JSON conversion so the pre-migration test fails on an assertion rather than `column does not exist`:

```ts
const stored=await pool.query<{primary_admin_member_id:string|null}>(`
  SELECT to_jsonb(families)->>'primary_admin_member_id' AS primary_admin_member_id
  FROM families
  WHERE id=$1
`,[body.familyId]);

expect(stored.rows[0]?.primary_admin_member_id).toBe(body.memberId);
```

Use a valid bootstrap payload containing `familyDisplayName`, `memberDisplayName`, `deviceName`, `encryptionPublicKey`, `signingPublicKey`, and `initialFamilyChatKeyEnvelope`.

- [ ] **Step 3: Run the focused test and verify RED**

```bash
npm test -w apps/server -- --run test/family-admin.test.ts
```

Expected: the new assertion fails because `primary_admin_member_id` is absent and JSON lookup returns `null`; setup and syntax succeed.

- [ ] **Step 4: Write RED migration backfill tests**

In the same file import `migrate` from `../src/db/migrate.js`. Add two tests.

First, seed a family with two active admins and explicit membership timestamps such that admin B is older than admin A. Leave the family with no primary id, call `await migrate(pool)`, and expect B to become primary.

Second, seed two active admins with the same `created_at`; choose deterministic UUIDs and expect the lexicographically smaller `member_id` to become primary. The intended SQL ordering is exactly:

```sql
ORDER BY fm.created_at, fm.member_id
```

- [ ] **Step 5: Run the focused suite and verify both backfill tests are RED**

```bash
npm test -w apps/server -- --run test/family-admin.test.ts
```

Expected: bootstrap persistence/backfill assertions fail for the missing feature, not for test setup.

- [ ] **Step 6: Add the minimal idempotent schema migration**

Keep the current startup migration model. In `001_core.sql`, after `members`/`family_memberships` exist and before `COMMIT`, add:

```sql
ALTER TABLE families
  ADD COLUMN IF NOT EXISTS primary_admin_member_id UUID;

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

Do not make the column `NOT NULL`; a legacy family with no active administrator must remain readable and repairable.

- [ ] **Step 7: Set primary administrator during bootstrap**

In `createFamilyBootstrap`, immediately after creating the creator’s active `admin` membership, add:

```ts
await tx.query(
  `UPDATE families SET primary_admin_member_id=$1 WHERE id=$2`,
  [memberId,familyId]
);
```

This remains inside the existing bootstrap transaction.

- [ ] **Step 8: Run tests and typecheck to verify GREEN**

```bash
npm test -w apps/server -- --run test/family-admin.test.ts
npm run typecheck
```

Expected: all Task 1 tests pass.

- [ ] **Step 9: Verify CI and commit the checkpoint**

Confirm the latest `Phase 3C1 CI` run for the Task 1 head is green, then commit:

```bash
git add .github/workflows/phase3c1-ci.yml apps/server/test/family-admin.test.ts apps/server/src/db/migrations/001_core.sql apps/server/src/families/repository.ts
git commit -m "feat: persist primary family administrator"
```

---

### Task 2: Expose `primaryAdminMemberId` in the family summary

**Files:**
- Modify: `apps/server/test/family-admin.test.ts`
- Modify: `apps/server/src/families/repository.ts`

**Interfaces:**
- Consumes: `families.primary_admin_member_id` from Task 1.
- Produces: `GET /v1/family` response property `primaryAdminMemberId: string | null`.

- [ ] **Step 1: Write the failing family-summary test**

Bootstrap a family, extract the `fm_session` cookie from the bootstrap response, then call `GET /v1/family` and assert:

```ts
expect(response.statusCode).toBe(200);
expect(response.json()).toMatchObject({
  id:bootstrap.familyId,
  primaryAdminMemberId:bootstrap.memberId
});
```

- [ ] **Step 2: Run the focused test and verify RED**

```bash
npm test -w apps/server -- --run test/family-admin.test.ts
```

Expected: the summary assertion fails because the current repository does not return `primaryAdminMemberId`.

- [ ] **Step 3: Return the field from `getFamilySummary`**

Change the family row type/query to include `primary_admin_member_id` and return:

```ts
return {
  id:row.id,
  displayName:row.display_name,
  primaryAdminMemberId:row.primary_admin_member_id,
  familyChatId:chat.rows[0]?.id ?? null,
  members:members.rows.map(r=>({
    id:r.id,
    displayName:r.display_name,
    role:r.role,
    status:r.status
  }))
};
```

Do not change the member role values and do not modify `App.tsx` in 3C1; primary/secondary visual labels belong to 3C5.

- [ ] **Step 4: Verify GREEN**

```bash
npm test -w apps/server -- --run test/family-admin.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/test/family-admin.test.ts apps/server/src/families/repository.ts
git commit -m "feat: expose primary administrator in family summary"
```

---

### Task 3: Restrict secondary-admin promotion to the primary administrator

**Files:**
- Modify: `apps/server/test/family-admin.test.ts`
- Modify: `apps/server/src/families/routes.ts`
- Modify: `apps/server/src/families/repository.ts`

**Interfaces:**
- Consumes: configured `primary_admin_member_id`, current session principal, current `promoteAdministrator` route/repository flow.
- Produces: `assertPrimaryAdministrator(tx, principal)`; promotion protection/error semantics `primary_administrator_required`, `primary_administrator_not_configured`, `primary_administrator_protected`, `administrator_limit_reached`.

- [ ] **Step 1: Add a deterministic three-member test fixture**

Create one family with:

```text
Alex  -> role=admin,  status=active, primary_admin_member_id=Alex
Mama  -> role=member, status=active
Vika  -> role=member, status=active
```

Give each member one active device plus distinct session token and CSRF token. Reuse `hashOpaqueToken` exactly as existing integration tests do.

- [ ] **Step 2: Write RED promotion tests**

Add these independent tests:

```text
A. Alex promotes Mama -> 204; Mama becomes active admin; one family.admin.promoted audit event names Mama.
B. After Mama is promoted, Mama tries to promote Vika -> 403 primary_administrator_required.
C. After Mama is promoted, Alex tries to promote Vika -> 409 administrator_limit_reached.
D. Active legacy admin with primary_admin_member_id=NULL tries to promote -> 409 primary_administrator_not_configured.
E. Alex tries to promote Alex -> 409 primary_administrator_protected; no family.admin.promoted audit event is written.
F. Alex tries to promote an out-of-family/nonexistent member -> 404 member_not_found.
```

The route must check actor authority before the two-admin limit so case B returns `primary_administrator_required`, not a misleading limit error.

- [ ] **Step 3: Run the focused suite and verify RED**

```bash
npm test -w apps/server -- --run test/family-admin.test.ts
```

Expected: new authorization/protection assertions fail against the current generic `assertAdmin` flow.

- [ ] **Step 4: Replace generic mutation authorization with `assertPrimaryAdministrator`**

In `routes.ts` implement:

```ts
async function assertPrimaryAdministrator(
  tx:import('pg').PoolClient,
  principal:SessionPrincipal
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

Use this before `promoteAdministrator` in the promotion route.

- [ ] **Step 5: Enforce primary protection and invariant again in `promoteAdministrator`**

Change the family row lock to return `primary_admin_member_id`. Then validate the configured primary membership before the admin-count check:

```ts
const locked=await tx.query<{primary_admin_member_id:string|null}>(
  `SELECT primary_admin_member_id FROM families WHERE id=$1 FOR UPDATE`,
  [familyId]
);
if(!locked.rows[0]) throw new Error('family_not_found');

const primaryId=locked.rows[0].primary_admin_member_id;
if(!primaryId) throw new Error('primary_administrator_not_configured');

const primaryMembership=await tx.query<{role:string;status:string}>(
  `SELECT role,status FROM family_memberships WHERE family_id=$1 AND member_id=$2`,
  [familyId,primaryId]
);
if(
  primaryMembership.rows[0]?.role!=='admin' ||
  primaryMembership.rows[0]?.status!=='active'
) throw new Error('primary_administrator_not_configured');

if(memberId===primaryId) throw new Error('primary_administrator_protected');
```

Then keep the existing active-admin count limit and family-scoped target update.

- [ ] **Step 6: Add one explicit family-admin error mapper**

In `routes.ts` add a focused helper used by promotion and later demotion:

```ts
function sendFamilyAdminError(
  reply:import('fastify').FastifyReply,
  error:unknown
){
  if(!(error instanceof Error)) return false;
  if(
    error.message==='primary_administrator_not_configured' ||
    error.message==='primary_administrator_protected' ||
    error.message==='administrator_limit_reached'
  ){
    reply.code(409).send({error:error.message});
    return true;
  }
  if(error.message==='member_not_found' || error.message==='family_not_found'){
    reply.code(404).send({error:error.message});
    return true;
  }
  return false;
}
```

Errors thrown by `assertPrimaryAdministrator` with `statusCode:403` continue through the global Fastify error handler unchanged.

- [ ] **Step 7: Verify GREEN and full server regression**

```bash
npm test -w apps/server -- --run test/family-admin.test.ts
npm test -w apps/server -- --run
npm run typecheck
```

- [ ] **Step 8: Commit**

```bash
git add apps/server/test/family-admin.test.ts apps/server/src/families/routes.ts apps/server/src/families/repository.ts
git commit -m "feat: restrict administrator promotion to primary"
```

---

### Task 4: Demote the secondary administrator while protecting the primary

**Files:**
- Modify: `apps/server/test/family-admin.test.ts`
- Modify: `apps/server/src/families/repository.ts`
- Modify: `apps/server/src/families/routes.ts`

**Interfaces:**
- Consumes: `assertPrimaryAdministrator` and `sendFamilyAdminError` from Task 3.
- Produces: `demoteAdministrator(tx,familyId,memberId)` and `POST /v1/family/admins/:memberId/demote`.

- [ ] **Step 1: Write RED demotion tests**

Add these independent tests:

```text
A. Alex promotes Mama, then demotes Mama -> 204; Mama becomes member; family.admin.demoted audit event names Mama.
B. Alex targets Alex for demotion -> 409 primary_administrator_protected; Alex remains active admin; primary_admin_member_id is unchanged; no demotion audit is written.
C. Promoted Mama tries to demote an administrator -> 403 primary_administrator_required.
D. Alex demotes an out-of-family/nonexistent member -> 404 member_not_found.
E. A family with NULL/invalid primary invariant attempts demotion -> 409 primary_administrator_not_configured.
```

- [ ] **Step 2: Run the focused test and verify RED**

```bash
npm test -w apps/server -- --run test/family-admin.test.ts
```

Expected: demote endpoint/function cases fail because they do not exist yet.

- [ ] **Step 3: Add `demoteAdministrator` with service-level invariant checks**

In `repository.ts` implement the family lock and primary validation using the same logic as promotion. After validating the primary membership:

```ts
if(memberId===primaryId) throw new Error('primary_administrator_protected');

const result=await tx.query(`
  UPDATE family_memberships
  SET role='member'
  WHERE family_id=$1
    AND member_id=$2
    AND role='admin'
    AND status='active'
`,[familyId,memberId]);

if(!result.rowCount) throw new Error('member_not_found');
```

Error order is fixed:

```text
family_not_found
primary_administrator_not_configured
primary_administrator_protected
member_not_found
```

- [ ] **Step 4: Add the demotion route**

Add:

```text
POST /v1/family/admins/:memberId/demote
```

Route sequence is exactly:

```text
requireSession -> requireCsrf -> BEGIN -> assertPrimaryAdministrator
-> demoteAdministrator -> append family.admin.demoted audit event
-> COMMIT -> 204
```

On error: `ROLLBACK`, then call `sendFamilyAdminError`; otherwise rethrow so embedded `statusCode` is preserved.

- [ ] **Step 5: Verify GREEN and server regression**

```bash
npm test -w apps/server -- --run test/family-admin.test.ts
npm test -w apps/server -- --run
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/server/test/family-admin.test.ts apps/server/src/families/repository.ts apps/server/src/families/routes.ts
git commit -m "feat: protect primary admin during demotion"
```

---

### Task 5: Full regression, review, and safe 3C1 checkpoint

**Files:**
- No new feature scope. Only defects directly found by review/verification may be fixed, with a regression test first.

**Interfaces:**
- Consumes: completed Tasks 1–4.
- Produces: verified branch head SHA and green CI run/job ids suitable as the 3C1 rollback checkpoint.

- [ ] **Step 1: Run the complete local-equivalent verification sequence**

```bash
npm run typecheck
npm test -w apps/server -- --run
npm test -w apps/web -- --run
npm test -w packages/crypto -- --run --passWithNoTests
npm test -w packages/protocol -- --run --passWithNoTests
npm run build
```

Expected: every command exits successfully.

- [ ] **Step 2: Compare branch scope against the 3B2 checkpoint**

Compare `feat/phase3c1-primary-admin` against `4d21eb029c477c7e5fd8360a978a922d822292cd`. Changed surfaces must be limited to:

```text
docs/superpowers/specs/2026-09-17-family-admin-device-trust-design.md
docs/superpowers/plans/2026-09-17-phase3c1-primary-admin.md
.github/workflows/phase3c1-ci.yml
apps/server/src/db/migrations/001_core.sql
apps/server/src/families/repository.ts
apps/server/src/families/routes.ts
apps/server/test/family-admin.test.ts
```

Remove unrelated production changes before completion.

- [ ] **Step 3: Perform the mandatory code-review gate**

Invoke `superpowers:requesting-code-review`. Compare implementation against this plan and the approved spec. Any concrete defect is fixed through RED → GREEN before continuing.

- [ ] **Step 4: Perform fresh verification before completion**

Invoke `superpowers:verification-before-completion`, then rerun the required commands or confirm equivalent fresh evidence exactly as that skill requires. Do not rely on an older green run.

- [ ] **Step 5: Confirm final GitHub Actions evidence**

Confirm the latest `Phase 3C1 CI` run for the final branch head SHA has `conclusion: success`. Record:

```text
branch head SHA
workflow run id
workflow job id
```

- [ ] **Step 6: Finish the branch without merging `main`**

Invoke `superpowers:finishing-a-development-branch`. Keep `main` untouched unless the user explicitly requests a merge.

## Acceptance Criteria

- New family creator is persisted as `primary_admin_member_id` inside the bootstrap transaction.
- Existing families are deterministically backfilled to the earliest active administrator by `(created_at, member_id)` without changing `admin | member` roles.
- `GET /v1/family` returns `primaryAdminMemberId`.
- Only the configured active primary administrator can promote or demote the secondary administrator.
- The primary administrator cannot be promoted again or demoted, and protected requests do not create false audit events.
- A third active administrator cannot be created.
- A family without a configured/valid primary administrator rejects privileged mutations with `primary_administrator_not_configured`.
- Promotion and demotion create audit events only after successful mutation.
- Existing Phase 3B server/web/crypto/protocol tests and production build remain green.
- `main` remains unchanged.
