import { NextResponse } from 'next/server';
import { mobileRefreshSchema } from '@crelune/shared';
import { parseJsonBodyWithLimit } from '@/lib/auth/api-owner-guard';
import {
  MobileAuthError,
  refreshMobileSession,
} from '@/lib/auth/mobile-auth-service';

const MAX_MOBILE_REFRESH_BODY_BYTES = 4096;
const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;

export async function POST(request: Request) {
  const bodyResult = await parseJsonBodyWithLimit(
    request,
    MAX_MOBILE_REFRESH_BODY_BYTES
  );
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = mobileRefreshSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Unauthorized: Refresh token is invalid or expired.',
        code: 'INVALID_REFRESH_TOKEN',
      },
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }

  try {
    const rotated = await refreshMobileSession(parsed.data);
    return NextResponse.json(rotated, {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (err) {
    if (err instanceof MobileAuthError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode, headers: NO_STORE_HEADERS }
      );
    }
    console.error(
      'Mobile refresh error:',
      err instanceof Error ? err.name : 'UnknownError'
    );
    return NextResponse.json(
      { error: 'An unexpected authentication error occurred.' },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
