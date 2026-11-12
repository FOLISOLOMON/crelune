-- =============================================================================
-- CRELUNE Milestone 5.1.1 / 5.1.2 — PostgreSQL Database Integrity Triggers
--
-- Complements Prisma composite unique constraints and composite foreign keys in
-- `packages/database/prisma/schema.prisma` for invariants that cannot be
-- expressed in Prisma schema DSL alone:
--   1. Disallows `design_jobs.template_version_id` without `template_id`
--      (closing PostgreSQL MATCH SIMPLE multi-column FK null bypass) and keeps
--      design_jobs aligned with active creative_job_dispatches.
--   2. Enforces `creative_job_dispatches` organisation, template, and version
--      consistency against the parent `design_jobs` row under concurrency.
--   3. Enforces `template_versions` immutability for file identity and
--      integrity columns while allowing controlled inspection metadata updates.
--
-- Concurrency & Locking Strategy (Milestone 5.1.2):
--   - Every parent `design_jobs` row is the single serialization point for
--     template/version changes and dispatch creation/reassignment on that job.
--   - `UPDATE design_jobs` acquires a row-level `FOR NO KEY UPDATE` tuple lock
--     on the target `design_jobs` row before running its `BEFORE UPDATE`
--     trigger (`crelune_enforce_design_job_template_consistency`).
--   - `INSERT` or active `UPDATE` on `creative_job_dispatches` acquires
--     `SELECT ... FROM design_jobs WHERE id = NEW.design_job_id FOR NO KEY UPDATE`
--     inside `crelune_enforce_dispatch_template_consistency` before reading the
--     parent job's `template_id` / `template_version_id`.
--   - Because `FOR NO KEY UPDATE` conflicts with `UPDATE` and other
--     `FOR NO KEY UPDATE` locks on the same `design_jobs` row, concurrent
--     operations on the same job serialize in either direction without global
--     locks or cross-organisation contention, and PostgreSQL re-reads the
--     committed parent state after lock acquisition.
--
-- Limitations:
--   - Triggers execute inside PostgreSQL for all SQL/Prisma writes, including
--     direct SQL connections, but a superuser or table owner executing DDL
--     (`ALTER TABLE ... DISABLE TRIGGER` or `DROP TRIGGER`) or a session with
--     `session_replication_role = replica` can bypass them.
--   - Idempotent (`CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` +
--     `CREATE TRIGGER`); apply via `DATABASE_URL_UNPOOLED` / `npm run db:integrity`.
-- =============================================================================

CREATE OR REPLACE FUNCTION crelune_enforce_design_job_template_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_conflict RECORD;
BEGIN
  IF NEW.template_version_id IS NOT NULL AND NEW.template_id IS NULL THEN
    RAISE EXCEPTION
      'DesignJob integrity violation: template_version_id cannot be set without template_id (design_job_id=%).',
      NEW.id
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.template_id IS DISTINCT FROM OLD.template_id OR
    NEW.template_version_id IS DISTINCT FROM OLD.template_version_id
  ) THEN
    SELECT d.id, d.template_version_id, tv.template_id
      INTO v_conflict
      FROM creative_job_dispatches d
      JOIN template_versions tv ON tv.id = d.template_version_id
     WHERE d.design_job_id = NEW.id
       AND d.status NOT IN ('CANCELLED', 'FAILED')
       AND (
         (OLD.template_id IS NOT NULL AND NEW.template_id IS NULL)
         OR (NEW.template_id IS NOT NULL AND tv.template_id IS DISTINCT FROM NEW.template_id)
         OR (NEW.template_version_id IS NOT NULL AND d.template_version_id IS DISTINCT FROM NEW.template_version_id)
       )
     LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION
        'DesignJob integrity violation: template selection conflicts with active CreativeJobDispatch "%" (design_job_id=%).',
        v_conflict.id,
        NEW.id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_design_jobs_template_consistency ON design_jobs;
CREATE TRIGGER trg_design_jobs_template_consistency
  BEFORE INSERT OR UPDATE OF organisation_id, template_id, template_version_id
  ON design_jobs
  FOR EACH ROW
  EXECUTE FUNCTION crelune_enforce_design_job_template_consistency();

CREATE OR REPLACE FUNCTION crelune_enforce_dispatch_template_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_job RECORD;
  v_version RECORD;
BEGIN
  -- Terminal status transitions (e.g. cancelling or failing an existing dispatch)
  -- that do not alter organisation, job, or template version cannot introduce
  -- an active-dispatch template mismatch.
  IF TG_OP = 'UPDATE'
     AND NEW.status IN ('CANCELLED', 'FAILED')
     AND NEW.organisation_id IS NOT DISTINCT FROM OLD.organisation_id
     AND NEW.design_job_id IS NOT DISTINCT FROM OLD.design_job_id
     AND NEW.template_version_id IS NOT DISTINCT FROM OLD.template_version_id THEN
    RETURN NEW;
  END IF;

  -- Serialize against concurrent DesignJob template/version updates and other
  -- dispatches for the same DesignJob by locking the parent DesignJob row.
  SELECT organisation_id, template_id, template_version_id
    INTO v_job
    FROM design_jobs
   WHERE id = NEW.design_job_id
     FOR NO KEY UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'CreativeJobDispatch integrity violation: design_job "%" does not exist.',
      NEW.design_job_id
      USING ERRCODE = '23503';
  END IF;

  SELECT organisation_id, template_id
    INTO v_version
    FROM template_versions
   WHERE id = NEW.template_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'CreativeJobDispatch integrity violation: template_version "%" does not exist.',
      NEW.template_version_id
      USING ERRCODE = '23503';
  END IF;

  IF NEW.organisation_id IS DISTINCT FROM v_job.organisation_id THEN
    RAISE EXCEPTION
      'CreativeJobDispatch integrity violation: organisation_id "%" mismatches DesignJob organisation_id "%".',
      NEW.organisation_id,
      v_job.organisation_id
      USING ERRCODE = '23503';
  END IF;

  IF NEW.organisation_id IS DISTINCT FROM v_version.organisation_id THEN
    RAISE EXCEPTION
      'CreativeJobDispatch integrity violation: organisation_id "%" mismatches TemplateVersion organisation_id "%".',
      NEW.organisation_id,
      v_version.organisation_id
      USING ERRCODE = '23503';
  END IF;

  IF v_job.template_id IS NOT NULL AND v_version.template_id IS DISTINCT FROM v_job.template_id THEN
    RAISE EXCEPTION
      'CreativeJobDispatch integrity violation: TemplateVersion "%" belongs to template "%", expected DesignJob template "%".',
      NEW.template_version_id,
      v_version.template_id,
      v_job.template_id
      USING ERRCODE = '23514';
  END IF;

  IF v_job.template_version_id IS NOT NULL AND NEW.template_version_id IS DISTINCT FROM v_job.template_version_id THEN
    RAISE EXCEPTION
      'CreativeJobDispatch integrity violation: template_version_id "%" conflicts with pinned DesignJob.template_version_id "%".',
      NEW.template_version_id,
      v_job.template_version_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_creative_job_dispatches_template_consistency ON creative_job_dispatches;
CREATE TRIGGER trg_creative_job_dispatches_template_consistency
  BEFORE INSERT OR UPDATE OF organisation_id, design_job_id, template_version_id, status
  ON creative_job_dispatches
  FOR EACH ROW
  EXECUTE FUNCTION crelune_enforce_dispatch_template_consistency();

CREATE OR REPLACE FUNCTION crelune_enforce_template_version_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'TemplateVersion immutable field "id" cannot be modified after creation.' USING ERRCODE = '23514';
  END IF;
  IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id THEN
    RAISE EXCEPTION 'TemplateVersion immutable field "organisation_id" cannot be modified after creation.' USING ERRCODE = '23514';
  END IF;
  IF NEW.template_id IS DISTINCT FROM OLD.template_id THEN
    RAISE EXCEPTION 'TemplateVersion immutable field "template_id" cannot be modified after creation.' USING ERRCODE = '23514';
  END IF;
  IF NEW.version_number IS DISTINCT FROM OLD.version_number THEN
    RAISE EXCEPTION 'TemplateVersion immutable field "version_number" cannot be modified after creation.' USING ERRCODE = '23514';
  END IF;
  IF NEW.format IS DISTINCT FROM OLD.format THEN
    RAISE EXCEPTION 'TemplateVersion immutable field "format" cannot be modified after creation.' USING ERRCODE = '23514';
  END IF;
  IF NEW.storage_bucket IS DISTINCT FROM OLD.storage_bucket THEN
    RAISE EXCEPTION 'TemplateVersion immutable field "storage_bucket" cannot be modified after creation.' USING ERRCODE = '23514';
  END IF;
  IF NEW.storage_key IS DISTINCT FROM OLD.storage_key THEN
    RAISE EXCEPTION 'TemplateVersion immutable field "storage_key" cannot be modified after creation.' USING ERRCODE = '23514';
  END IF;
  IF NEW.original_filename IS DISTINCT FROM OLD.original_filename THEN
    RAISE EXCEPTION 'TemplateVersion immutable field "original_filename" cannot be modified after creation.' USING ERRCODE = '23514';
  END IF;
  IF NEW.mime_type IS DISTINCT FROM OLD.mime_type THEN
    RAISE EXCEPTION 'TemplateVersion immutable field "mime_type" cannot be modified after creation.' USING ERRCODE = '23514';
  END IF;
  IF NEW.byte_size IS DISTINCT FROM OLD.byte_size THEN
    RAISE EXCEPTION 'TemplateVersion immutable field "byte_size" cannot be modified after creation.' USING ERRCODE = '23514';
  END IF;
  IF NEW.sha256 IS DISTINCT FROM OLD.sha256 THEN
    RAISE EXCEPTION 'TemplateVersion immutable field "sha256" cannot be modified after creation.' USING ERRCODE = '23514';
  END IF;
  IF NEW.uploaded_by_user_id IS DISTINCT FROM OLD.uploaded_by_user_id THEN
    RAISE EXCEPTION 'TemplateVersion immutable field "uploaded_by_user_id" cannot be modified after creation.' USING ERRCODE = '23514';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'TemplateVersion immutable field "created_at" cannot be modified after creation.' USING ERRCODE = '23514';
  END IF;
  IF OLD.upload_intent_id IS NOT NULL AND NEW.upload_intent_id IS DISTINCT FROM OLD.upload_intent_id THEN
    RAISE EXCEPTION 'TemplateVersion immutable field "upload_intent_id" cannot be modified or cleared once finalised.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_template_versions_immutability ON template_versions;
CREATE TRIGGER trg_template_versions_immutability
  BEFORE UPDATE
  ON template_versions
  FOR EACH ROW
  EXECUTE FUNCTION crelune_enforce_template_version_immutability();

