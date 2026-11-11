import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Users } from 'lucide-react';
import { EmptyState } from '@crelune/ui';
import { memberIdParamSchema, type MemberDetail } from '@crelune/shared';
import { SessionRevokedNotice } from '@/components/auth/SessionRevokedNotice';
import { MemberProfileClient } from '@/components/members/MemberProfileClient';
import { resolveAuthenticatedOwner } from '@/lib/auth/owner-guard';
import { getMemberById, MemberNotFoundError } from '@/lib/members/member-service';

export const dynamic = 'force-dynamic';

export default async function MemberProfilePage({
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

  const { id: rawId } = await params;
  const parsedId = memberIdParamSchema.safeParse(rawId);

  let member: MemberDetail | null = null;
  if (parsedId.success) {
    try {
      member = await getMemberById(
        auth.owner.profile.organisationId,
        parsedId.data
      );
    } catch (err) {
      if (!(err instanceof MemberNotFoundError)) {
        throw err;
      }
    }
  }

  if (!member) {
    return (
      <div className="space-y-6">
        <Link
          href="/members"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#77727F] hover:text-[#6541A5] transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Members Directory
        </Link>

        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title="Member Record Not Found"
          description="This member record does not exist in your directory or is not accessible from this workspace."
        />
      </div>
    );
  }

  return <MemberProfileClient initialMember={member} />;
}

