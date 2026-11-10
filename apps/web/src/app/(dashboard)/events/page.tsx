import React from 'react';
import { Calendar } from 'lucide-react';
import { Header, EmptyState } from '@crelune/ui';

export default function EventsPage() {
  return (
    <div className="space-y-6">
      <Header
        title="Events & Programmes"
        description="Church calendar, special programmes, services, and creative requirements"
      />

      <EmptyState
        icon={<Calendar className="w-6 h-6" />}
        badgeText="Scheduled for Milestone 7"
        title="Events & Programmes Activate in Milestone 7"
        description="The event module will manage church calendar milestones, linked creative design jobs, and production deadlines, preventing last-minute preparation bottlenecks."
      />
    </div>
  );
}
