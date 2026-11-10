import React from 'react';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@crelune/database';
import { ShellLayout } from '@/components/shell/ShellLayout';
import type { OwnerProfile } from '@crelune/shared';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session) {
    redirect('/login');
  }

  // Fetch owner profile directly from database using minimal session.sub
  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    include: { organisation: true },
  });

  const profile: OwnerProfile | null = user
    ? {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        organisationName: user.organisation?.name || 'CRELUNE Operations',
      }
    : null;

  return <ShellLayout profile={profile}>{children}</ShellLayout>;
}
