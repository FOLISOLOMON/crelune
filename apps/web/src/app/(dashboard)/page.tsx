import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Users,
  Cake,
  Palette,
  FileText,
  FolderOpen,
  Calendar,
  CheckCircle2,
  Database,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import { resolveAuthenticatedOwner } from '@/lib/auth/owner-guard';
import { checkDatabaseConnection } from '@crelune/database';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Badge, Header } from '@crelune/ui';
import { SessionRevokedNotice } from '@/components/auth/SessionRevokedNotice';

export default async function DashboardPage() {
  const auth = await resolveAuthenticatedOwner();

  if (auth.status === 'unauthenticated') {
    redirect('/login');
  }

  if (auth.status === 'revoked') {
    return <SessionRevokedNotice />;
  }

  const dbHealth = await checkDatabaseConnection();
  const ownerName = auth.owner.profile.firstName || 'Workspace Owner';
  const ownerEmail = auth.owner.profile.email;

  const operationalCards = [
    {
      title: 'Active Design Jobs',
      count: '0',
      note: 'Pipeline activates in Milestone 4',
      icon: <Palette className="w-4 h-4 text-[#6541A5]" />,
    },
    {
      title: 'Upcoming Birthdays',
      count: '0',
      note: 'Directory activates in Milestone 3',
      icon: <Cake className="w-4 h-4 text-[#A99AD1]" />,
    },
    {
      title: 'Scheduled Events',
      count: '0',
      note: 'Programmes activate in Milestone 7',
      icon: <Calendar className="w-4 h-4 text-[#6541A5]" />,
    },
    {
      title: 'Registered Templates',
      count: '0',
      note: 'Affinity/PSD catalog in Milestone 5',
      icon: <FileText className="w-4 h-4 text-[#A99AD1]" />,
    },
  ];

  const quickModules = [
    {
      title: 'Members & Pastoral Care',
      desc: 'Member records, phone numbers, and celebration dates',
      href: '/members',
      milestone: 'Milestone 3',
      icon: <Users className="w-5 h-5 text-[#6541A5]" />,
    },
    {
      title: 'Birthday Calendar & Reminders',
      desc: 'Date-only tracking, automated lead-time reminders',
      href: '/birthdays',
      milestone: 'Milestone 3',
      icon: <Cake className="w-5 h-5 text-[#6541A5]" />,
    },
    {
      title: 'Design Management',
      desc: 'Creation, tracking, review, and status pipeline',
      href: '/designs',
      milestone: 'Milestone 4',
      icon: <Palette className="w-5 h-5 text-[#6541A5]" />,
    },
    {
      title: 'Template & Affinity Catalog',
      desc: 'Validated Affinity & PSD templates with layer field mapping',
      href: '/templates',
      milestone: 'Milestone 5',
      icon: <FileText className="w-5 h-5 text-[#6541A5]" />,
    },
    {
      title: 'Events & Programmes',
      desc: 'Church event calendar, special dates, and linked flyers',
      href: '/events',
      milestone: 'Milestone 7',
      icon: <Calendar className="w-5 h-5 text-[#6541A5]" />,
    },
    {
      title: 'Asset Library',
      desc: 'Private high-resolution photographs and graphic assets',
      href: '/assets',
      milestone: 'Milestone 8',
      icon: <FolderOpen className="w-5 h-5 text-[#6541A5]" />,
    },
  ];

  return (
    <div className="space-y-8">
      {/* Welcome Header */}
      <Header
        title={`Welcome, ${ownerName}`}
        description="CRELUNE Creative & Media Operations Workspace"
        badge={
          <Badge variant="primary" size="md">
            Milestone 2 Foundation
          </Badge>
        }
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/settings"
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-[#E8E5ED] bg-white text-[#24212B] hover:bg-[#F8F7FA] transition-colors"
            >
              <span>Workspace Settings</span>
              <ArrowRight className="w-3.5 h-3.5 text-[#77727F]" />
            </Link>
          </div>
        }
      />

      {/* Overview Stat Cards (Honest Zero Counts with Milestone Annotations) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {operationalCards.map((card, i) => (
          <Card key={i} padding="sm" className="relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#77727F]">{card.title}</span>
              <div className="p-1.5 rounded-md bg-[#F8F7FA]">{card.icon}</div>
            </div>
            <div className="mt-3">
              <span className="text-2xl font-bold tracking-tight text-[#24212B]">
                {card.count}
              </span>
              <p className="mt-1 text-[11px] text-[#9B96A4]">{card.note}</p>
            </div>
          </Card>
        ))}
      </div>

      {/* System & Architecture Status Card */}
      <Card className="border-[#D3CAEC]/60 bg-linear-to-r from-white to-[#FBFBFC]">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#6541A5]" />
              <h4 className="text-sm font-semibold text-[#24212B]">
                Environment Baseline & Infrastructure
              </h4>
            </div>
            <p className="text-xs text-[#77727F]">
              Authenticated as workspace owner ({ownerEmail}) • Single-owner architecture active
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-[#F0FDF4] border border-[#BBF7D0] text-[#166534]">
              <Database className="w-3.5 h-3.5" />
              <span>
                Neon Postgres:{' '}
                {dbHealth.connected ? 'Connected' : 'Degraded'}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-[#EFEBF8] border border-[#D3CAEC] text-[#6541A5]">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Web Foundation Active</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Module Operations Catalog */}
      <div className="space-y-4">
        <div>
          <h3 className="text-base font-semibold text-[#24212B]">
            Creative Modules & Capabilities
          </h3>
          <p className="text-xs text-[#77727F]">
            Milestone progression roadmap for CRELUNE operations.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {quickModules.map((mod, i) => (
            <Link key={i} href={mod.href} className="group">
              <Card className="h-full hover:border-[#6541A5]/40 transition-all hover:shadow-md cursor-pointer">
                <CardHeader className="border-none pb-0">
                  <div className="flex items-center justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EFEBF8] group-hover:bg-[#6541A5] group-hover:text-white transition-colors text-[#6541A5]">
                      {mod.icon}
                    </div>
                    <Badge variant="default" size="sm">
                      {mod.milestone}
                    </Badge>
                  </div>
                  <CardTitle className="pt-3 group-hover:text-[#6541A5] transition-colors">
                    {mod.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-2">
                  <CardDescription>{mod.desc}</CardDescription>
                  <div className="mt-4 flex items-center text-xs font-medium text-[#6541A5] opacity-0 group-hover:opacity-100 transition-opacity">
                    <span>Explore module foundation</span>
                    <ArrowRight className="w-3 h-3 ml-1" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
