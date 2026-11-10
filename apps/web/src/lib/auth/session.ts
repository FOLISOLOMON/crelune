/**
 * CRELUNE — Cryptographically Signed Session Management
 *
 * Provides tamper-proof session tokens signed with HMAC-SHA256 and secure cookie serialization.
 */

import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import type { OwnerSession, OwnerUser } from '@crelune/shared';

export const SESSION_COOKIE_NAME = 'crelune_session';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

function getSecretKey(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV !== 'production') {
      return 'crelune-dev-session-secret-fallback-at-least-32-characters-long';
    }
    throw new Error(
      'SESSION_SECRET environment variable is missing or less than 32 characters.'
    );
  }
  return secret;
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str: string): string {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) {
    str += '=';
  }
  return Buffer.from(str, 'base64').toString('utf8');
}

function sign(payloadStr: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(payloadStr)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Creates a signed, tamper-evident session token.
 */
export function createSessionToken(user: OwnerUser): string {
  const secret = getSecretKey();
  const now = Math.floor(Date.now() / 1000);
  const session: OwnerSession = {
    userId: user.id,
    email: user.email,
    organisationId: user.organisationId,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    issuedAt: now,
    expiresAt: now + SESSION_TTL_SECONDS,
  };

  const payloadEncoded = base64UrlEncode(JSON.stringify(session));
  const signature = sign(payloadEncoded, secret);
  return `${payloadEncoded}.${signature}`;
}

/**
 * Verifies a session token signature and expiration.
 * Returns decoded OwnerSession or null if invalid or expired.
 */
export function verifySessionToken(token: string | undefined): OwnerSession | null {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadEncoded, signature] = parts;
  if (!payloadEncoded || !signature) return null;

  try {
    const secret = getSecretKey();
    const expectedSignature = sign(payloadEncoded, secret);

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSignature);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    const payloadJson = base64UrlDecode(payloadEncoded);
    const session: OwnerSession = JSON.parse(payloadJson);

    const now = Math.floor(Date.now() / 1000);
    if (session.expiresAt && session.expiresAt < now) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

/**
 * Retrieves and validates the current session from incoming request cookies.
 */
export async function getSession(): Promise<OwnerSession | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);
  if (!sessionCookie?.value) {
    return null;
  }
  return verifySessionToken(sessionCookie.value);
}

/**
 * Sets the session cookie on outgoing response.
 */
export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

/**
 * Clears the session cookie to securely log out.
 */
export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}
