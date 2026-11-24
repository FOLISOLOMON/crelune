import { Palette } from 'lucide-react-native';
import { RoadmapModuleScreen } from '@/components/ui/RoadmapModuleScreen';
import { colors } from '@/theme/tokens';

export default function DesignsTabScreen() {
  return (
    <RoadmapModuleScreen
      title="Designs"
      subtitle="Creative job queue and deliverable approvals"
      badgeLabel="Scheduled for Stage 6.5"
      summary="Mobile design management arrives in Stage 6.5 so you can create creative requests, monitor Windows Creative Agent preparation, inspect exported artwork, and confirm publication."
      icon={<Palette size={22} color={colors.primary.DEFAULT} />}
      upcomingItems={[
        {
          stageLabel: 'Stage 6.5 — Design Pipeline',
          title: 'Job Creation & Status Tracking',
          description:
            'Filter active jobs, create birthday flyers or general artwork tasks, and track every stage from Draft through Approved and Exported.',
        },
        {
          stageLabel: 'Stage 6.5 — Review & Approval',
          title: 'Deliverable Inspection & Explicit Publish Gate',
          description:
            'Inspect verified PNG, JPEG, and PDF exports privately and confirm publication explicitly — exporting never publishes automatically.',
        },
      ]}
      webNote="Full Design Management, template version pinning, and Windows Creative Agent preparation are active today in CRELUNE Web."
    />
  );
}
