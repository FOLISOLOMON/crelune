import React from 'react';
import { Bell } from 'lucide-react';
import { Header, EmptyState } from '@crelune/ui';

export default function NotificationsPage() {
  return (
    <div className="space-y-6">
      <Header
        title="Notifications Center"
        description="Delivery logs, reminder dispatches, and alert preferences"
      />

      <EmptyState
        icon={<Bell className="w-6 h-6" />}
        badgeText="Scheduled for Milestone 3 & 6"
        title="Notification System Activates in Milestone 3"
        description="The notification center will record upcoming birthday reminder dispatches, job completion alerts, and push notification preferences across web and mobile."
      />
    </div>
  );
}
