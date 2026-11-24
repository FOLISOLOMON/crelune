import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { mobileQueryClient } from '@/auth/runtime';
import { AuthNavigationGate } from '@/components/navigation/AuthNavigationGate';
import { OfflineBar } from '@/components/ui/OfflineBar';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';
import { NetworkProvider } from '@/providers/NetworkProvider';
import { colors } from '@/theme/tokens';

void SplashScreen.preventAutoHideAsync().catch(() => {});

function RootShell() {
  const { status } = useAuth();

  useEffect(() => {
    if (status !== 'hydrating') {
      void SplashScreen.hideAsync().catch(() => {});
    }
  }, [status]);

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <OfflineBar />
      <AuthNavigationGate>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
      </AuthNavigationGate>
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={mobileQueryClient}>
        <NetworkProvider>
          <AuthProvider>
            <RootShell />
          </AuthProvider>
        </NetworkProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
