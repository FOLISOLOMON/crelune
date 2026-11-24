import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  Cake,
  CheckCircle2,
  Palette,
  Users,
} from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiClientError } from '@/api/client';
import { mobileApiClient } from '@/auth/runtime';
import { TemporaryRefreshError } from '@/auth/session-manager';
import { BrandMark } from '@/components/ui/BrandMark';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { SurfaceCard } from '@/components/ui/SurfaceCard';
import { useAuth } from '@/providers/AuthProvider';
import { useNetworkStatus } from '@/providers/NetworkProvider';
import { colors, radii, spacing, typography } from '@/theme/tokens';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatTodayLabel(): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());
}

function formatReadableStatus(status: string): string {
  return status
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function describeDashboardError(error: unknown, isOnline: boolean): string {
  if (!isOnline) {
    return 'You are offline. Reconnect and pull to refresh your CRELUNE overview.';
  }
  if (error instanceof TemporaryRefreshError) {
    return error.message;
  }
  if (error instanceof ApiClientError) {
    return error.message;
  }
  return 'Unable to load your studio overview right now. Pull down or tap Retry.';
}

export default function HomeScreen() {
  const { user, isAuthenticated } = useAuth();
  const { isOnline } = useNetworkStatus();

  const dashboardQuery = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => mobileApiClient.fetchDashboardSnapshot(),
    enabled: isAuthenticated,
  });

  const data = dashboardQuery.data;
  const isInitialLoading = dashboardQuery.isPending && !data;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        testID="home-scroll-view"
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={dashboardQuery.isRefetching}
            onRefresh={() => {
              void dashboardQuery.refetch();
            }}
            tintColor={colors.primary.DEFAULT}
            colors={[colors.primary.DEFAULT]}
          />
        }
      >
        {/* Studio Header */}
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={styles.dateCaption}>{formatTodayLabel()}</Text>
            <Text style={typography.display}>
              {getGreeting()}, {user?.firstName ?? 'Owner'}
            </Text>
            <Text style={typography.secondary}>
              {user?.organisationName ?? 'CRELUNE Operations'}
            </Text>
          </View>
          <BrandMark size={40} showWordmark={false} />
        </View>

        {/* Loading State */}
        {isInitialLoading ? (
          <SurfaceCard style={styles.loadingCard}>
            <ActivityIndicator size="small" color={colors.primary.DEFAULT} />
            <Text style={typography.bodyStrong}>Loading studio briefing…</Text>
            <Text style={typography.secondary}>
              Fetching live birthdays, design queue, and workspace health.
            </Text>
          </SurfaceCard>
        ) : null}

        {/* Error / Offline State */}
        {dashboardQuery.isError ? (
          <View style={styles.errorStack}>
            <StatusBanner
              testID="home-error-banner"
              tone={isOnline ? 'error' : 'warning'}
              title={isOnline ? 'Unable to sync studio overview' : 'Offline mode'}
              message={describeDashboardError(dashboardQuery.error, isOnline)}
            />
            <PrimaryButton
              testID="home-retry-button"
              label="Retry Sync"
              variant="secondary"
              onPress={() => {
                void dashboardQuery.refetch();
              }}
              isLoading={dashboardQuery.isFetching}
            />
          </View>
        ) : null}

        {/* Live Studio Overview */}
        {data ? (
          <>
            {/* Unread Notifications Pill */}
            <SurfaceCard style={styles.alertStrip}>
              <View style={styles.alertLeft}>
                <View style={styles.alertIconWrap}>
                  <Bell size={16} color={colors.primary.DEFAULT} />
                </View>
                <View style={styles.flex}>
                  <Text style={typography.cardTitle}>
                    {data.unreadNotificationsCount === 0
                      ? 'All caught up'
                      : `${data.unreadNotificationsCount} unread notification${
                          data.unreadNotificationsCount === 1 ? '' : 's'
                        }`}
                  </Text>
                  <Text style={typography.caption}>
                    Database:{' '}
                    {data.dbHealth.connected ? 'Connected' : 'Degraded'}
                    {typeof data.dbHealth.latencyMs === 'number'
                      ? ` (${data.dbHealth.latencyMs}ms)`
                      : ''}
                  </Text>
                </View>
              </View>
            </SurfaceCard>

            {/* 2x2 Operational Metrics */}
            <View style={styles.metricsGrid}>
              <SurfaceCard style={styles.metricCard}>
                <View style={styles.metricTop}>
                  <Cake size={16} color={colors.primary.DEFAULT} />
                  <Text style={typography.caption}>Next 7 Days</Text>
                </View>
                <Text style={typography.metric}>
                  {data.birthdayCounts.weekCount}
                </Text>
                <Text style={styles.metricSub}>
                  {data.birthdayCounts.todayCount} today ·{' '}
                  {data.birthdayCounts.upcomingCount} upcoming
                </Text>
              </SurfaceCard>

              <SurfaceCard style={styles.metricCard}>
                <View style={styles.metricTop}>
                  <Palette size={16} color={colors.primary.DEFAULT} />
                  <Text style={typography.caption}>Active Designs</Text>
                </View>
                <Text style={typography.metric}>
                  {data.activeDesignJobsCount}
                </Text>
                <Text style={styles.metricSub}>
                  {data.awaitingReviewCount} awaiting review
                </Text>
              </SurfaceCard>

              <SurfaceCard style={styles.metricCard}>
                <View style={styles.metricTop}>
                  <Users size={16} color={colors.primary.DEFAULT} />
                  <Text style={typography.caption}>Members</Text>
                </View>
                <Text style={typography.metric}>{data.activeMembersCount}</Text>
                <Text style={styles.metricSub}>Active records</Text>
              </SurfaceCard>

              <SurfaceCard style={styles.metricCard}>
                <View style={styles.metricTop}>
                  <CheckCircle2 size={16} color={colors.primary.DEFAULT} />
                  <Text style={typography.caption}>Templates</Text>
                </View>
                <Text style={typography.metric}>
                  {data.activeTemplatesCount}
                </Text>
                <Text style={styles.metricSub}>Registered masters</Text>
              </SurfaceCard>
            </View>

            {/* Upcoming Birthdays Preview (Read-Only) */}
            <View style={styles.sectionBlock}>
              <View style={styles.sectionHeaderRow}>
                <Text style={typography.sectionTitle}>Upcoming Birthdays</Text>
                <Text style={typography.caption}>Next 30 days</Text>
              </View>
              <SurfaceCard>
                {data.upcomingBirthdays.length === 0 ? (
                  <Text style={typography.secondary}>
                    No upcoming member birthdays in the next 30 days.
                  </Text>
                ) : (
                  <View style={styles.previewList}>
                    {data.upcomingBirthdays.slice(0, 3).map((item, idx) => (
                      <View
                        key={item.memberId}
                        style={[
                          styles.previewRow,
                          idx > 0 && styles.previewRowBorder,
                        ]}
                      >
                        <View style={styles.flex}>
                          <Text style={typography.cardTitle}>
                            {item.preferredName || item.fullName}
                          </Text>
                          <Text style={typography.caption}>
                            {item.celebratedDateIso} ·{' '}
                            {item.isToday
                              ? 'Today'
                              : `In ${item.daysUntil} day${
                                  item.daysUntil === 1 ? '' : 's'
                                }`}
                          </Text>
                        </View>
                        <View style={styles.statusChip}>
                          <Text style={styles.statusChipText}>
                            {formatReadableStatus(item.prepStatus)}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </SurfaceCard>
            </View>

            {/* Active Design Jobs Preview (Read-Only) */}
            <View style={styles.sectionBlock}>
              <View style={styles.sectionHeaderRow}>
                <Text style={typography.sectionTitle}>Design Queue</Text>
                <Text style={typography.caption}>Recent active</Text>
              </View>
              <SurfaceCard>
                {data.recentDesignJobs.length === 0 ? (
                  <Text style={typography.secondary}>
                    No active design jobs right now.
                  </Text>
                ) : (
                  <View style={styles.previewList}>
                    {data.recentDesignJobs.slice(0, 3).map((job, idx) => (
                      <View
                        key={job.id}
                        style={[
                          styles.previewRow,
                          idx > 0 && styles.previewRowBorder,
                        ]}
                      >
                        <View style={styles.flex}>
                          <Text style={typography.cardTitle} numberOfLines={1}>
                            {job.title}
                          </Text>
                          <Text style={typography.caption}>
                            {formatReadableStatus(job.category)} ·{' '}
                            {formatReadableStatus(job.priority)} priority
                          </Text>
                        </View>
                        <View style={styles.statusChip}>
                          <Text style={styles.statusChipText}>
                            {formatReadableStatus(job.status)}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </SurfaceCard>
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing['3xl'],
  },
  flex: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  dateCaption: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: colors.primary.DEFAULT,
  },
  loadingCard: {
    alignItems: 'center',
    paddingVertical: spacing['2xl'],
    gap: spacing.sm,
  },
  errorStack: {
    gap: spacing.md,
  },
  alertStrip: {
    paddingVertical: spacing.md,
  },
  alertLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  alertIconWrap: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    backgroundColor: colors.primary.light,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  metricCard: {
    width: '48%',
    flexGrow: 1,
    gap: spacing.xs,
  },
  metricTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  metricSub: {
    fontSize: 11,
    color: colors.text.secondary,
  },
  sectionBlock: {
    gap: spacing.sm,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  previewList: {
    gap: spacing.md,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  previewRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
    paddingTop: spacing.md,
  },
  statusChip: {
    backgroundColor: colors.lavender.subtle,
    borderWidth: 1,
    borderColor: colors.lavender.light,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.primary.DEFAULT,
  },
});
