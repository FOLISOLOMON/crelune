import React from 'react';
import { redirect } from 'next/navigation';
import { prisma } from '@crelune/database';
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

  const unreadNotificationCount = await prisma.notification.count({
    where: {
      organisationId: auth.owner.profile.organisationId,
      userId: auth.owner.profile.id,
      readAt: null,
    },
  });

  return (
    <ShellLayout
      profile={auth.owner.profile}
      unreadNotificationCount={unreadNotificationCount}
    >
      {children}
    </ShellLayout>
  );
}
