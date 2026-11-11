/**
 * CRELUNE — Scheduled Cron Endpoint Bearer Authentication
 *
 * Validates `CRON_SECRET` via Authorization Bearer header using constant-time SHA-256
 * comparison. Fails closed when `CRON_SECRET` is unset, rejects query-string secret
 * attempts, and never logs or echoes secrets.
 */

import crypto from 'node:crypto';
import { NextResponse } from 'next/server';

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
};

export type CronAuthResult =
  | { ok: true }
  | { ok: false; response: NextResponse };

function sha256Digest(value: string): Buffer {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

function isPlaceholderCronSecret(value: string): boolean {
  const lower = value.toLowerCase();
  return lower.startsWith('replace-with-') || lower === 'changeme' || lower === 'example';
}

export function verifyCronBearerRequest(
  request: Request,
  env: Record<string, string | undefined> = process.env
): CronAuthResult {
  const configuredSecret = (env.CRON_SECRET || '').trim();
  if (!configuredSecret || isPlaceholderCronSecret(configuredSecret)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Service unavailable: Cron authentication is not configured.' },
        { status: 503, headers: NO_STORE_HEADERS }
      ),
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(request.url);
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Invalid request URL.' },
        { status: 400, headers: NO_STORE_HEADERS }
      ),
    };
  }

  // Never accept secrets or unexpected parameters in query strings
  if (parsedUrl.search.length > 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Unauthorized: Query parameters are not permitted on cron endpoints.' },
        { status: 401, headers: NO_STORE_HEADERS }
      ),
    };
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Unauthorized: Missing bearer authorization.' },
        { status: 401, headers: NO_STORE_HEADERS }
      ),
    };
  }

  const match = /^Bearer\s+(\S+)$/i.exec(authHeader.trim());
  if (!match || !match[1]) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Unauthorized: Invalid authorization scheme.' },
        { status: 401, headers: NO_STORE_HEADERS }
      ),
    };
  }

  const providedToken = match[1];
  const expectedDigest = sha256Digest(configuredSecret);
  const providedDigest = sha256Digest(providedToken);

  if (!crypto.timingSafeEqual(expectedDigest, providedDigest)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Unauthorized: Invalid cron credentials.' },
        { status: 401, headers: NO_STORE_HEADERS }
      ),
    };
  }

  return { ok: true };
}

