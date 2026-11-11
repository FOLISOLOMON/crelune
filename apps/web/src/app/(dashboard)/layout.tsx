import React from 'react';
import { redirect } from 'next/navigation';
import { resolveAuthenticatedOwner } from '@/lib/auth/owner-guard';
import { ShellLayout } from '@/components/shell/ShellLayout';
import { SessionRevokedNotice } from '@/components/auth/SessionRevokedNotice';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await resolveAuthenticatedOwner();

  if (auth.status === 'unauthenticated') {
    redirect('/login');
  }

  if (auth.status === 'revoked') {
    // Render non-redirecting revocation state to prevent Edge middleware redirect loops
    return <SessionRevokedNotice />;
  }

  return <ShellLayout profile={auth.owner.profile}>{children}</ShellLayout>;
}
