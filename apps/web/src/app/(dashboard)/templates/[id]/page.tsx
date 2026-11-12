import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, FileText } from 'lucide-react';
import { EmptyState } from '@crelune/ui';
import { templateIdParamSchema, type TemplateDetail } from '@crelune/shared';
import { SessionRevokedNotice } from '@/components/auth/SessionRevokedNotice';
import { TemplateDetailClient } from '@/components/templates/TemplateDetailClient';
import { resolveAuthenticatedOwner } from '@/lib/auth/owner-guard';
import {
  getTemplateDetail,
  TemplateNotFoundError,
} from '@/lib/templates/template-service';

export const dynamic = 'force-dynamic';

export default async function TemplateDetailPage({
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
  const parsedId = templateIdParamSchema.safeParse(rawId);

  let template: TemplateDetail | null = null;
  if (parsedId.success) {
    try {
      template = await getTemplateDetail(organisationId, parsedId.data);
    } catch (err) {
      if (!(err instanceof TemplateNotFoundError)) {
        throw err;
      }
    }
  }

  if (!template) {
    return (
      <div className="space-y-6">
        <Link
          href="/templates"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#77727F] hover:text-[#6541A5] transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Template Catalog
        </Link>

        <EmptyState
          icon={<FileText className="h-8 w-8 text-[#6541A5]" />}
          title="Template Not Found"
          description="This creative template does not exist or is not accessible from your workspace."
        />
      </div>
    );
  }

  return <TemplateDetailClient initialTemplate={template} />;
}

