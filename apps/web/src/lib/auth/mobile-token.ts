/**
 * CRELUNE — Mobile Access & Refresh Token Cryptographic Primitives (Node.js Runtime)
 *
 * Security Invariants (Stage 6.1):
 * - Mobile access tokens use an explicit 3-part wire format (`cln_mob_at.<payload>.<sig>`)
 *   and domain-separated HMAC-SHA256 signing input (`crelune.mobile_access.v1.<payload>`)
 *   backed by `SESSION_SECRET` (>= 32 chars, fail-closed, zero fallback secrets).
 * - Validates issuer (`crelune-api`), audience (`crelune-mobile`), token type (`mobile_access`),
 *   15-minute maximum lifetime (`<= 900s`), expiry, clock skew, sessionVersion, deviceId, and sessionId.
 * - Mobile refresh tokens are 256-bit cryptographically random secrets (`cln_mob_rt_<64-hex>`)
 *   stored server-side strictly as SHA-256 hex hashes.
 */

import crypto from 'node:crypto';
import {
  MOBILE_ACCESS_TOKEN_WIRE_PREFIX,
  MOBILE_ACCESS_TTL_SECONDS,
  MOBILE_REFRESH_TOKEN_PREFIX,
  MOBILE_TOKEN_AUDIENCE,
  MOBILE_TOKEN_ISSUER,
  MOBILE_TOKEN_TYPE,
  validateMobileAccessPayload,
  type MobileAccessTokenPayload,
} from '@crelune/shared';
import { getSecretKey, SESSION_COOKIE_NAME } from './session';

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const HMAC_SHA256_BYTES = 32;
export const MOBILE_ACCESS_SIGNING_DOMAIN = 'crelune.mobile_access.v1';

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

function signMobileAccessPayload(payloadEncoded: string, secret: string): Buffer {
  return crypto
    .createHmac('sha256', secret)
    .update(`${MOBILE_ACCESS_SIGNING_DOMAIN}.${payloadEncoded}`, 'utf8')
    .digest();
}

export interface CreateMobileAccessTokenParams {
  userId: string;
  organisationId: string;
  sessionVersion: number;
  mobileDeviceId: string;
  mobileSessionId: string;
  nowSeconds?: number;
  /** Optional lower cap (e.g. remaining seconds until 30-day family cap); clamped to 1..900s. */
  ttlSeconds?: number;
}

export function createMobileAccessToken(
  params: CreateMobileAccessTokenParams
): {
  token: string;
  expiresAt: Date;
  payload: MobileAccessTokenPayload;
} {
  const secret = getSecretKey();
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const requestedTtl = params.ttlSeconds ?? MOBILE_ACCESS_TTL_SECONDS;
  const clampedTtl = Math.max(
    1,
    Math.min(MOBILE_ACCESS_TTL_SECONDS, Math.floor(requestedTtl))
  );

  const payload: MobileAccessTokenPayload = {
    typ: MOBILE_TOKEN_TYPE,
    iss: MOBILE_TOKEN_ISSUER,
    aud: MOBILE_TOKEN_AUDIENCE,
    sub: params.userId,
    role: 'OWNER',
    org: params.organisationId,
    ver: params.sessionVersion,
    dev: params.mobileDeviceId,
    sid: params.mobileSessionId,
    jti: crypto.randomBytes(16).toString('hex'),
    iat: now,
    exp: now + clampedTtl,
  };

  const payloadEncoded = base64UrlEncodeBytes(
    Buffer.from(JSON.stringify(payload), 'utf8')
  );
  const signature = base64UrlEncodeBytes(
    signMobileAccessPayload(payloadEncoded, secret)
  );

  return {
    token: `${MOBILE_ACCESS_TOKEN_WIRE_PREFIX}.${payloadEncoded}.${signature}`,
    expiresAt: new Date(payload.exp * 1000),
    payload,
  };
}

/**
 * Verifies a signed mobile access token in constant time.
 * Fails closed (returns null) if secret is invalid, wire prefix mismatches,
 * signature fails, or any claim/issuer/audience/type/lifetime check fails.
 */
export function verifyMobileAccessToken(
  token: string | undefined,
  nowSeconds?: number
): MobileAccessTokenPayload | null {
  if (!token || typeof token !== 'string') {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [prefix, payloadEncoded, signature] = parts;
  if (prefix !== MOBILE_ACCESS_TOKEN_WIRE_PREFIX || !payloadEncoded || !signature) {
    return null;
  }
  if (!BASE64URL_PATTERN.test(payloadEncoded)) {
    return null;
  }

  const sigBytes = decodeBase64UrlStrict(signature);
  if (!sigBytes || sigBytes.byteLength !== HMAC_SHA256_BYTES) {
    return null;
  }

  try {
    const secret = getSecretKey();
    const expectedSigBytes = signMobileAccessPayload(payloadEncoded, secret);

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
    return validateMobileAccessPayload(parsedJson, nowSeconds);
  } catch {
    return null;
  }
}

export function hashMobileRefreshToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function generateMobileRefreshToken(): {
  rawToken: string;
  tokenHash: string;
} {
  const rawToken = `${MOBILE_REFRESH_TOKEN_PREFIX}${crypto.randomBytes(32).toString('hex')}`;
  return {
    rawToken,
    tokenHash: hashMobileRefreshToken(rawToken),
  };
}

export interface BearerHeaderExtraction {
  present: boolean;
  token: string | null;
  malformed: boolean;
}

/**
 * Extracts a strict `Authorization: Bearer <token>` header.
 * Never reads tokens from URL query parameters.
 */
export function extractBearerTokenHeader(request: Request): BearerHeaderExtraction {
  const rawHeader = request.headers.get('authorization');
  if (rawHeader === null) {
    return { present: false, token: null, malformed: false };
  }

  const trimmed = rawHeader.trim();
  if (!trimmed) {
    return { present: true, token: null, malformed: true };
  }

  const match = /^Bearer\s+(\S+)$/i.exec(trimmed);
  if (!match || !match[1]) {
    return { present: true, token: null, malformed: true };
  }

  return { present: true, token: match[1], malformed: false };
}

/**
 * Checks whether the incoming request carries a `crelune_session` cookie header.
 */
export function hasSessionCookieHeader(request: Request): boolean {
  const rawCookie = request.headers.get('cookie');
  if (!rawCookie) return false;

  const segments = rawCookie.split(';');
  for (const seg of segments) {
    const idx = seg.indexOf('=');
    if (idx === -1) continue;
    const name = seg.slice(0, idx).trim();
    const val = seg.slice(idx + 1).trim();
    if (name === SESSION_COOKIE_NAME && val.length > 0) {
      return true;
    }
  }
  return false;
}
