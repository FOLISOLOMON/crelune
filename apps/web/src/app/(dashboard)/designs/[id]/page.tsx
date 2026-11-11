import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Palette } from 'lucide-react';
import { prisma } from '@crelune/database';
import { EmptyState } from '@crelune/ui';
import {
  designJobIdParamSchema,
  type DesignJobDetail,
} from '@crelune/shared';
import { SessionRevokedNotice } from '@/components/auth/SessionRevokedNotice';
import { DesignJobDetailClient } from '@/components/designs/DesignJobDetailClient';
import { resolveAuthenticatedOwner } from '@/lib/auth/owner-guard';
import {
  DesignJobNotFoundError,
  getDesignJobById,
} from '@/lib/designs/design-job-service';

export const dynamic = 'force-dynamic';

export default async function DesignJobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = await resolveAuthenticatedOwner();

  if (auth.status === 'unauthenticated') {
    redirect('/login');
  }

  if (auth.status === 'revoked') {
    return <SessionRevokedNotice />;
  }

  const organisationId = auth.owner.profile.organisationId;
  const { id: rawId } = await params;
  const parsedId = designJobIdParamSchema.safeParse(rawId);

  let job: DesignJobDetail | null = null;
  if (parsedId.success) {
    try {
      job = await getDesignJobById(organisationId, parsedId.data);
    } catch (err) {
      if (!(err instanceof DesignJobNotFoundError)) {
        throw err;
      }
    }
  }

  if (!job) {
    return (
      <div className="space-y-6">
        <Link
          href="/designs"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#77727F] hover:text-[#6541A5] transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Design Management
        </Link>

        <EmptyState
          icon={<Palette className="h-6 w-6" />}
          title="Design Job Not Found"
          description="This design job does not exist or is not accessible from your workspace."
        />
      </div>
    );
  }

  const memberOptions = await prisma.member.findMany({
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
  });

  return <DesignJobDetailClient initialJob={job} memberOptions={memberOptions} />;
}

