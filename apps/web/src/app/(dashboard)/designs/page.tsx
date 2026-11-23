import React from 'react';
import { redirect } from 'next/navigation';
import { prisma } from '@crelune/database';
import type { DesignCategory } from '@crelune/shared';
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
  const [designData, memberOptions, templateRows] = await Promise.all([
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
    prisma.template.findMany({
      where: {
        organisationId,
        isActive: true,
        archivedAt: null,
        versions: { some: {} },
      },
      orderBy: [{ name: 'asc' }],
      select: {
        id: true,
        name: true,
        category: true,
        activeVersionId: true,
        versions: {
          orderBy: { versionNumber: 'desc' },
          select: {
            id: true,
            versionNumber: true,
            format: true,
          },
        },
      },
    }),
  ]);

  const templateOptions = templateRows.map((tpl) => ({
    id: tpl.id,
    name: tpl.name,
    category: tpl.category as DesignCategory,
    activeVersionId: tpl.activeVersionId,
    versions: tpl.versions,
  }));

  return (
    <DesignJobsClient
      initialJobs={designData.jobs}
      initialPagination={designData.pagination}
      initialStatusCounts={designData.statusCounts}
      memberOptions={memberOptions}
      templateOptions={templateOptions}
    />
  );
}
