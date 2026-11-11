/**
 * CRELUNE — Shared HTTP Helpers for Member Directory API Routes
 */

import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { memberIdParamSchema } from '@crelune/shared';
import {
  MemberDuplicateError,
  MemberNotFoundError,
  MemberValidationError,
} from '@/lib/members/member-service';

const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
};

export function memberJsonResponse(body: unknown, status: number = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: PRIVATE_NO_STORE_HEADERS,
  });
}

export function zodValidationErrorResponse(error: ZodError): NextResponse {
  const firstIssue = error.issues[0];
  return memberJsonResponse(
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

export function parseMemberIdOrError(
  rawId: string
): { ok: true; id: string } | { ok: false; response: NextResponse } {
  const parsed = memberIdParamSchema.safeParse(rawId);
  if (!parsed.success) {
    return { ok: false, response: zodValidationErrorResponse(parsed.error) };
  }
  return { ok: true, id: parsed.data };
}

export function handleMemberRouteError(
  err: unknown,
  context: string
): NextResponse {
  if (err instanceof MemberDuplicateError) {
    return memberJsonResponse(
      {
        error: err.message,
        code: 'POTENTIAL_DUPLICATE_MEMBER',
        requiresConfirmation: true,
        duplicateCandidates: err.candidates,
      },
      409
    );
  }

  if (err instanceof MemberNotFoundError) {
    return memberJsonResponse({ error: 'Member not found' }, 404);
  }

  if (err instanceof MemberValidationError) {
    return memberJsonResponse(
      { error: err.message, code: 'VALIDATION_ERROR' },
      400
    );
  }

  // Never expose database connection strings, internal SQL, or stack traces to clients
  console.error(
    `Member API failure (${context}):`,
    err instanceof Error ? err.name : 'UnknownError'
  );
  return memberJsonResponse(
    { error: 'An unexpected server error occurred.' },
    500
  );
}
