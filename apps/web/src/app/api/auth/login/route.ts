import { NextResponse } from 'next/server';
import { prisma } from '@crelune/database';
import { loginSchema } from '@crelune/shared';
import { verifyPassword } from '@/lib/auth/password';
import { createSessionToken, setSessionCookie } from '@/lib/auth/session';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = loginSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input format', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { organisation: true },
    });

    if (!user || !user.isActive) {
      // Use constant-time dummy verification or generic error to prevent account enumeration
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    const passwordMatch = await verifyPassword(password, user.passwordHash);
    if (!passwordMatch) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    const sessionUser = {
      id: user.id,
      organisationId: user.organisationId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role as 'OWNER' | 'ADMIN' | 'DESIGNER',
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    const token = createSessionToken(sessionUser);
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
    const message = err instanceof Error ? err.message : 'Authentication failure';
    return NextResponse.json(
      { error: 'Server authentication error', details: message },
      { status: 500 }
    );
  }
}
