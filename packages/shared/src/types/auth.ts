/**
 * CRELUNE — Shared Authentication Types
 */

export type UserRole = 'OWNER' | 'ADMIN' | 'DESIGNER';

export interface OwnerUser {
  id: string;
  organisationId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  isActive: boolean;
  sessionVersion?: number;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/**
 * Minimized cryptographic session token payload.
 * Eliminates unnecessary PII from the client cookie.
 * Includes `ver` (session version) for instant single-owner session revocation.
 */
export interface SessionTokenPayload {
  sub: string;
  role: 'OWNER';
  org: string;
  ver: number;
  iat: number;
  exp: number;
}

export type OwnerSession = SessionTokenPayload;

export interface OwnerProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  organisationId: string;
  organisationName: string;
  timezone?: string;
}

export interface AuthResult {
  success: boolean;
  error?: string;
  user?: Omit<OwnerUser, 'passwordHash'>;
}
