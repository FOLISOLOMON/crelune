import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
} from 'lucide-react-native';
import { colors, radii, spacing } from '@/theme/tokens';

export type BannerTone = 'info' | 'warning' | 'error' | 'success';

export interface StatusBannerProps {
  tone: BannerTone;
  title?: string;
  message: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const TONE_STYLES: Record<
  BannerTone,
  { bg: string; border: string; text: string; icon: string }
> = {
  info: {
    bg: colors.status.info.background,
    border: colors.status.info.border,
    text: colors.status.info.text,
    icon: colors.status.info.DEFAULT,
  },
  warning: {
    bg: colors.status.warning.background,
    border: colors.status.warning.border,
    text: colors.status.warning.text,
    icon: colors.status.warning.DEFAULT,
  },
  error: {
    bg: colors.status.error.background,
    border: colors.status.error.border,
    text: colors.status.error.text,
    icon: colors.status.error.DEFAULT,
  },
  success: {
    bg: colors.status.success.background,
    border: colors.status.success.border,
    text: colors.status.success.text,
    icon: colors.status.success.DEFAULT,
  },
};

export function StatusBanner({
  tone,
  title,
  message,
  style,
  testID,
}: StatusBannerProps) {
  const palette = TONE_STYLES[tone];
  const Icon =
    tone === 'error'
      ? AlertCircle
      : tone === 'warning'
        ? AlertTriangle
        : tone === 'success'
          ? CheckCircle2
          : Info;

  return (
    <View
      testID={testID}
      accessibilityRole={tone === 'error' || tone === 'warning' ? 'alert' : 'summary'}
      style={[
        styles.container,
        { backgroundColor: palette.bg, borderColor: palette.border },
        style,
      ]}
    >
      <Icon size={18} color={palette.icon} style={styles.icon} />
      <View style={styles.textWrap}>
        {title ? (
          <Text style={[styles.title, { color: palette.text }]}>{title}</Text>
        ) : null}
        <Text style={[styles.message, { color: palette.text }]}>{message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  icon: {
    marginTop: 1,
  },
  textWrap: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  message: {
    fontSize: 13,
    lineHeight: 18,
  },
});
