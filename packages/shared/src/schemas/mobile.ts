/**
 * CRELUNE — Shared Mobile Authentication, Device, Preferences & Deep-Link Contracts (Stage 6.1)
 *
 * Pure TypeScript + Zod contracts consumable by both `apps/web` and future `apps/mobile`
 * without Node.js built-ins or server secrets.
 */

import { z } from 'zod';
import { loginSchema, MAX_CLOCK_SKEW_SECONDS } from './auth.js';
import type {
  BirthdayCalendarMemberItem,
  BirthdayOverviewCounts,
  NotificationItem,
} from './birthday.js';
import type { DesignJobSummary } from './design-job.js';

export const MOBILE_PLATFORMS = ['IOS', 'ANDROID'] as const;
export type MobilePlatform = (typeof MOBILE_PLATFORMS)[number];

export const PUSH_DELIVERY_STATUSES = [
  'PENDING',
  'TICKET_ACCEPTED',
  'DELIVERED',
  'FAILED',
  'DEVICE_UNREGISTERED',
] as const;
export type PushDeliveryStatus = (typeof PUSH_DELIVERY_STATUSES)[number];

/** Short-lived mobile access token maximum TTL: strictly 15 minutes (900s). */
export const MOBILE_ACCESS_TTL_SECONDS = 15 * 60;

/** Hard maximum session family lifetime: strictly 30 days (2,592,000s). */
export const MOBILE_REFRESH_MAX_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

export const MOBILE_TOKEN_ISSUER = 'crelune-api' as const;
export const MOBILE_TOKEN_AUDIENCE = 'crelune-mobile' as const;
export const MOBILE_TOKEN_TYPE = 'mobile_access' as const;
export const MOBILE_ACCESS_TOKEN_WIRE_PREFIX = 'cln_mob_at' as const;
export const MOBILE_REFRESH_TOKEN_PREFIX = 'cln_mob_rt_' as const;

export const MOBILE_REFRESH_TOKEN_REGEX = /^cln_mob_rt_[a-f0-9]{64}$/;
export const MOBILE_SAFE_ID_REGEX = /^[a-zA-Z0-9_-]{8,80}$/;
export const MOBILE_DEVICE_INSTALL_ID_REGEX = /^[a-zA-Z0-9_-]{16,80}$/;

const optionalTrimmedLabel = (maxLen: number) =>
  z.preprocess((val) => {
    if (val === undefined) return undefined;
    if (val === null) return null;
    if (typeof val === 'string') {
      const trimmed = val.trim();
      return trimmed.length === 0 ? null : trimmed;
    }
    return val;
  }, z.string().max(maxLen).nullable().optional());

export const mobileDeviceIdParamSchema = z
  .string()
  .trim()
  .regex(MOBILE_SAFE_ID_REGEX, 'Invalid mobile device identifier.');

export const mobileDeviceInstallIdSchema = z
  .string()
  .trim()
  .regex(
    MOBILE_DEVICE_INSTALL_ID_REGEX,
    'Device installation identifier must be 16-80 safe alphanumeric, hyphen, or underscore characters.'
  );

export const mobileDeviceMetadataSchema = z
  .object({
    deviceInstallId: mobileDeviceInstallIdSchema,
    platform: z.enum(MOBILE_PLATFORMS),
    deviceName: optionalTrimmedLabel(120),
    osVersion: optionalTrimmedLabel(60),
    appVersion: optionalTrimmedLabel(40),
  })
  .strict();

export type MobileDeviceMetadataInput = z.infer<typeof mobileDeviceMetadataSchema>;

export const mobileLoginSchema = z
  .object({
    email: loginSchema.shape.email,
    password: loginSchema.shape.password,
    device: mobileDeviceMetadataSchema,
  })
  .strict();

export type MobileLoginInput = z.infer<typeof mobileLoginSchema>;

export const mobileRefreshSchema = z
  .object({
    refreshToken: z
      .string()
      .trim()
      .regex(MOBILE_REFRESH_TOKEN_REGEX, 'Invalid refresh token format.'),
    deviceInstallId: mobileDeviceInstallIdSchema,
  })
  .strict();

export type MobileRefreshInput = z.infer<typeof mobileRefreshSchema>;

export const mobileLogoutSchema = z.object({}).strict();
export type MobileLogoutInput = z.infer<typeof mobileLogoutSchema>;

export const revokeMobileDeviceSchema = z
  .object({
    reason: optionalTrimmedLabel(240),
  })
  .strict();

export type RevokeMobileDeviceInput = z.infer<typeof revokeMobileDeviceSchema>;

export const notificationPreferencesUpdateSchema = z
  .object({
    pushNotificationsEnabled: z.boolean(),
    pushBirthdayReminders: z.boolean(),
    pushDesignUpdates: z.boolean(),
  })
  .strict();

export type NotificationPreferencesUpdateInput = z.infer<
  typeof notificationPreferencesUpdateSchema
>;

export interface NotificationPreferencesDto {
  pushNotificationsEnabled: boolean;
  pushBirthdayReminders: boolean;
  pushDesignUpdates: boolean;
}

/**
 * Strict signed payload for short-lived 15-minute mobile access tokens.
 * Contains zero PII and binds explicitly to issuer, audience, token type,
 * user sessionVersion, mobileDeviceId, and active mobileSessionId.
 */
export const mobileAccessTokenPayloadSchema = z
  .object({
    typ: z.literal(MOBILE_TOKEN_TYPE),
    iss: z.literal(MOBILE_TOKEN_ISSUER),
    aud: z.literal(MOBILE_TOKEN_AUDIENCE),
    sub: z.string().regex(MOBILE_SAFE_ID_REGEX),
    role: z.literal('OWNER'),
    org: z.string().regex(MOBILE_SAFE_ID_REGEX),
    ver: z.number().int().positive(),
    dev: z.string().regex(MOBILE_SAFE_ID_REGEX),
    sid: z.string().regex(MOBILE_SAFE_ID_REGEX),
    jti: z.string().regex(/^[a-zA-Z0-9_-]{16,80}$/),
    iat: z.number().int().positive(),
    exp: z.number().int().positive(),
  })
  .strict();

export type MobileAccessTokenPayload = z.infer<
  typeof mobileAccessTokenPayloadSchema
>;

/**
 * Shared validator for mobile access token claims, issuer, audience, token type,
 * lifetime bounds (`<= 900s`), expiration, and clock skew (`<= 60s`).
 * Identical across Node.js route handlers and Edge Web Crypto middleware.
 */
export function validateMobileAccessPayload(
  parsed: unknown,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): MobileAccessTokenPayload | null {
  const result = mobileAccessTokenPayloadSchema.safeParse(parsed);
  if (!result.success) {
    return null;
  }

  const payload = result.data;
  if (payload.exp <= payload.iat) return null;
  if (payload.exp - payload.iat > MOBILE_ACCESS_TTL_SECONDS) return null;
  if (payload.exp <= nowSeconds) return null;
  if (payload.iat > nowSeconds + MAX_CLOCK_SKEW_SECONDS) return null;

  return payload;
}

export interface MobileDeviceSummary {
  id: string;
  platform: MobilePlatform;
  deviceName: string | null;
  osVersion: string | null;
  appVersion: string | null;
  hasPushToken: boolean;
  pushPermissionStatus: string | null;
  pushEnabled: boolean;
  status: 'ACTIVE' | 'REVOKED';
  activeSessionCount: number;
  lastSeenAt: string;
  revokedAt: string | null;
  revocationReason: string | null;
  createdAt: string;
}

export interface MobileAuthSessionResponse {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  tokenType: 'Bearer';
  device: MobileDeviceSummary;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    organisationId: string;
    organisationName: string;
    timezone: string;
  };
}

export interface DashboardSnapshotResponse {
  activeMembersCount: number;
  activeTemplatesCount: number;
  birthdayCounts: BirthdayOverviewCounts;
  upcomingBirthdays: BirthdayCalendarMemberItem[];
  unreadNotificationsCount: number;
  recentNotifications: NotificationItem[];
  activeDesignJobsCount: number;
  awaitingReviewCount: number;
  recentDesignJobs: DesignJobSummary[];
  dbHealth: {
    connected: boolean;
    latencyMs?: number;
  };
}

/**
 * Strict Zod validator for mobile notification & deep-link navigation payloads.
 * Rejects arbitrary URLs, traversal segments, and unexpected fields fail-closed.
 */
export const mobileDeepLinkPayloadSchema = z.discriminatedUnion('target', [
  z
    .object({
      version: z.literal(1),
      kind: z.literal('BIRTHDAY_REMINDER'),
      target: z.literal('member'),
      memberId: z.string().regex(MOBILE_SAFE_ID_REGEX),
      notificationId: z.string().regex(MOBILE_SAFE_ID_REGEX).optional(),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      kind: z.literal('DESIGN_UPDATE'),
      target: z.literal('design'),
      designJobId: z.string().regex(MOBILE_SAFE_ID_REGEX),
      notificationId: z.string().regex(MOBILE_SAFE_ID_REGEX).optional(),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      kind: z.literal('SYSTEM'),
      target: z.literal('notifications'),
      notificationId: z.string().regex(MOBILE_SAFE_ID_REGEX).optional(),
    })
    .strict(),
]);

export type MobileDeepLinkPayload = z.infer<typeof mobileDeepLinkPayloadSchema>;
