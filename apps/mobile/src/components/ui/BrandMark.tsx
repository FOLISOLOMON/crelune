import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors, spacing } from '@/theme/tokens';

export interface BrandMarkProps {
  size?: number;
  showWordmark?: boolean;
  showTagline?: boolean;
}

export function BrandMark({
  size = 44,
  showWordmark = true,
  showTagline = false,
}: BrandMarkProps) {
  const radius = size * 0.31;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <View style={styles.container}>
      <View style={[styles.badge, { width: size, height: size, borderRadius: size * 0.28 }]}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={colors.text.inverted}
            strokeWidth={Math.max(2.5, size * 0.08)}
            strokeLinecap="round"
            strokeDasharray={`${circumference * 0.72} ${circumference * 0.28}`}
            transform={`rotate(-35 ${center} ${center})`}
          />
          <Circle
            cx={center + radius * 0.58}
            cy={center - radius * 0.58}
            r={Math.max(2.5, size * 0.075)}
            fill={colors.lavender.light}
          />
        </Svg>
      </View>

      {showWordmark && (
        <View style={styles.wordmarkBlock}>
          <Text style={styles.wordmark}>CRELUNE</Text>
          {showTagline && (
            <Text style={styles.tagline}>
              Create. Organise. Bring ideas to life.
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  badge: {
    backgroundColor: colors.primary.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmarkBlock: {
    flexShrink: 1,
  },
  wordmark: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 1.4,
    color: colors.text.primary,
  },
  tagline: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    color: colors.text.secondary,
  },
});
