import { NextResponse } from 'next/server';
import { mobileLoginSchema } from '@crelune/shared';
import { parseJsonBodyWithLimit } from '@/lib/auth/api-owner-guard';
import {
  loginMobileOwner,
  MobileAuthError,
} from '@/lib/auth/mobile-auth-service';
import { extractClientIp } from '@/lib/auth/rate-limit';

const MAX_MOBILE_AUTH_BODY_BYTES = 4096;
const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;

export async function POST(request: Request) {
  const bodyResult = await parseJsonBodyWithLimit(
    request,
    MAX_MOBILE_AUTH_BODY_BYTES
  );
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = mobileLoginSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid mobile sign-in payload.',
        code: 'VALIDATION_ERROR',
      },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  try {
    const clientIp = extractClientIp(request);
    const session = await loginMobileOwner(parsed.data, clientIp);
    return NextResponse.json(session, {
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
      'Mobile login error:',
      err instanceof Error ? err.name : 'UnknownError'
    );
    return NextResponse.json(
      { error: 'An unexpected authentication error occurred.' },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
