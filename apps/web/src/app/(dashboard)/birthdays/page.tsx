import React from 'react';
import { redirect } from 'next/navigation';
import { SessionRevokedNotice } from '@/components/auth/SessionRevokedNotice';
import { BirthdayOperationsClient } from '@/components/birthdays/BirthdayOperationsClient';
import { resolveAuthenticatedOwner } from '@/lib/auth/owner-guard';
import { getBirthdayOverview } from '@/lib/birthdays/birthday-overview-service';

export const dynamic = 'force-dynamic';

export default async function BirthdaysPage() {
  const auth = await resolveAuthenticatedOwner();

  if (auth.status === 'unauthenticated') {
    redirect('/login');
  }

  if (auth.status === 'revoked') {
    return <SessionRevokedNotice />;
  }

  const overview = await getBirthdayOverview(
    auth.owner.profile.organisationId,
    auth.owner.profile.id,
    { prepStatus: 'ALL' }
  );

  return <BirthdayOperationsClient initialOverview={overview} />;
}
