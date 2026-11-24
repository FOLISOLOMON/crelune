import { StyleSheet, Text, View } from 'react-native';
import { WifiOff } from 'lucide-react-native';
import { colors, spacing } from '@/theme/tokens';
import { useNetworkStatus } from '@/providers/NetworkProvider';

export function OfflineBar() {
  const { isOnline, isChecking } = useNetworkStatus();

  if (isChecking || isOnline) {
    return null;
  }

  return (
    <View
      testID="offline-status-bar"
      accessibilityRole="alert"
      style={styles.bar}
    >
      <WifiOff size={14} color={colors.status.warning.text} />
      <Text style={styles.text}>
        Offline — reconnect to refresh live CRELUNE workspace data.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.status.warning.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.status.warning.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.status.warning.text,
    flexShrink: 1,
  },
});
