-- =============================================================================
-- CRELUNE Milestone 6.1 — Non-Destructive Additive Mobile Schema DDL
--
-- Exact additive PostgreSQL schema changes for MobileDevice, MobileSession,
-- PushDelivery, Notification composite org key, and UserPreference push toggles.
-- Strictly non-destructive (ZERO DROP / TRUNCATE / destructive ALTER).
-- Apply via direct connection (`DATABASE_URL_UNPOOLED`) on Neon development only.
-- =============================================================================

CREATE TYPE "MobilePlatform" AS ENUM ('IOS', 'ANDROID');

CREATE TYPE "PushDeliveryStatus" AS ENUM (
  'PENDING',
  'TICKET_ACCEPTED',
  'DELIVERED',
  'FAILED',
  'DEVICE_UNREGISTERED'
);

ALTER TABLE "user_preferences"
  ADD COLUMN "push_birthday_reminders" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "push_design_updates" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "push_notifications_enabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "mobile_devices" (
  "id" TEXT NOT NULL,
  "organisation_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "device_install_id" TEXT NOT NULL,
  "platform" "MobilePlatform" NOT NULL,
  "device_name" TEXT,
  "os_version" TEXT,
  "app_version" TEXT,
  "expo_push_token" TEXT,
  "push_permission_status" TEXT,
  "push_enabled" BOOLEAN NOT NULL DEFAULT true,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMP(3),
  "revoked_by_user_id" TEXT,
  "revocation_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "mobile_devices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mobile_sessions" (
  "id" TEXT NOT NULL,
  "organisation_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "mobile_device_id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "session_version" INTEGER NOT NULL,
  "refresh_token_hash" TEXT NOT NULL,
  "replaced_by_session_id" TEXT,
  "family_expires_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMP(3),
  "revocation_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "mobile_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "push_deliveries" (
  "id" TEXT NOT NULL,
  "organisation_id" TEXT NOT NULL,
  "notification_id" TEXT NOT NULL,
  "mobile_device_id" TEXT NOT NULL,
  "status" "PushDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "expo_ticket_id" TEXT,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "sent_at" TIMESTAMP(3),
  "delivered_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "push_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mobile_devices_expo_push_token_key" ON "mobile_devices"("expo_push_token");
CREATE INDEX "mobile_devices_organisation_id_user_id_revoked_at_idx" ON "mobile_devices"("organisation_id", "user_id", "revoked_at");
CREATE INDEX "mobile_devices_organisation_id_last_seen_at_idx" ON "mobile_devices"("organisation_id", "last_seen_at");
CREATE UNIQUE INDEX "mobile_devices_organisation_id_id_key" ON "mobile_devices"("organisation_id", "id");
CREATE UNIQUE INDEX "mobile_devices_organisation_id_user_id_device_install_id_key" ON "mobile_devices"("organisation_id", "user_id", "device_install_id");

CREATE UNIQUE INDEX "mobile_sessions_refresh_token_hash_key" ON "mobile_sessions"("refresh_token_hash");
CREATE UNIQUE INDEX "mobile_sessions_replaced_by_session_id_key" ON "mobile_sessions"("replaced_by_session_id");
CREATE INDEX "mobile_sessions_organisation_id_user_id_revoked_at_idx" ON "mobile_sessions"("organisation_id", "user_id", "revoked_at");
CREATE INDEX "mobile_sessions_mobile_device_id_revoked_at_idx" ON "mobile_sessions"("mobile_device_id", "revoked_at");
CREATE INDEX "mobile_sessions_family_id_revoked_at_idx" ON "mobile_sessions"("family_id", "revoked_at");
CREATE INDEX "mobile_sessions_expires_at_idx" ON "mobile_sessions"("expires_at");
CREATE UNIQUE INDEX "mobile_sessions_organisation_id_id_key" ON "mobile_sessions"("organisation_id", "id");

CREATE INDEX "push_deliveries_organisation_id_status_created_at_idx" ON "push_deliveries"("organisation_id", "status", "created_at");
CREATE INDEX "push_deliveries_mobile_device_id_status_idx" ON "push_deliveries"("mobile_device_id", "status");
CREATE UNIQUE INDEX "push_deliveries_notification_id_mobile_device_id_key" ON "push_deliveries"("notification_id", "mobile_device_id");

CREATE UNIQUE INDEX "notifications_organisation_id_id_key" ON "notifications"("organisation_id", "id");

ALTER TABLE "mobile_devices"
  ADD CONSTRAINT "mobile_devices_organisation_id_fkey"
  FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mobile_devices"
  ADD CONSTRAINT "mobile_devices_organisation_id_user_id_fkey"
  FOREIGN KEY ("organisation_id", "user_id") REFERENCES "users"("organisation_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mobile_devices"
  ADD CONSTRAINT "mobile_devices_organisation_id_revoked_by_user_id_fkey"
  FOREIGN KEY ("organisation_id", "revoked_by_user_id") REFERENCES "users"("organisation_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "mobile_sessions"
  ADD CONSTRAINT "mobile_sessions_organisation_id_fkey"
  FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mobile_sessions"
  ADD CONSTRAINT "mobile_sessions_organisation_id_user_id_fkey"
  FOREIGN KEY ("organisation_id", "user_id") REFERENCES "users"("organisation_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mobile_sessions"
  ADD CONSTRAINT "mobile_sessions_organisation_id_mobile_device_id_fkey"
  FOREIGN KEY ("organisation_id", "mobile_device_id") REFERENCES "mobile_devices"("organisation_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "push_deliveries"
  ADD CONSTRAINT "push_deliveries_organisation_id_fkey"
  FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "push_deliveries"
  ADD CONSTRAINT "push_deliveries_organisation_id_notification_id_fkey"
  FOREIGN KEY ("organisation_id", "notification_id") REFERENCES "notifications"("organisation_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "push_deliveries"
  ADD CONSTRAINT "push_deliveries_organisation_id_mobile_device_id_fkey"
  FOREIGN KEY ("organisation_id", "mobile_device_id") REFERENCES "mobile_devices"("organisation_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
