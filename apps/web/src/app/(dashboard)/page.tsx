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
  Bell,
} from 'lucide-react';
import {
  BIRTHDAY_PREP_STATUS_LABELS,
  DESIGN_JOB_STATUS_LABELS,
} from '@crelune/shared';
import { resolveAuthenticatedOwner } from '@/lib/auth/owner-guard';
import { getDashboardSnapshot } from '@/lib/dashboard/dashboard-service';
import {
  formatCivilIsoDisplay,
  getBirthdayPrepBadgeVariant,
  getDesignStatusBadgeVariant,
} from '@/lib/designs/design-form-utils';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Badge,
  Header,
} from '@crelune/ui';
import { SessionRevokedNotice } from '@/components/auth/SessionRevokedNotice';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const auth = await resolveAuthenticatedOwner();

  if (auth.status === 'unauthenticated') {
    redirect('/login');
  }

  if (auth.status === 'revoked') {
    return <SessionRevokedNotice />;
  }

  const snapshot = await getDashboardSnapshot(
    auth.owner.profile.organisationId,
    auth.owner.profile.id
  );
  const ownerName = auth.owner.profile.firstName || 'Workspace Owner';
  const ownerEmail = auth.owner.profile.email;

  const operationalCards = [
    {
      title: 'Active Members',
      count: String(snapshot.activeMembersCount),
      note: `${snapshot.birthdayCounts.totalWithBirthday} with celebration dates`,
      href: '/members',
      icon: <Users className="w-4 h-4 text-[#6541A5]" />,
    },
    {
      title: 'Upcoming Birthdays (30d)',
      count: String(snapshot.birthdayCounts.upcomingCount),
      note: `${snapshot.birthdayCounts.weekCount} this week · ${snapshot.birthdayCounts.todayCount} today`,
      href: '/birthdays',
      icon: <Cake className="w-4 h-4 text-[#6541A5]" />,
    },
    {
      title: 'Active Design Jobs',
      count: String(snapshot.activeDesignJobsCount),
      note: `${snapshot.awaitingReviewCount} awaiting review`,
      href: '/designs',
      icon: <Palette className="w-4 h-4 text-[#6541A5]" />,
    },
    {
      title: 'Unread Notifications',
      count: String(snapshot.unreadNotificationsCount),
      note: 'Birthday alerts & due reminders',
      href: '/notifications',
      icon: <Bell className="w-4 h-4 text-[#6541A5]" />,
    },
  ];

  const futureModules = [
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
      title: 'Private Asset Library',
      desc: 'Private high-resolution photographs and graphic assets',
      href: '/assets',
      milestone: 'Milestone 8',
      icon: <FolderOpen className="w-5 h-5 text-[#6541A5]" />,
    },
  ];

  return (
    <div className="space-y-8">
      <Header
        title={`Welcome, ${ownerName}`}
        description="CRELUNE Creative & Media Operations Workspace"
        badge={
          <Badge variant="primary" size="md">
            Live Operations
          </Badge>
        }
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/birthdays"
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-[#E8E5ED] bg-white text-[#24212B] hover:bg-[#F8F7FA] transition-colors"
            >
              <span>Birthday Operations</span>
              <ArrowRight className="w-3.5 h-3.5 text-[#77727F]" />
            </Link>
            <Link
              href="/designs"
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-[#6541A5] text-white hover:bg-[#54348C] transition-colors"
            >
              <span>Design Queue</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        }
      />

      {/* Live Operational KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {operationalCards.map((card) => (
          <Link key={card.title} href={card.href} className="group">
            <Card
              padding="sm"
              className="relative overflow-hidden transition-colors hover:border-[#A99AD1]"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[#77727F]">
                  {card.title}
                </span>
                <div className="p-1.5 rounded-md bg-[#F8F7FA]">{card.icon}</div>
              </div>
              <div className="mt-3">
                <span className="text-2xl font-bold tracking-tight text-[#24212B]">
                  {card.count}
                </span>
                <p className="mt-1 text-[11px] text-[#77727F]">{card.note}</p>
              </div>
            </Card>
          </Link>
        ))}
      </div>

      {/* Live Birthday & Design Operational Previews */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Upcoming Birthdays</CardTitle>
              <CardDescription>
                Next 30 days in your configured celebration timezone
              </CardDescription>
            </div>
            <Link
              href="/birthdays"
              className="text-xs font-medium text-[#6541A5] hover:underline"
            >
              View Calendar
            </Link>
          </CardHeader>
          <CardContent>
            {snapshot.upcomingBirthdays.length === 0 ? (
              <p className="text-xs text-[#77727F]">
                No upcoming member birthdays in the next 30 days.
              </p>
            ) : (
              <ul className="divide-y divide-[#E8E5ED]">
                {snapshot.upcomingBirthdays.map((item) => (
                  <li
                    key={`${item.memberId}-${item.targetYear}`}
                    className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div>
                      <Link
                        href={`/members/${item.memberId}`}
                        className="text-sm font-medium text-[#24212B] hover:text-[#6541A5]"
                      >
                        {item.fullName}
                      </Link>
                      <p className="text-xs text-[#77727F]">
                        {formatCivilIsoDisplay(item.celebratedDateIso)} ·{' '}
                        {item.daysUntil === 0
                          ? 'Today'
                          : `In ${item.daysUntil} day(s)`}
                      </p>
                    </div>
                    <Badge
                      variant={getBirthdayPrepBadgeVariant(item.prepStatus)}
                      size="sm"
                    >
                      {BIRTHDAY_PREP_STATUS_LABELS[item.prepStatus]}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Active Design Pipeline</CardTitle>
              <CardDescription>
                In-flight flyers and creative requests
              </CardDescription>
            </div>
            <Link
              href="/designs"
              className="text-xs font-medium text-[#6541A5] hover:underline"
            >
              Open Queue
            </Link>
          </CardHeader>
          <CardContent>
            {snapshot.recentDesignJobs.length === 0 ? (
              <p className="text-xs text-[#77727F]">
                No active design jobs yet. Start a flyer from Design Management or Birthday Operations.
              </p>
            ) : (
              <ul className="divide-y divide-[#E8E5ED]">
                {snapshot.recentDesignJobs.map((job) => (
                  <li
                    key={job.id}
                    className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div>
                      <Link
                        href={`/designs/${job.id}`}
                        className="text-sm font-medium text-[#24212B] hover:text-[#6541A5]"
                      >
                        {job.title}
                      </Link>
                      <p className="text-xs text-[#77727F]">
                        {job.member?.fullName ?? 'General request'} · Due{' '}
                        {formatCivilIsoDisplay(job.dueDate)}
                      </p>
                    </div>
                    <Badge
                      variant={getDesignStatusBadgeVariant(job.status)}
                      size="sm"
                    >
                      {DESIGN_JOB_STATUS_LABELS[job.status]}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Infrastructure & Scheduler Note */}
      <Card className="border-[#D3CAEC]/60 bg-white">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#6541A5]" />
              <h4 className="text-sm font-semibold text-[#24212B]">
                Environment Baseline &amp; Reminder Scheduling
              </h4>
            </div>
            <p className="text-xs text-[#77727F]">
              Authenticated as {ownerEmail} · Automated reminder delivery runs via configured external cron; manual reminder sync is available in Birthday Operations.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-[#F0FDF4] border border-[#BBF7D0] text-[#166534]">
              <Database className="w-3.5 h-3.5" />
              <span>
                Neon Postgres: {snapshot.dbHealth.connected ? 'Connected' : 'Degraded'}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-[#EFEBF8] border border-[#D3CAEC] text-[#6541A5]">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Members, Birthdays &amp; Designs Active</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Upcoming Roadmap Modules */}
      <div className="space-y-4">
        <div>
          <h3 className="text-base font-semibold text-[#24212B]">
            Upcoming CRELUNE Modules
          </h3>
          <p className="text-xs text-[#77727F]">
            Remaining roadmap modules planned for subsequent milestones.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {futureModules.map((mod) => (
            <Link key={mod.href} href={mod.href} className="group">
              <Card className="h-full hover:border-[#A99AD1] transition-colors cursor-pointer">
                <CardHeader className="border-none pb-0">
                  <div className="flex items-center justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EFEBF8] text-[#6541A5]">
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
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
