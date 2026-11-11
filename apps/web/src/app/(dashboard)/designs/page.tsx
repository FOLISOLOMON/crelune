import React from 'react';
import { redirect } from 'next/navigation';
import { prisma } from '@crelune/database';
import { SessionRevokedNotice } from '@/components/auth/SessionRevokedNotice';
import { DesignJobsClient } from '@/components/designs/DesignJobsClient';
import { resolveAuthenticatedOwner } from '@/lib/auth/owner-guard';
import { listDesignJobs } from '@/lib/designs/design-job-service';

export const dynamic = 'force-dynamic';

export default async function DesignsPage() {
  const auth = await resolveAuthenticatedOwner();

  if (auth.status === 'unauthenticated') {
    redirect('/login');
  }

  if (auth.status === 'revoked') {
    return <SessionRevokedNotice />;
  }

  const organisationId = auth.owner.profile.organisationId;
  const [designData, memberOptions] = await Promise.all([
    listDesignJobs(organisationId, {
      status: 'active',
      category: 'ALL',
      priority: 'ALL',
      page: 1,
      limit: 25,
    }),
    prisma.member.findMany({
      where: {
        organisationId,
        archivedAt: null,
      },
      orderBy: [{ fullName: 'asc' }],
      select: {
        id: true,
        fullName: true,
        preferredName: true,
      },
    }),
  ]);

  return (
    <DesignJobsClient
      initialJobs={designData.jobs}
      initialPagination={designData.pagination}
      initialStatusCounts={designData.statusCounts}
      memberOptions={memberOptions}
    />
  );
}
