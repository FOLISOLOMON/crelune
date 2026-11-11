/**
 * CRELUNE — Cryptographically Signed Session Management
 *
 * Provides tamper-proof session tokens signed with HMAC-SHA256 and secure cookie serialization.
 * Session tokens are cryptographically signed (integrity-protected), not encrypted.
 */

import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import type { OwnerSession } from '@crelune/shared';
import {
  SESSION_TTL_SECONDS,
  validateSessionPayload,
} from '@crelune/shared';

export const SESSION_COOKIE_NAME = 'crelune_session';
export { SESSION_TTL_SECONDS };

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const HMAC_SHA256_BYTES = 32;

export function getSecretKey(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'SESSION_SECRET environment variable is missing or less than 32 characters.'
    );
  }
  return secret;
}

function base64UrlEncodeBytes(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function decodeBase64UrlStrict(str: string): Buffer | null {
  if (!str || !BASE64URL_PATTERN.test(str)) {
    return null;
  }
  let padded = str.replace(/-/g, '+').replace(/_/g, '/');
  if (padded.length % 4 === 1) {
    return null;
  }
  while (padded.length % 4) {
    padded += '=';
  }
  return Buffer.from(padded, 'base64');
}

function signDigest(payloadStr: string, secret: string): Buffer {
  return crypto
    .createHmac('sha256', secret)
    .update(payloadStr, 'utf8')
    .digest();
}

/**
 * Creates a signed, tamper-evident session token with minimal claims (no PII).
 */
export function createSessionToken(user: {
  id: string;
  organisationId: string;
  sessionVersion?: number;
}): string {
  const secret = getSecretKey();
  const now = Math.floor(Date.now() / 1000);
  const session: OwnerSession = {
    sub: user.id,
    role: 'OWNER',
    org: user.organisationId,
    ver: user.sessionVersion ?? 1,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };

  const payloadEncoded = base64UrlEncodeBytes(Buffer.from(JSON.stringify(session), 'utf8'));
  const signature = base64UrlEncodeBytes(signDigest(payloadEncoded, secret));
  return `${payloadEncoded}.${signature}`;
}

/**
 * Verifies a session token signature, structure, and lifetime bounds.
 * Fails closed and returns null on any discrepancy or missing secret.
 */
export function verifySessionToken(
  token: string | undefined,
  nowSeconds?: number
): OwnerSession | null {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadEncoded, signature] = parts;
  if (!payloadEncoded || !signature) return null;
  if (!BASE64URL_PATTERN.test(payloadEncoded)) return null;

  const sigBytes = decodeBase64UrlStrict(signature);
  if (!sigBytes || sigBytes.byteLength !== HMAC_SHA256_BYTES) {
    return null;
  }

  try {
    const secret = getSecretKey();
    const expectedSigBytes = signDigest(payloadEncoded, secret);

    if (
      sigBytes.byteLength !== expectedSigBytes.byteLength ||
      !crypto.timingSafeEqual(sigBytes, expectedSigBytes)
    ) {
      return null;
    }

    const payloadBytes = decodeBase64UrlStrict(payloadEncoded);
    if (!payloadBytes) {
      return null;
    }

    const parsedJson = JSON.parse(payloadBytes.toString('utf8'));
    return validateSessionPayload(parsedJson, nowSeconds);
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
