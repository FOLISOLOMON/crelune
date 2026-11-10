/**
 * CRELUNE — Shared Authentication Validation Schemas
 */

import { z } from 'zod';

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
 * Enforces role='OWNER', positive integer timestamps, and non-empty IDs.
 */
export const sessionTokenPayloadSchema = z.object({
  sub: z.string().min(1, 'Subject claim is required'),
  role: z.literal('OWNER'),
  org: z.string().min(1, 'Organisation claim is required'),
  iat: z.number().int().positive('Issued at must be a positive integer timestamp'),
  exp: z.number().int().positive('Expires at must be a positive integer timestamp'),
});

export type SessionTokenPayloadSchema = z.infer<typeof sessionTokenPayloadSchema>;

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
