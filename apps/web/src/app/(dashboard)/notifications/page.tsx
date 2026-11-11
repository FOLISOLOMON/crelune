import React from 'react';
import { redirect } from 'next/navigation';
import { SessionRevokedNotice } from '@/components/auth/SessionRevokedNotice';
import { NotificationsClient } from '@/components/notifications/NotificationsClient';
import { resolveAuthenticatedOwner } from '@/lib/auth/owner-guard';
import { listOwnerNotifications } from '@/lib/notifications/notification-service';

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const auth = await resolveAuthenticatedOwner();

  if (auth.status === 'unauthenticated') {
    redirect('/login');
  }

  if (auth.status === 'revoked') {
    return <SessionRevokedNotice />;
  }

  const initialData = await listOwnerNotifications(
    {
      userId: auth.owner.profile.id,
      organisationId: auth.owner.profile.organisationId,
    },
    { unreadOnly: false, page: 1, limit: 25 }
  );

  return <NotificationsClient initialData={initialData} />;
}
