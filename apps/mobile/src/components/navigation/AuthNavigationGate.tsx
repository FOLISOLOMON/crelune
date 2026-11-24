import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { BrandMark } from '@/components/ui/BrandMark';
import { useAuth } from '@/providers/AuthProvider';
import { colors, spacing, typography } from '@/theme/tokens';

export interface AuthNavigationGateProps {
  children: React.ReactNode;
}

/**
 * Single-shot declarative navigation gate driven by SessionManager auth status.
 * Prevents redirect loops and blocks protected tabs from flashing during hydration.
 */
export function AuthNavigationGate({ children }: AuthNavigationGateProps) {
  const { status, isAuthenticated } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const lastRedirectRef = useRef<string | null>(null);

  const rootSegment = segments[0];

  useEffect(() => {
    if (status === 'hydrating') {
      return;
    }

    const inAuthGroup = rootSegment === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      if (lastRedirectRef.current !== '/(auth)/login') {
        lastRedirectRef.current = '/(auth)/login';
        router.replace('/(auth)/login');
      }
      return;
    }

    if (isAuthenticated && inAuthGroup) {
      if (lastRedirectRef.current !== '/(tabs)') {
        lastRedirectRef.current = '/(tabs)';
        router.replace('/(tabs)');
      }
      return;
    }

    lastRedirectRef.current = null;
  }, [status, isAuthenticated, rootSegment, router]);

  if (status === 'hydrating') {
    return (
      <View
        testID="auth-hydrating-screen"
        accessibilityLabel="Checking CRELUNE session"
        style={styles.hydratingContainer}
      >
        <BrandMark size={52} showWordmark showTagline />
        <View style={styles.spinnerRow}>
          <ActivityIndicator size="small" color={colors.primary.DEFAULT} />
          <Text style={styles.hydratingText}>Checking your session…</Text>
        </View>
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  hydratingContainer: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing['2xl'],
    gap: spacing.xl,
  },
  spinnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  hydratingText: {
    ...typography.secondary,
  },
});
