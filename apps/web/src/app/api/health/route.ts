import { NextResponse } from 'next/server';
import { checkDatabaseConnection } from '@crelune/database';

export async function GET() {
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
