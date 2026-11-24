import { Calendar } from 'lucide-react-native';
import { RoadmapModuleScreen } from '@/components/ui/RoadmapModuleScreen';
import { colors } from '@/theme/tokens';

export default function CalendarTabScreen() {
  return (
    <RoadmapModuleScreen
      title="Calendar"
      subtitle="Birthdays and upcoming church schedule"
      badgeLabel="Stage 6.4 & Milestone 7"
      summary="The native Calendar workspace connects to CRELUNE's date-only birthday engine in Stage 6.4 and expands to include Church Events & Programmes in Milestone 7."
      icon={<Calendar size={22} color={colors.primary.DEFAULT} />}
      upcomingItems={[
        {
          stageLabel: 'Stage 6.4 — Birthday Calendar',
          title: 'Monthly Birthday Operations & Prep Tracking',
          description:
            'Timezone-safe monthly grid, leap-day indicators, quick filters (Today / 7d / Month), preparation status updates, and reminder preferences.',
        },
        {
          stageLabel: 'Milestone 7 — Roadmap',
          title: 'Church Events & Programmes Timeline',
          description:
            'Services, special programmes, deliverable checklists, and linked event artwork join this unified calendar in Milestone 7.',
        },
      ]}
      webNote="Full Birthday Calendar, leap-day policy settings, and reminder synchronization are live today in CRELUNE Web."
    />
  );
}
