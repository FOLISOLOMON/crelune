import React from 'react';
import { redirect } from 'next/navigation';
import { MEMBER_LIST_DEFAULT_LIMIT } from '@crelune/shared';
import { SessionRevokedNotice } from '@/components/auth/SessionRevokedNotice';
import { MemberDirectoryClient } from '@/components/members/MemberDirectoryClient';
import { resolveAuthenticatedOwner } from '@/lib/auth/owner-guard';
import { listMembers } from '@/lib/members/member-service';

export const dynamic = 'force-dynamic';

export default async function MembersPage() {
  const auth = await resolveAuthenticatedOwner();

  if (auth.status === 'unauthenticated') {
    redirect('/login');
  }

  if (auth.status === 'revoked') {
    return <SessionRevokedNotice />;
  }

  const initialData = await listMembers(auth.owner.profile.organisationId, {
    status: 'active',
    sort: 'name_asc',
    page: 1,
    limit: MEMBER_LIST_DEFAULT_LIMIT,
  });

  return (
    <MemberDirectoryClient
      initialMembers={initialData.members}
      initialPagination={initialData.pagination}
    />
  );
}
