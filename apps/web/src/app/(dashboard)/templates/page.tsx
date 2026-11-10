import React from 'react';
import { FileText } from 'lucide-react';
import { Header, EmptyState } from '@crelune/ui';

export default function TemplatesPage() {
  return (
    <div className="space-y-6">
      <Header
        title="Template Catalog"
        description="Affinity (.afdesign) and Photoshop (.psd) templates with field bindings"
      />

      <EmptyState
        icon={<FileText className="w-6 h-6" />}
        badgeText="Scheduled for Milestone 5"
        title="Template Management Activates in Milestone 5"
        description="The template subsystem will catalog verified native Affinity and PSD templates, inspect text/image layers, map job fields to layer targets, and interface with the Windows Creative Agent."
      />
    </div>
  );
}
