import { NextResponse } from 'next/server';
import { prisma } from '@crelune/database';
import { loginSchema } from '@crelune/shared';
import { verifyPassword } from '@/lib/auth/password';
import { createSessionToken, setSessionCookie } from '@/lib/auth/session';
import { validateRequestOrigin } from '@/lib/auth/csrf';
import {
  extractClientIp,
  checkLoginThrottle,
  recordFailedLoginAttempt,
  clearIpAccountThrottle,
} from '@/lib/auth/rate-limit';

// Constant-time dummy hash: scrypt derived salt and 64-byte key (128 hex chars)
const DUMMY_HASH = '0123456789abcdef0123456789abcdef:' + 'a'.repeat(128);
const MAX_PAYLOAD_BYTES = 4096;

export async function POST(request: Request) {
  try {
    // 1. CSRF Origin / Referer protection
    const originCheck = validateRequestOrigin(request);
    if (!originCheck.allowed) {
      return NextResponse.json(
        { error: 'Forbidden: Cross-site request rejected' },
        { status: 403 }
      );
    }

    // 2. Enforce payload size limit (max 4KB)
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_BYTES) {
      return NextResponse.json(
        { error: 'Payload too large' },
        { status: 413 }
      );
    }

    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_PAYLOAD_BYTES) {
      return NextResponse.json(
        { error: 'Payload too large' },
        { status: 413 }
      );
    }

    let bodyJson: unknown;
    try {
      bodyJson = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: 'Invalid request format' },
        { status: 400 }
      );
    }

    const parsed = loginSchema.safeParse(bodyJson);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 400 }
      );
    }

    const normalizedEmail = parsed.data.email.toLowerCase();
    const { password } = parsed.data;
    const clientIp = extractClientIp(request);

    // 3. Durable PostgreSQL rate-limit & (IP, account) throttle check BEFORE password lookup
    const throttle = await checkLoginThrottle(clientIp, normalizedEmail);
    if (throttle.ipBlocked) {
      await verifyPassword(password, DUMMY_HASH);
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }
    if (throttle.ipAccountBlocked) {
      // Externally indistinguishable from invalid credentials (prevents enumeration and lock disclosure)
      await verifyPassword(password, DUMMY_HASH);
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // 4. Fetch user by email
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: { organisation: true },
    });

    // 5. Prevent account enumeration: run constant-time dummy verification & record failure uniformly
    if (!user || !user.isActive || user.role !== 'OWNER') {
      await verifyPassword(password, DUMMY_HASH);
      await recordFailedLoginAttempt(clientIp, normalizedEmail);
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // 6. Verify password
    const passwordMatch = await verifyPassword(password, user.passwordHash);

    if (!passwordMatch) {
      await recordFailedLoginAttempt(clientIp, normalizedEmail);
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // 7. Clear (IP, account) throttle on successful owner authentication
    await clearIpAccountThrottle(clientIp, normalizedEmail);

    // 8. Create signed session token with minimal claims and active sessionVersion
    const token = createSessionToken({
      id: user.id,
      organisationId: user.organisationId,
      sessionVersion: user.sessionVersion,
    });
    await setSessionCookie(token);

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        organisationName: user.organisation.name,
      },
    });
  } catch (err: unknown) {
    // Never expose internal database or server error details to clients
    console.error('Authentication failure occurred:', err instanceof Error ? err.message : 'Unknown error');
    return NextResponse.json(
      { error: 'An unexpected authentication error occurred.' },
      { status: 500 }
    );
  }
}
