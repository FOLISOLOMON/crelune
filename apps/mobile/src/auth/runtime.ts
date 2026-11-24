/**
 * CRELUNE Mobile — Application-Wide Auth, Cache & API Runtime Singletons
 *
 * Guarantees ONE single SessionManager (`refreshInFlightPromise`), ONE QueryClient,
 * and ONE CreluneApiClient across the entire application lifecycle.
 */

import { QueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { CreluneApiClient, isRetryableQueryError } from '@/api/client';
import { createExpoSecureCredentialStorage } from '@/auth/secure-store';
import { SessionManager } from '@/auth/session-manager';
import { buildDeviceMetadata, resolveMobileApiBaseUrl } from '@/config/env';

export async function clearPrivateImageMemoryCache(): Promise<void> {
  try {
    if (typeof Image?.clearMemoryCache === 'function') {
      await Image.clearMemoryCache();
    }
  } catch {
    // Best-effort cache clear
  }
}

export const mobileQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnReconnect: true,
      retry: (failureCount, error) => failureCount < 1 && isRetryableQueryError(error),
    },
    mutations: {
      retry: false,
    },
  },
});

export const mobileSessionManager = new SessionManager({
  storage: createExpoSecureCredentialStorage(),
  getApiBaseUrl: () => resolveMobileApiBaseUrl(),
  buildDeviceMetadata,
  onClearProtectedCaches: async () => {
    mobileQueryClient.clear();
    await clearPrivateImageMemoryCache();
  },
});

export const mobileApiClient = new CreluneApiClient({
  sessionManager: mobileSessionManager,
  getApiBaseUrl: () => resolveMobileApiBaseUrl(),
});
