/**
 * CRELUNE — Shared HTTP Helpers for Birthday Engine & Notification API Routes
 */

import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import {
  birthdaySyncRequestSchema,
  notificationIdParamSchema,
} from '@crelune/shared';
import { DEFAULT_MAX_API_BODY_BYTES } from '@/lib/auth/api-owner-guard';
import { InvalidBirthdayPreferencesError } from '@/lib/birthdays/birthday-preferences';
import {
  MemberNotFoundError,
  MemberValidationError,
} from '@/lib/members/member-service';
import { NotificationNotFoundError } from '@/lib/notifications/notification-service';

const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
};

export function privateJsonResponse(body: unknown, status: number = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: PRIVATE_NO_STORE_HEADERS,
  });
}

export function birthdayValidationErrorResponse(error: ZodError): NextResponse {
  const firstIssue = error.issues[0];
  return privateJsonResponse(
    {
      error: firstIssue?.message ?? 'Validation failed',
      code: 'VALIDATION_ERROR',
      issues: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    },
    400
  );
}

export function parseNotificationIdOrError(
  rawId: string
): { ok: true; id: string } | { ok: false; response: NextResponse } {
  const parsed = notificationIdParamSchema.safeParse(rawId);
  if (!parsed.success) {
    return { ok: false, response: birthdayValidationErrorResponse(parsed.error) };
  }
  return { ok: true, id: parsed.data };
}

/**
 * Accepts either an empty request body or strict `{}` JSON object within byte limits,
 * rejecting malformed JSON, oversized payloads, or client-supplied override fields.
 */
export async function parseStrictEmptyBodyOrError(
  request: Request,
  maxBytes: number = DEFAULT_MAX_API_BODY_BYTES
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader) {
    const declared = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(declared) && declared > maxBytes) {
      return {
        ok: false,
        response: privateJsonResponse({ error: 'Payload too large' }, 413),
      };
    }
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return {
      ok: false,
      response: privateJsonResponse({ error: 'Invalid request body' }, 400),
    };
  }

  if (Buffer.byteLength(rawBody, 'utf8') > maxBytes) {
    return {
      ok: false,
      response: privateJsonResponse({ error: 'Payload too large' }, 413),
    };
  }

  if (!rawBody.trim()) {
    return { ok: true };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return {
      ok: false,
      response: privateJsonResponse({ error: 'Invalid JSON request body' }, 400),
    };
  }

  const schemaCheck = birthdaySyncRequestSchema.safeParse(parsedJson);
  if (!schemaCheck.success) {
    return {
      ok: false,
      response: birthdayValidationErrorResponse(schemaCheck.error),
    };
  }

  return { ok: true };
}

export function handleBirthdayRouteError(
  err: unknown,
  context: string
): NextResponse {
  if (err instanceof NotificationNotFoundError) {
    return privateJsonResponse({ error: 'Notification not found' }, 404);
  }

  if (err instanceof MemberNotFoundError) {
    return privateJsonResponse({ error: 'Member not found' }, 404);
  }

  if (err instanceof MemberValidationError) {
    return privateJsonResponse({ error: err.message, code: 'VALIDATION_ERROR' }, 400);
  }

  if (err instanceof InvalidBirthdayPreferencesError) {
    return privateJsonResponse(
      { error: err.message, code: err.code },
      422
    );
  }

  // Never expose connection URLs, stack traces, or member personal details
  console.error(
    `Birthday/Notification API failure (${context}):`,
    err instanceof Error ? err.name : 'UnknownError'
  );
  return privateJsonResponse(
    { error: 'An unexpected server error occurred.' },
    500
  );
}

