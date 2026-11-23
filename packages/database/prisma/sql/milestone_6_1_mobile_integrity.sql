-- =============================================================================
-- CRELUNE Milestone 6.1 — Mobile Session & Device Database Integrity Constraints
--
-- Idempotent PostgreSQL CHECK constraints complementing Prisma composite unique
-- constraints and composite foreign keys in `packages/database/prisma/schema.prisma`:
--   1. Enforces SHA-256 hex digest format (64 lowercase hex chars) on
--      `mobile_sessions.refresh_token_hash` so plaintext tokens can never be stored.
--   2. Enforces 30-day maximum session family lifetime cap and `expires_at <= family_expires_at`.
--   3. Enforces that any rotated session (`replaced_by_session_id IS NOT NULL`)
--      is also marked revoked (`revoked_at IS NOT NULL`).
--
-- Apply via direct connection (`DATABASE_URL_UNPOOLED`) on Neon development only.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_mobile_sessions_refresh_hash_sha256'
  ) THEN
    ALTER TABLE mobile_sessions
      ADD CONSTRAINT chk_mobile_sessions_refresh_hash_sha256
      CHECK (
        char_length(refresh_token_hash) = 64
        AND refresh_token_hash ~ '^[0-9a-f]{64}$'
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_mobile_sessions_lifetime_cap'
  ) THEN
    ALTER TABLE mobile_sessions
      ADD CONSTRAINT chk_mobile_sessions_lifetime_cap
      CHECK (
        expires_at <= family_expires_at
        AND family_expires_at <= created_at + INTERVAL '30 days' + INTERVAL '5 seconds'
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_mobile_sessions_rotated_is_revoked'
  ) THEN
    ALTER TABLE mobile_sessions
      ADD CONSTRAINT chk_mobile_sessions_rotated_is_revoked
      CHECK (
        replaced_by_session_id IS NULL
        OR revoked_at IS NOT NULL
      );
  END IF;
END
$$;
