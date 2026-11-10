import { NextResponse } from 'next/server';
import { prisma } from '@crelune/database';
import { loginSchema } from '@crelune/shared';
import { verifyPassword } from '@/lib/auth/password';
import { createSessionToken, setSessionCookie } from '@/lib/auth/session';

// Constant-time dummy hash: scrypt derived salt and 64-byte key (128 hex chars)
const DUMMY_HASH = '0123456789abcdef0123456789abcdef:' + 'a'.repeat(128);
const MAX_PAYLOAD_BYTES = 4096;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export async function POST(request: Request) {
  try {
    // 1. Enforce payload size limit (max 4KB)
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_BYTES) {
      return NextResponse.json(
        { error: 'Payload too large' },
        { status: 413 }
      );
    }

    const rawBody = await request.text();
    if (rawBody.length > MAX_PAYLOAD_BYTES) {
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

    const { email, password } = parsed.data;

    // 2. Fetch user by email
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { organisation: true },
    });

    // 3. Prevent account enumeration: run constant-time dummy verification if user not found
    if (!user || !user.isActive) {
      await verifyPassword(password, DUMMY_HASH);
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // 4. Check durable account lockout
    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      return NextResponse.json(
        { error: 'Account is temporarily locked due to multiple failed login attempts. Please try again in 15 minutes.' },
        { status: 429 }
      );
    }

    // 5. Verify password
    const passwordMatch = await verifyPassword(password, user.passwordHash);

    if (!passwordMatch) {
      const newAttempts = user.failedLoginAttempts + 1;
      const isLockThreshold = newAttempts >= MAX_FAILED_ATTEMPTS;
      const lockedUntil = isLockThreshold ? new Date(now.getTime() + LOCKOUT_DURATION_MS) : null;

      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: newAttempts,
          lockedUntil,
        },
      });

      if (isLockThreshold) {
        return NextResponse.json(
          { error: 'Account is temporarily locked due to multiple failed login attempts. Please try again in 15 minutes.' },
          { status: 429 }
        );
      }

      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // 6. Reset failed attempts on successful login
    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
    }

    // 7. Create signed session token with minimal claims (no PII)
    const token = createSessionToken({
      id: user.id,
      organisationId: user.organisationId,
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
