'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
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
  Sparkles,
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

interface SidebarProps {
  profile?: OwnerProfile | null;
  unreadNotificationCount?: number;
}

export function Sidebar({
  profile,
  unreadNotificationCount = 0,
}: SidebarProps) {
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

  const ownerInitials =
    profile?.firstName && profile?.lastName
      ? `${profile.firstName[0]}${profile.lastName[0]}`.toUpperCase()
      : 'CO';

  return (
    <aside className="hidden lg:flex w-64 flex-col fixed inset-y-0 z-40 bg-white border-r border-[#E8E5ED]">
      {/* Brand Header */}
      <div className="h-16 flex items-center justify-between px-6 border-b border-[#E8E5ED]">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#6541A5] text-white shadow-sm transition-transform group-hover:scale-105">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-base tracking-tight text-[#24212B]">
                CRELUNE
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#EFEBF8] text-[#6541A5]">
                Ops
              </span>
            </div>
            <p className="text-[11px] text-[#77727F] leading-none">
              Creative Operations
            </p>
          </div>
        </Link>
      </div>

      {/* Navigation List */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        <div className="px-3 pb-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9B96A4]">
            Operations Workspace
          </p>
        </div>
        {NAVIGATION_ITEMS.map((item: NavItem) => {
          const isActive =
            item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);

          return (
            <Link
              key={item.key}
              href={item.href}
              className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
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
                <span
                  aria-label={`${unreadNotificationCount} unread notifications`}
                  className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-[#EFEBF8] text-[#6541A5] tabular-nums"
                >
                  {unreadNotificationCount}
                </span>
              ) : (
                item.badge && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[#F3F2F6] text-[#77727F] border border-[#E8E5ED]/80">
                    {item.badge}
                  </span>
                )
              )}
            </Link>
          );
        })}
      </nav>

      {/* Owner Profile & Logout */}
      <div className="p-3 border-t border-[#E8E5ED] bg-[#FBFBFC]">
        <div className="flex items-center justify-between p-2 rounded-lg">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#6541A5] text-white text-xs font-semibold">
              {ownerInitials}
            </div>
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
          </div>
          <button
            onClick={handleLogout}
            title="Log Out"
            className="p-1.5 rounded-md text-[#77727F] hover:text-[#DC2626] hover:bg-white transition-colors cursor-pointer"
            aria-label="Log Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
