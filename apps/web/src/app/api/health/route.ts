import { NextResponse } from 'next/server';
import { resolveAuthenticatedOwner } from '@/lib/auth/owner-guard';
import { checkDatabaseConnection } from '@crelune/database';

export async function GET() {
  let isActiveOwner = false;
  try {
    const auth = await resolveAuthenticatedOwner();
    isActiveOwner = auth.status === 'authenticated';
  } catch {
    isActiveOwner = false;
  }

  // Public unauthenticated (or deactivated/revoked) view: minimal liveness status only
  if (!isActiveOwner) {
    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  }

  // Authenticated active Owner view: detailed operational diagnostics
  const dbHealth = await checkDatabaseConnection();

  return NextResponse.json({
    status: dbHealth.connected ? 'healthy' : 'degraded',
    platform: 'CRELUNE Web Foundation',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
    database: {
      provider: 'Neon Lakebase Postgres',
      connected: dbHealth.connected,
      latencyMs: dbHealth.latencyMs,
      error: dbHealth.error,
    },
    environment: {
      nodeEnv: process.env.NODE_ENV,
      nodeVersion: process.version,
    },
  });
}
