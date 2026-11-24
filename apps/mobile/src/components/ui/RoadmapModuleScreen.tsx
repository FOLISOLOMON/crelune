import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SurfaceCard } from '@/components/ui/SurfaceCard';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export interface RoadmapMilestoneItem {
  stageLabel: string;
  title: string;
  description: string;
}

export interface RoadmapModuleScreenProps {
  title: string;
  subtitle: string;
  badgeLabel: string;
  summary: string;
  upcomingItems: RoadmapMilestoneItem[];
  webNote: string;
  icon: React.ReactNode;
}

/**
 * Honest foundation screen for modules scheduled in Stages 6.3–6.6 or Milestones 7–8.
 * Never fabricates interactive data or unfinished backend workflows.
 */
export function RoadmapModuleScreen({
  title,
  subtitle,
  badgeLabel,
  summary,
  upcomingItems,
  webNote,
  icon,
}: RoadmapModuleScreenProps) {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={typography.display}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>

        <SurfaceCard style={styles.heroCard}>
          <View style={styles.heroRow}>
            <View style={styles.iconContainer}>{icon}</View>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badgeLabel}</Text>
            </View>
          </View>
          <Text style={styles.summaryText}>{summary}</Text>
        </SurfaceCard>

        <View style={styles.sectionHeader}>
          <Text style={typography.sectionTitle}>Planned Capabilities</Text>
        </View>

        <View style={styles.list}>
          {upcomingItems.map((item) => (
            <SurfaceCard key={item.title} style={styles.itemCard}>
              <Text style={styles.stageTag}>{item.stageLabel}</Text>
              <Text style={styles.itemTitle}>{item.title}</Text>
              <Text style={styles.itemDescription}>{item.description}</Text>
            </SurfaceCard>
          ))}
        </View>

        <SurfaceCard style={styles.noteCard}>
          <Text style={styles.noteTitle}>Available Now on CRELUNE Web</Text>
          <Text style={styles.noteBody}>{webNote}</Text>
        </SurfaceCard>
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
  subtitle: {
    ...typography.secondary,
  },
  heroCard: {
    gap: spacing.md,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.primary.light,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    backgroundColor: colors.lavender.subtle,
    borderWidth: 1,
    borderColor: colors.lavender.light,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary.DEFAULT,
  },
  summaryText: {
    ...typography.body,
    color: colors.text.secondary,
  },
  sectionHeader: {
    marginTop: spacing.xs,
  },
  list: {
    gap: spacing.md,
  },
  itemCard: {
    gap: spacing.xs,
  },
  stageTag: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.primary.DEFAULT,
  },
  itemTitle: {
    ...typography.cardTitle,
  },
  itemDescription: {
    ...typography.secondary,
  },
  noteCard: {
    backgroundColor: colors.surface.subtle,
    gap: spacing.xs,
  },
  noteTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text.primary,
  },
  noteBody: {
    ...typography.secondary,
  },
});
