import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  Bell,
  CalendarClock,
  FolderArchive,
  ShieldCheck,
  Smartphone,
  User,
} from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { SurfaceCard } from '@/components/ui/SurfaceCard';
import { getAppVariant, resolveMobileApiBaseUrl } from '@/config/env';
import { useAuth } from '@/providers/AuthProvider';
import { useNetworkStatus } from '@/providers/NetworkProvider';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const ROADMAP_MODULES = [
  {
    key: 'push',
    stage: 'Stage 6.6',
    title: 'Notifications Inbox & Push Settings',
    description:
      'Expo push alerts for birthday reminders, Android notification channels, and validated deep links.',
    icon: Bell,
  },
  {
    key: 'events',
    stage: 'Milestone 7',
    title: 'Events & Programmes',
    description:
      'Church service schedules, programme deliverable checklists, and linked event design jobs.',
    icon: CalendarClock,
  },
  {
    key: 'assets',
    stage: 'Milestone 8',
    title: 'Asset Library',
    description:
      'Categorized logos, backgrounds, textures, and finished creative artwork vault.',
    icon: FolderArchive,
  },
] as const;

export default function MoreTabScreen() {
  const { user, device, logout } = useAuth();
  const { isOnline } = useNetworkStatus();
  const [signingOut, setSigningOut] = useState(false);

  const variant = getAppVariant();
  let apiTarget = 'Configured';
  try {
    apiTarget = resolveMobileApiBaseUrl();
  } catch {
    apiTarget = 'Not configured';
  }

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={typography.display}>More</Text>
          <Text style={typography.secondary}>
            Account, device session security, and upcoming studio modules
          </Text>
        </View>

        {/* Owner Account Card */}
        <SurfaceCard style={styles.sectionCard}>
          <View style={styles.cardHeader}>
            <User size={18} color={colors.primary.DEFAULT} />
            <Text style={typography.sectionTitle}>Owner Account</Text>
          </View>
          <View style={styles.infoList}>
            <View style={styles.infoRow}>
              <Text style={typography.caption}>Name</Text>
              <Text style={typography.bodyStrong}>
                {user ? `${user.firstName} ${user.lastName}` : '—'}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={typography.caption}>Email</Text>
              <Text style={typography.body}>{user?.email ?? '—'}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={typography.caption}>Workspace</Text>
              <Text style={typography.body}>
                {user?.organisationName ?? '—'}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={typography.caption}>Timezone</Text>
              <Text style={typography.body}>
                {user?.timezone ?? 'Africa/Accra'}
              </Text>
            </View>
          </View>
        </SurfaceCard>

        {/* Active Mobile Device Session Card */}
        <SurfaceCard style={styles.sectionCard}>
          <View style={styles.cardHeader}>
            <Smartphone size={18} color={colors.primary.DEFAULT} />
            <Text style={typography.sectionTitle}>This Device Session</Text>
          </View>
          <View style={styles.infoList}>
            <View style={styles.infoRow}>
              <Text style={typography.caption}>Device</Text>
              <Text style={typography.body}>
                {device?.deviceName ?? device?.platform ?? 'Registered Device'}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={typography.caption}>Platform</Text>
              <Text style={typography.body}>{device?.platform ?? '—'}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={typography.caption}>Connection</Text>
              <Text
                style={[
                  typography.bodyStrong,
                  {
                    color: isOnline
                      ? colors.status.success.text
                      : colors.status.warning.text,
                  },
                ]}
              >
                {isOnline ? 'Online' : 'Offline'}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={typography.caption}>Environment</Text>
              <Text style={typography.caption} numberOfLines={1}>
                {variant} · {apiTarget}
              </Text>
            </View>
          </View>
          <View style={styles.securityPill}>
            <ShieldCheck size={15} color={colors.primary.DEFAULT} />
            <Text style={styles.securityPillText}>
              15m access tokens + rotating SecureStore refresh sessions. Revoke
              this device anytime in CRELUNE Web Settings.
            </Text>
          </View>
        </SurfaceCard>

        {/* Honest Roadmap Modules */}
        <View style={styles.roadmapHeader}>
          <Text style={typography.sectionTitle}>Upcoming Roadmap Modules</Text>
        </View>
        <View style={styles.roadmapList}>
          {ROADMAP_MODULES.map((mod) => {
            const Icon = mod.icon;
            return (
              <SurfaceCard key={mod.key} style={styles.roadmapCard}>
                <View style={styles.roadmapTop}>
                  <View style={styles.roadmapIcon}>
                    <Icon size={16} color={colors.primary.DEFAULT} />
                  </View>
                  <View style={styles.roadmapText}>
                    <Text style={styles.stageLabel}>{mod.stage}</Text>
                    <Text style={typography.cardTitle}>{mod.title}</Text>
                  </View>
                </View>
                <Text style={typography.secondary}>{mod.description}</Text>
              </SurfaceCard>
            );
          })}
        </View>

        {/* Sign Out */}
        <PrimaryButton
          testID="more-sign-out-button"
          label="Sign Out of This Device"
          variant="danger"
          isLoading={signingOut}
          disabled={signingOut}
          onPress={() => {
            void handleSignOut();
          }}
        />
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
  header: {
    gap: spacing.xs,
  },
  sectionCard: {
    gap: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  infoList: {
    gap: spacing.sm,
  },
  infoRow: {
    gap: 2,
  },
  securityPill: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.primary.light,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  securityPillText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: colors.primary.active,
  },
  roadmapHeader: {
    marginTop: spacing.xs,
  },
  roadmapList: {
    gap: spacing.md,
  },
  roadmapCard: {
    gap: spacing.sm,
  },
  roadmapTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  roadmapIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    backgroundColor: colors.primary.light,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roadmapText: {
    flex: 1,
    gap: 1,
  },
  stageLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.primary.DEFAULT,
  },
});
