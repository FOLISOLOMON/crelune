import React from 'react';
import { Users } from 'lucide-react';
import { Header, EmptyState } from '@crelune/ui';

export default function MembersPage() {
  return (
    <div className="space-y-6">
      <Header
        title="Members Directory"
        description="Pastoral directory, member profiles, and contact records"
      />

      <EmptyState
        icon={<Users className="w-6 h-6" />}
        badgeText="Scheduled for Milestone 3"
        title="Member Management Activates in Milestone 3"
        description="The member directory module is scheduled for implementation in Milestone 3 (Members & Birthdays). It will support personal details, date-only birthday records, pastoral contacts, and photo association."
      />
    </div>
  );
}
