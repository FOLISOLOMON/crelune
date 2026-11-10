import React from 'react';
import { Sidebar } from './Sidebar';
import { MobileNav } from './MobileNav';
import type { OwnerSession } from '@crelune/shared';

interface ShellLayoutProps {
  children: React.ReactNode;
  session?: OwnerSession | null;
}

export function ShellLayout({ children, session }: ShellLayoutProps) {
  return (
    <div className="min-h-screen bg-[#F8F7FA] text-[#24212B] flex flex-col">
      {/* Desktop Fixed Sidebar */}
      <Sidebar session={session} />

      {/* Mobile Top Navigation */}
      <MobileNav session={session} />

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col">
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
