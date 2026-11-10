import React from 'react';
import { getSession } from '@/lib/auth/session';
import { ShellLayout } from '@/components/shell/ShellLayout';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  return <ShellLayout session={session}>{children}</ShellLayout>;
}
