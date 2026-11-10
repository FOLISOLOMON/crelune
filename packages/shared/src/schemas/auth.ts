/**
 * CRELUNE — Shared Authentication Validation Schemas
 */

import { z } from 'zod';

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Email is required')
    .email('Please enter a valid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters long')
    .max(128, 'Password must not exceed 128 characters'),
});

export type LoginInput = z.infer<typeof loginSchema>;
