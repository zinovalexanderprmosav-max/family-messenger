BEGIN;

ALTER TABLE family_memberships DROP CONSTRAINT IF EXISTS family_memberships_role_check;
ALTER TABLE family_memberships
  ADD CONSTRAINT family_memberships_role_check
  CHECK (role IN ('owner','admin','member'));

WITH ranked AS (
  SELECT
    family_id,
    member_id,
    row_number() OVER (PARTITION BY family_id ORDER BY created_at,member_id) AS rn
  FROM family_memberships
  WHERE role='admin' AND status='active'
), families_without_owner AS (
  SELECT DISTINCT r.family_id
  FROM ranked r
  WHERE NOT EXISTS (
    SELECT 1 FROM family_memberships existing
    WHERE existing.family_id=r.family_id
      AND existing.role='owner'
      AND existing.status='active'
  )
)
UPDATE family_memberships fm
SET role='owner'
FROM ranked r
JOIN families_without_owner fwo ON fwo.family_id=r.family_id
WHERE fm.family_id=r.family_id
  AND fm.member_id=r.member_id
  AND r.rn=1;

WITH ranked_admins AS (
  SELECT
    family_id,
    member_id,
    row_number() OVER (PARTITION BY family_id ORDER BY created_at,member_id) AS rn
  FROM family_memberships
  WHERE role='admin' AND status='active'
)
UPDATE family_memberships fm
SET role='member'
FROM ranked_admins r
WHERE fm.family_id=r.family_id
  AND fm.member_id=r.member_id
  AND r.rn>1;

CREATE UNIQUE INDEX IF NOT EXISTS one_active_owner_per_family
  ON family_memberships(family_id)
  WHERE role='owner' AND status='active';

CREATE UNIQUE INDEX IF NOT EXISTS one_active_secondary_admin_per_family
  ON family_memberships(family_id)
  WHERE role='admin' AND status='active';

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
  from_key_version INTEGER NOT NULL CHECK(from_key_version > 0),
  to_key_version INTEGER NOT NULL CHECK(to_key_version > from_key_version),
  reason TEXT NOT NULL CHECK (reason IN ('device_revoked','member_removed')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

COMMIT;
