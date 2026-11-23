import { NextResponse } from 'next/server';
import {
  mobileDeviceIdParamSchema,
  revokeMobileDeviceSchema,
} from '@crelune/shared';
import {
  parseJsonBodyWithLimit,
  requireAuthenticatedOwnerApi,
} from '@/lib/auth/api-owner-guard';
import {
  MobileAuthError,
  revokeMobileDevice,
} from '@/lib/auth/mobile-auth-service';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthenticatedOwnerApi(request, { verifyCsrf: true });
  if (!auth.ok) {
    return auth.response;
  }

  const { id: rawId } = await context.params;
  const parsedId = mobileDeviceIdParamSchema.safeParse(rawId);
  if (!parsedId.success) {
    return NextResponse.json(
      { error: 'Invalid mobile device identifier.', code: 'VALIDATION_ERROR' },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  let bodyInput: { reason?: string | null } = {};
  const contentLength = request.headers.get('content-length');
  const hasContentType = request.headers.get('content-type');
  if (
    (contentLength && Number.parseInt(contentLength, 10) > 0) ||
    (hasContentType && hasContentType.toLowerCase().includes('application/json'))
  ) {
    const bodyResult = await parseJsonBodyWithLimit(request, 4096);
    if (!bodyResult.ok) {
      return bodyResult.response;
    }
    const parsedBody = revokeMobileDeviceSchema.safeParse(bodyResult.data);
    if (!parsedBody.success) {
      return NextResponse.json(
        {
          error: 'Invalid device revocation payload.',
          code: 'VALIDATION_ERROR',
        },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }
    bodyInput = parsedBody.data;
  }

  try {
    const device = await revokeMobileDevice(
      {
        userId: auth.owner.profile.id,
        organisationId: auth.owner.profile.organisationId,
      },
      parsedId.data,
      bodyInput
    );

    return NextResponse.json(
      { device },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    if (err instanceof MobileAuthError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode, headers: NO_STORE_HEADERS }
      );
    }
    console.error(
      'POST /api/mobile/devices/[id]/revoke error:',
      err instanceof Error ? err.name : 'UnknownError'
    );
    return NextResponse.json(
      { error: 'Failed to revoke mobile device.' },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
