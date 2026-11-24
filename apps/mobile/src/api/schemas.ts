/**
 * CRELUNE Mobile — Strict Zod Validators for Backend API Payloads
 *
 * Ensures every response received over HTTPS is validated at the mobile client
 * boundary before entering SecureStore or UI state.
 */

import {
  MOBILE_ACCESS_TOKEN_WIRE_PREFIX,
  MOBILE_PLATFORMS,
  MOBILE_REFRESH_TOKEN_REGEX,
  type DashboardSnapshotResponse,
  type MobileAuthSessionResponse,
} from '@crelune/shared';
import { z } from 'zod';

const isoDateTimeString = z.string().min(10).max(64);

export const mobileDeviceSummarySchema = z.object({
  id: z.string().min(1),
  platform: z.enum(MOBILE_PLATFORMS),
  deviceName: z.string().nullable(),
  osVersion: z.string().nullable(),
  appVersion: z.string().nullable(),
  hasPushToken: z.boolean(),
  pushPermissionStatus: z.string().nullable(),
  pushEnabled: z.boolean(),
  status: z.enum(['ACTIVE', 'REVOKED']),
  activeSessionCount: z.number().int().min(0),
  lastSeenAt: isoDateTimeString,
  revokedAt: isoDateTimeString.nullable(),
  revocationReason: z.string().nullable(),
  createdAt: isoDateTimeString,
});

export const mobileAuthUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  role: z.string().min(1),
  organisationId: z.string().min(1),
  organisationName: z.string().min(1),
  timezone: z.string().min(1),
});

export const mobileAuthSessionResponseSchema: z.ZodType<MobileAuthSessionResponse> =
  z.object({
    accessToken: z
      .string()
      .refine(
        (v) => v.startsWith(`${MOBILE_ACCESS_TOKEN_WIRE_PREFIX}.`),
        'Invalid mobile access token format.'
      ),
    accessTokenExpiresAt: isoDateTimeString,
    refreshToken: z.string().regex(MOBILE_REFRESH_TOKEN_REGEX),
    refreshTokenExpiresAt: isoDateTimeString,
    tokenType: z.literal('Bearer'),
    device: mobileDeviceSummarySchema,
    user: mobileAuthUserSchema,
  });

export const mobileLogoutResponseSchema = z.object({
  success: z.boolean(),
  revokedSessions: z.number().int().min(0),
});

export const authMeResponseSchema = z.object({
  authenticated: z.literal(true),
  authMethod: z.enum(['cookie', 'mobile_bearer']).optional(),
  deviceId: z.string().optional(),
  user: z.object({
    userId: z.string().min(1),
    email: z.string().email(),
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    role: z.string().min(1),
    organisationId: z.string().min(1),
    organisationName: z.string().min(1),
  }),
});

export const dashboardSnapshotResponseSchema: z.ZodType<DashboardSnapshotResponse> =
  z.object({
    activeMembersCount: z.number().int().min(0),
    activeTemplatesCount: z.number().int().min(0),
    birthdayCounts: z.object({
      totalWithBirthday: z.number().int().min(0),
      todayCount: z.number().int().min(0),
      weekCount: z.number().int().min(0),
      monthCount: z.number().int().min(0),
      upcomingCount: z.number().int().min(0),
      awaitingPrepCount: z.number().int().min(0),
    }),
    upcomingBirthdays: z.array(z.any()),
    unreadNotificationsCount: z.number().int().min(0),
    recentNotifications: z.array(z.any()),
    activeDesignJobsCount: z.number().int().min(0),
    awaitingReviewCount: z.number().int().min(0),
    recentDesignJobs: z.array(z.any()),
    dbHealth: z.object({
      connected: z.boolean(),
      latencyMs: z.number().optional(),
    }),
  }) as unknown as z.ZodType<DashboardSnapshotResponse>;

export const apiErrorBodySchema = z.object({
  error: z.string().optional(),
  code: z.string().optional(),
});
