/**
 * CRELUNE — Shared Authentication Validation Schemas
 */

import { z } from 'zod';

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days (604800s)
export const MAX_CLOCK_SKEW_SECONDS = 60; // Maximum allowed future iat skew

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Email is required')
    .email('Please enter a valid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters long')
    .max(128, 'Password must not exceed 128 characters'),
});

export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Strict schema for session token payload validation.
 * Enforces role='OWNER', positive integer version and timestamps, and rejects extra claims.
 */
export const sessionTokenPayloadSchema = z
  .object({
    sub: z.string().min(1, 'Subject claim is required'),
    role: z.literal('OWNER'),
    org: z.string().min(1, 'Organisation claim is required'),
    ver: z.number().int().positive('Session version must be a positive integer'),
    iat: z.number().int().positive('Issued at must be a positive integer timestamp'),
    exp: z.number().int().positive('Expires at must be a positive integer timestamp'),
  })
  .strict();

export type SessionTokenPayloadSchema = z.infer<typeof sessionTokenPayloadSchema>;

/**
 * Validates decoded session token payload structure and lifetime bounds.
 * Shared identically across Node.js and Web Crypto Edge runtimes.
 */
export function validateSessionPayload(
  parsed: unknown,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): SessionTokenPayloadSchema | null {
  const result = sessionTokenPayloadSchema.safeParse(parsed);
  if (!result.success) {
    return null;
  }

  const session = result.data;

  // Reject malformed or inverted lifetimes
  if (session.exp <= session.iat) return null;

  // Enforce configured maximum session lifetime (TTL)
  if (session.exp - session.iat > SESSION_TTL_SECONDS) return null;

  // Reject expired tokens (RFC 7519: current time must be strictly before exp)
  if (session.exp <= nowSeconds) return null;

  // Reject tokens issued too far in the future (clock skew protection)
  if (session.iat > nowSeconds + MAX_CLOCK_SKEW_SECONDS) return null;

  if (session.role !== 'OWNER') return null;

  return session;
}

const TRIVIAL_PASSWORDS = new Set([
  'password',
  '12345678',
  'admin123',
  'admin1234',
  'crelune123',
  'crelune2024',
  'crelune2025',
  'crelune2026',
  'qwerty123',
  'qwertyuiop',
  'password123',
]);

/**
 * Validates password strength:
 * - Minimum 8 characters
 * - Maximum 128 characters
 * - Rejects trivial / dictionary passwords
 */
export function validatePasswordStrength(pwd: string): string | null {
  if (!pwd || pwd.length < 8) {
    return 'Password must be at least 8 characters long.';
  }
  if (pwd.length > 128) {
    return 'Password must not exceed 128 characters.';
  }
  if (TRIVIAL_PASSWORDS.has(pwd.toLowerCase())) {
    return 'Password is too common or trivial. Please choose a strong passphrase.';
  }
  return null;
}

/**
 * Validates a redirect callback URL to prevent open redirect vulnerabilities.
 * - Must start with a single '/'
 * - Must NOT start with '//' or '/\'
 * - Must NOT contain ':' (preventing external schemes like javascript:, https:, etc.)
 */
export function isValidCallbackUrl(url: unknown): boolean {
  if (typeof url !== 'string' || !url) return false;
  if (!url.startsWith('/')) return false;
  if (url.startsWith('//') || url.startsWith('/\\')) return false;
  if (url.includes(':')) return false;
  return true;
}
