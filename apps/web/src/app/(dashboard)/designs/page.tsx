import React from 'react';
import { Palette } from 'lucide-react';
import { Header, EmptyState } from '@crelune/ui';

export default function DesignsPage() {
  return (
    <div className="space-y-6">
      <Header
        title="Design Management"
        description="Creative job tracking, status pipeline, and approval workflow"
      />

      <EmptyState
        icon={<Palette className="w-6 h-6" />}
        badgeText="Scheduled for Milestone 4"
        title="Design Job Management Activates in Milestone 4"
        description="The design management module will track creative jobs across standard status transitions (Draft, In Progress, In Review, Approved, Exported). It connects members and events to templates and orchestrates production."
      />
    </div>
  );
}
