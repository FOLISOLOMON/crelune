import React from 'react';
import { Cake } from 'lucide-react';
import { Header, EmptyState } from '@crelune/ui';

export default function BirthdaysPage() {
  return (
    <div className="space-y-6">
      <Header
        title="Birthday Operations"
        description="Birthday calendar, upcoming anniversaries, and automated reminder triggers"
      />

      <EmptyState
        icon={<Cake className="w-6 h-6" />}
        badgeText="Scheduled for Milestone 3"
        title="Birthday Operations Activate in Milestone 3"
        description="The birthday management subsystem will provide calendar views, leap-day handling, lead-time reminder generation (e.g. 14 days before), and automated creation of birthday design jobs."
      />
    </div>
  );
}
