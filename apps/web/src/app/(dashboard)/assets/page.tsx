import React from 'react';
import { FolderOpen } from 'lucide-react';
import { Header, EmptyState } from '@crelune/ui';

export default function AssetsPage() {
  return (
    <div className="space-y-6">
      <Header
        title="Asset Library"
        description="Private cloud storage for high-resolution photography, logos, and graphic assets"
      />

      <EmptyState
        icon={<FolderOpen className="w-6 h-6" />}
        badgeText="Scheduled for Milestone 8"
        title="Asset Library Activates in Milestone 8"
        description="The asset library will manage secure, private cloud object storage with temporary pre-signed URLs, protecting member photographs, event media, and creative brand elements."
      />
    </div>
  );
}
