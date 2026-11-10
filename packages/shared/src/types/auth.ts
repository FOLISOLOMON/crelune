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
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface OwnerSession {
  userId: string;
  email: string;
  organisationId: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  issuedAt: number;
  expiresAt: number;
}

export interface AuthResult {
  success: boolean;
  error?: string;
  user?: Omit<OwnerUser, 'passwordHash'>;
}
