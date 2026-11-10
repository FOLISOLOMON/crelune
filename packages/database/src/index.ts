/**
 * CRELUNE — Database Client & Connection Management
 */

import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __crelune_prisma__: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['error'],
  });
}

export const prisma: PrismaClient =
  globalThis.__crelune_prisma__ ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__crelune_prisma__ = prisma;
}

export interface DatabaseHealth {
  connected: boolean;
  error?: string;
  database?: string;
  latencyMs?: number;
}

/**
 * Validates database connectivity safely.
 * Returns health metadata without throwing or leaking sensitive connection strings.
 */
export async function checkDatabaseConnection(): Promise<DatabaseHealth> {
  const start = Date.now();
  try {
    const result = await prisma.$queryRaw<Array<{ current_database: string }>>`
      SELECT current_database();
    `;
    const latencyMs = Date.now() - start;
    const dbName = result[0]?.current_database || 'connected';
    return {
      connected: true,
      database: dbName,
      latencyMs,
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    return {
      connected: false,
      error: message.split('\n')[0] || 'Database query failed',
      latencyMs,
    };
  }
}

export * from '@prisma/client';
