/**
 * CRELUNE — Owner API Authentication, CSRF & Bounded JSON Parsing Helpers
 */

import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/auth/session';
import { validateRequestOrigin } from '@/lib/auth/csrf';
import {
  resolveAuthenticatedOwner,
  type AuthenticatedOwner,
} from '@/lib/auth/owner-guard';

export const DEFAULT_MAX_API_BODY_BYTES = 16 * 1024; // 16 KB

export type ApiOwnerGuardResult =
  | { ok: true; owner: AuthenticatedOwner }
  | { ok: false; response: NextResponse };

export type ParsedJsonResult =
  | { ok: true; data: unknown }
  | { ok: false; response: NextResponse };

/**
 * Enforces active owner authentication (with server-side DB revocation check)
 * and optional Origin/Referer CSRF validation for state-changing requests.
 */
export async function requireAuthenticatedOwnerApi(
  request: Request,
  options: { verifyCsrf?: boolean } = {}
): Promise<ApiOwnerGuardResult> {
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
