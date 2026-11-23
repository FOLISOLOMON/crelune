/**
 * CRELUNE — Owner API Authentication, CSRF & Bounded JSON Parsing Helpers
 */

import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/auth/session';
import { validateRequestOrigin } from '@/lib/auth/csrf';
import {
  extractBearerTokenHeader,
  hasSessionCookieHeader,
  verifyMobileAccessToken,
} from '@/lib/auth/mobile-token';
import {
  resolveAuthenticatedOwner,
  verifyActiveMobileOwnerInDatabase,
  type AuthenticatedOwner,
  type OwnerAuthMethod,
} from '@/lib/auth/owner-guard';

export const DEFAULT_MAX_API_BODY_BYTES = 16 * 1024; // 16 KB
const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;

export type ApiOwnerGuardResult =
  | { ok: true; owner: AuthenticatedOwner }
  | { ok: false; response: NextResponse };

export type ParsedJsonResult =
  | { ok: true; data: unknown }
  | { ok: false; response: NextResponse };

/**
 * Unified owner API guard supporting two explicitly separated authentication transports:
 *
 * 1. **CRELUNE Mobile (`Authorization: Bearer cln_mob_at.<payload>.<sig>`):**
 *    - Rejects mixed Cookie + Authorization headers fail-closed (`400`).
 *    - Validates signature, issuer, audience, token type, 15m TTL, and PostgreSQL
 *      User/MobileDevice/MobileSession bindings (never uses browser cookies).
 *    - Does not require browser Origin/Referer CSRF headers because Bearer headers
 *      are never attached ambiently by cross-site browser requests.
 *
 * 2. **CRELUNE Web (`crelune_session` HttpOnly Cookie):**
 *    - Preserves existing DB active-owner + sessionVersion verification verbatim.
 *    - Enforces mandatory Origin/Referer CSRF validation whenever `verifyCsrf: true`.
 */
export async function requireAuthenticatedOwnerApi(
  request: Request,
  options: {
    verifyCsrf?: boolean;
    allowedAuthMethods?: ReadonlyArray<OwnerAuthMethod>;
  } = {}
): Promise<ApiOwnerGuardResult> {
  const allowedMethods = options.allowedAuthMethods ?? ['cookie', 'mobile_bearer'];
  const bearer = extractBearerTokenHeader(request);
  const hasCookieHeader = hasSessionCookieHeader(request);

  if (bearer.present && hasCookieHeader) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            'Bad Request: Ambiguous authentication credentials; send either a session cookie or a Bearer token, not both.',
          code: 'AMBIGUOUS_AUTH_CREDENTIALS',
        },
        { status: 400, headers: NO_STORE_HEADERS }
      ),
    };
  }

  // Explicit Mobile Bearer authentication path (completely separated from Web Cookie/CSRF)
  if (bearer.present) {
    if (!allowedMethods.includes('mobile_bearer')) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Unauthorized: Bearer authentication is not permitted for this endpoint' },
          { status: 401, headers: NO_STORE_HEADERS }
        ),
      };
    }

    if (bearer.malformed || !bearer.token) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Unauthorized: Invalid Authorization header format' },
          { status: 401, headers: NO_STORE_HEADERS }
        ),
      };
    }

    const verifiedToken = verifyMobileAccessToken(bearer.token);
    if (!verifiedToken) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Unauthorized: Invalid or expired mobile access token' },
          { status: 401, headers: NO_STORE_HEADERS }
        ),
      };
    }

    const mobileAuth = await verifyActiveMobileOwnerInDatabase(verifiedToken);
    if (mobileAuth.status !== 'authenticated') {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Unauthorized: Mobile session inactive or revoked' },
          { status: 401, headers: NO_STORE_HEADERS }
        ),
      };
    }

    return { ok: true, owner: mobileAuth.owner };
  }

  // Existing CRELUNE Web Cookie + CSRF authentication path (preserved strictly)
  if (!allowedMethods.includes('cookie')) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Unauthorized: Mobile Bearer authentication required' },
        { status: 401, headers: NO_STORE_HEADERS }
      ),
    };
  }

  const auth = await resolveAuthenticatedOwner();

  if (auth.status === 'revoked') {
    await clearSessionCookie();
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Unauthorized: Session inactive or revoked' },
        { status: 401 }
      ),
    };
  }

  if (auth.status !== 'authenticated') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Unauthorized: Owner authentication required' },
        { status: 401 }
      ),
    };
  }

  if (options.verifyCsrf) {
    const originCheck = validateRequestOrigin(request);
    if (!originCheck.allowed) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Forbidden: Cross-site request rejected' },
          { status: 403 }
        ),
      };
    }
  }

  return { ok: true, owner: auth.owner };
}

/**
 * Safely reads and parses a JSON request body within a strict byte limit.
 */
export async function parseJsonBodyWithLimit(
  request: Request,
  maxBytes: number = DEFAULT_MAX_API_BODY_BYTES
): Promise<ParsedJsonResult> {
  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader) {
    const declaredLength = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Payload too large' },
          { status: 413 }
        ),
      };
    }
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      ),
    };
  }

  if (Buffer.byteLength(rawBody, 'utf8') > maxBytes) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Payload too large' },
        { status: 413 }
      ),
    };
  }

  if (!rawBody.trim()) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Invalid JSON request body' },
        { status: 400 }
      ),
    };
  }

  try {
    return { ok: true, data: JSON.parse(rawBody) };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Invalid JSON request body' },
        { status: 400 }
      ),
    };
  }
}
