'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Menu,
  X,
  Sparkles,
  LayoutDashboard,
  Users,
  Cake,
  Palette,
  FileText,
  FolderOpen,
  Calendar,
  Bell,
  Settings,
  LogOut,
} from 'lucide-react';
import { NAVIGATION_ITEMS, type NavItem } from '@crelune/shared';
import type { OwnerProfile } from '@crelune/shared';

const ICON_MAP: Record<string, React.ReactNode> = {
  'layout-dashboard': <LayoutDashboard className="w-4 h-4" />,
  users: <Users className="w-4 h-4" />,
  cake: <Cake className="w-4 h-4" />,
  palette: <Palette className="w-4 h-4" />,
  'file-text': <FileText className="w-4 h-4" />,
  'folder-open': <FolderOpen className="w-4 h-4" />,
  calendar: <Calendar className="w-4 h-4" />,
  bell: <Bell className="w-4 h-4" />,
  settings: <Settings className="w-4 h-4" />,
};

interface MobileNavProps {
  profile?: OwnerProfile | null;
  unreadNotificationCount?: number;
}

export function MobileNav({
  profile,
  unreadNotificationCount = 0,
}: MobileNavProps) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/login');
      router.refresh();
    } catch {
      window.location.href = '/login';
    }
  };

  const closeDrawer = () => setIsOpen(false);

  return (
    <>
      {/* Top Mobile Bar */}
      <header className="lg:hidden sticky top-0 z-30 h-16 flex items-center justify-between px-4 bg-white border-b border-[#E8E5ED]">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#6541A5] text-white">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-base text-[#24212B]">CRELUNE</span>
        </Link>

        <div className="flex items-center gap-2">
          <Link
            href="/notifications"
            className="relative p-2 rounded-lg text-[#77727F] hover:bg-[#F8F7FA]"
            aria-label={
              unreadNotificationCount > 0
                ? `Notifications (${unreadNotificationCount} unread)`
                : 'Notifications'
            }
          >
            <Bell className="w-5 h-5" />
            {unreadNotificationCount > 0 && (
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-[#6541A5]" />
            )}
          </Link>
          <button
            onClick={() => setIsOpen(true)}
            className="p-2 rounded-lg text-[#24212B] hover:bg-[#F8F7FA] cursor-pointer"
            aria-label="Open Navigation Menu"
          >
            <Menu className="w-6 h-6" />
          </button>
        </div>
      </header>

      {/* Slide-over Drawer Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#24212B]/40 backdrop-blur-xs transition-opacity lg:hidden"
          onClick={closeDrawer}
        />
      )}

      {/* Slide-over Drawer */}
      <div
        className={`fixed inset-y-0 right-0 z-50 w-72 bg-white shadow-xl flex flex-col transform transition-transform duration-200 ease-in-out lg:hidden ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="h-16 flex items-center justify-between px-5 border-b border-[#E8E5ED]">
          <span className="font-bold text-sm text-[#24212B]">Navigation</span>
          <button
            onClick={closeDrawer}
            className="p-1.5 rounded-md text-[#77727F] hover:bg-[#F8F7FA] cursor-pointer"
            aria-label="Close Navigation Menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {NAVIGATION_ITEMS.map((item: NavItem) => {
            const isActive =
              item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);

            return (
              <Link
                key={item.key}
                href={item.href}
                onClick={closeDrawer}
                className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-[#EFEBF8] text-[#6541A5]'
                    : 'text-[#77727F] hover:bg-[#F8F7FA] hover:text-[#24212B]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={isActive ? 'text-[#6541A5]' : 'text-[#77727F]'}
                  >
                    {ICON_MAP[item.icon] || <LayoutDashboard className="w-4 h-4" />}
                  </span>
                  <span>{item.label}</span>
                </div>
                {item.key === 'notifications' && unreadNotificationCount > 0 ? (
                  <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-[#EFEBF8] text-[#6541A5] tabular-nums">
                    {unreadNotificationCount}
                  </span>
                ) : (
                  item.badge && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[#F3F2F6] text-[#77727F]">
                      {item.badge}
                    </span>
                  )
                )}
              </Link>
            );
          })}
        </nav>

        {/* Owner Session Footer */}
        <div className="p-4 border-t border-[#E8E5ED] bg-[#FBFBFC]">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-[#24212B] truncate">
                {profile?.firstName
                  ? `${profile.firstName} ${profile.lastName}`
                  : 'Workspace Owner'}
              </p>
              <p className="text-[11px] text-[#77727F] truncate">
                {profile?.email || 'owner@crelune.app'}
              </p>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg text-[#DC2626] hover:bg-[#FEF2F2] cursor-pointer"
              title="Log Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
