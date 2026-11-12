import React from 'react';
import { redirect } from 'next/navigation';
import { SessionRevokedNotice } from '@/components/auth/SessionRevokedNotice';
import { TemplatesClient } from '@/components/templates/TemplatesClient';
import { resolveAuthenticatedOwner } from '@/lib/auth/owner-guard';
import { listTemplates } from '@/lib/templates/template-service';

export const dynamic = 'force-dynamic';

export default async function TemplatesPage() {
  const auth = await resolveAuthenticatedOwner();

  if (auth.status === 'unauthenticated') {
    redirect('/login');
  }

  if (auth.status === 'revoked') {
    return <SessionRevokedNotice />;
  }

  const organisationId = auth.owner.profile.organisationId;
  const initialData = await listTemplates(organisationId, {
    q: '',
    category: 'ALL',
    studioType: 'ALL',
    includeArchived: false,
    page: 1,
    pageSize: 24,
  });

  return (
    <TemplatesClient
      initialTemplates={initialData.items}
      initialTotal={initialData.total}
      initialPage={initialData.page}
      initialPageSize={initialData.pageSize}
    />
  );
}
