/**
 * CRELUNE — Shared Environment Validation Schemas
 */

import { z } from 'zod';

export const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .url('DATABASE_URL must be a valid connection string'),
  DATABASE_URL_UNPOOLED: z
    .string()
    .min(1, 'DATABASE_URL_UNPOOLED is required')
    .url('DATABASE_URL_UNPOOLED must be a valid connection string'),
  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET must be at least 32 characters long for cryptographic security'),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  OBJECT_STORAGE_BUCKET: z.string().min(1).optional(),
  OBJECT_STORAGE_CREATIVE_BUCKET: z.string().min(1).optional(),
});

export type ValidatedEnv = z.infer<typeof envSchema>;

/**
 * Validates process environment variables against the strict schema.
 * Throws structured descriptive errors if any requirement is violated.
 */
export function validateEnv(env: Record<string, string | undefined>): ValidatedEnv {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const errorMessages = result.error.errors
      .map((err) => `  - ${err.path.join('.')}: ${err.message}`)
      .join('\n');
    throw new Error(
      `CRELUNE Environment Configuration Failure:\n${errorMessages}\nCheck .env.local against .env.example.`
    );
  }
  return result.data;
}
