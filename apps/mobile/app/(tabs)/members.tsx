import { Users } from 'lucide-react-native';
import { RoadmapModuleScreen } from '@/components/ui/RoadmapModuleScreen';
import { colors } from '@/theme/tokens';

export default function MembersTabScreen() {
  return (
    <RoadmapModuleScreen
      title="Members"
      subtitle="Private church directory and portrait capture"
      badgeLabel="Scheduled for Stage 6.3"
      summary="Fast mobile member lookup, sub-30-second registration, and native camera/gallery portrait uploads arrive next in Stage 6.3."
      icon={<Users size={22} color={colors.primary.DEFAULT} />}
      upcomingItems={[
        {
          stageLabel: 'Stage 6.3 — Directory & Profiles',
          title: 'Searchable Private Member Directory',
          description:
            'Instant name search, Active/Archived filters, date-only birthday visibility, and private authenticated portraits.',
        },
        {
          stageLabel: 'Stage 6.3 — Native Capture',
          title: 'Fast Registration & Camera Portrait Uploads',
          description:
            'Capture or pick a member photo with client-side JPEG normalization and automatic server-side EXIF/GPS stripping.',
        },
      ]}
      webNote="Full Member Directory CRUD, duplicate protection, and private photo uploads are active today in CRELUNE Web."
    />
  );
}
