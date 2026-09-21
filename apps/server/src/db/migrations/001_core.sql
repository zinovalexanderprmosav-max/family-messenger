BEGIN;

CREATE TABLE IF NOT EXISTS families (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS family_memberships (
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin','member')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (family_id, member_id)
);

CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  device_name TEXT NOT NULL CHECK (length(device_name) BETWEEN 1 AND 100),
  encryption_public_key TEXT NOT NULL,
  signing_public_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending_key','active','revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  CONSTRAINT devices_public_keys_unique UNIQUE (encryption_public_key, signing_public_key)
);
CREATE INDEX IF NOT EXISTS devices_member_status ON devices(member_id,status);

CREATE TABLE IF NOT EXISTS invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  created_by_device_id UUID NOT NULL REFERENCES devices(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS device_enrollments (
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
CREATE INDEX IF NOT EXISTS device_enrollments_member_active
  ON device_enrollments(member_id,expires_at)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('family','direct')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_family_chat_per_family ON chats(family_id) WHERE kind='family';

CREATE TABLE IF NOT EXISTS chat_members (
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(chat_id,member_id)
);

CREATE TABLE IF NOT EXISTS conversation_key_versions (
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  key_version INTEGER NOT NULL CHECK(key_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(chat_id,key_version)
);

CREATE TABLE IF NOT EXISTS device_key_envelopes (
  chat_id UUID NOT NULL,
  key_version INTEGER NOT NULL,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  sealed_key_envelope TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(chat_id,key_version,device_id),
  FOREIGN KEY(chat_id,key_version) REFERENCES conversation_key_versions(chat_id,key_version) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_key_rotations (
  chat_id UUID NOT NULL,
  from_key_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('required','completed')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY(chat_id,from_key_version),
  FOREIGN KEY(chat_id,from_key_version)
    REFERENCES conversation_key_versions(chat_id,key_version)
    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS chat_key_rotations_required
  ON chat_key_rotations(chat_id,status)
  WHERE status='required';

CREATE TABLE IF NOT EXISTS message_envelopes (
  message_id UUID PRIMARY KEY,
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_device_id UUID NOT NULL REFERENCES devices(id),
  key_version INTEGER NOT NULL,
  nonce TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  sequence BIGSERIAL NOT NULL UNIQUE,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(chat_id,key_version) REFERENCES conversation_key_versions(chat_id,key_version)
);
CREATE UNIQUE INDEX IF NOT EXISTS message_id_idempotency ON message_envelopes(message_id);
CREATE INDEX IF NOT EXISTS message_reconcile_cursor ON message_envelopes(chat_id,sequence);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS auth_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  challenge TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  actor_device_id UUID REFERENCES devices(id),
  event_type TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

ALTER TABLE chats ADD COLUMN IF NOT EXISTS write_disabled_at TIMESTAMPTZ;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS write_disabled_reason TEXT;
DO $$ BEGIN
 ALTER TABLE chats ADD CONSTRAINT chats_write_state CHECK (
  (write_disabled_at IS NULL AND write_disabled_reason IS NULL) OR
  (write_disabled_at IS NOT NULL AND write_disabled_reason='member_removed')
 );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMIT;