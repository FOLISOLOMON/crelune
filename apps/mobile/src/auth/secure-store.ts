/**
 * CRELUNE Mobile — Secure Credential Storage (`expo-secure-store`)
 *
 * Security Invariants:
 * - Stores mobile access/refresh tokens exclusively in OS hardware-backed storage
 *   (iOS Keychain `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` / Android Keystore).
 * - Never writes credentials to AsyncStorage, logs, or URLs.
 * - Throws `SecureStoragePersistenceError` on write failure so callers fail closed
 *   rather than leaving a rotated-out refresh token active in memory or storage.
 */

import {
  MOBILE_DEVICE_INSTALL_ID_REGEX,
  type MobileAuthSessionResponse,
} from '@crelune/shared';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { mobileAuthSessionResponseSchema } from '@/api/schemas';

export const CREDENTIALS_STORAGE_KEY = 'crelune.auth.credentials.v1';
export const DEVICE_INSTALL_ID_STORAGE_KEY = 'crelune.auth.device_install_id.v1';

export type StoredMobileCredentials = MobileAuthSessionResponse;

export class SecureStoragePersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecureStoragePersistenceError';
  }
}

export interface CredentialStorageAdapter {
  saveCredentials(credentials: StoredMobileCredentials): Promise<void>;
  loadCredentials(): Promise<StoredMobileCredentials | null>;
  clearCredentials(): Promise<void>;
  getOrCreateDeviceInstallId(): Promise<string>;
}

const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

function generateDeviceInstallId(): string {
  const compactUuid = Crypto.randomUUID().replace(/-/g, '');
  return `cln_dev_${compactUuid}`;
}

export function createExpoSecureCredentialStorage(): CredentialStorageAdapter {
  return {
    async saveCredentials(credentials: StoredMobileCredentials): Promise<void> {
      const validated = mobileAuthSessionResponseSchema.safeParse(credentials);
      if (!validated.success) {
        throw new SecureStoragePersistenceError(
          'Refusing to persist malformed mobile credentials.'
        );
      }

      try {
        await SecureStore.setItemAsync(
          CREDENTIALS_STORAGE_KEY,
          JSON.stringify(validated.data),
          SECURE_STORE_OPTIONS
        );
      } catch {
        throw new SecureStoragePersistenceError(
          'Unable to persist credentials to secure device storage.'
        );
      }
    },

    async loadCredentials(): Promise<StoredMobileCredentials | null> {
      let raw: string | null;
      try {
        raw = await SecureStore.getItemAsync(
          CREDENTIALS_STORAGE_KEY,
          SECURE_STORE_OPTIONS
        );
      } catch {
        return null;
      }

      if (!raw) {
        return null;
      }

      try {
        const parsedJson = JSON.parse(raw);
        const validated = mobileAuthSessionResponseSchema.safeParse(parsedJson);
        if (!validated.success) {
          // Clear corrupted credential blob safely
          await SecureStore.deleteItemAsync(
            CREDENTIALS_STORAGE_KEY,
            SECURE_STORE_OPTIONS
          ).catch(() => {});
          return null;
        }
        return validated.data;
      } catch {
        await SecureStore.deleteItemAsync(
          CREDENTIALS_STORAGE_KEY,
          SECURE_STORE_OPTIONS
        ).catch(() => {});
        return null;
      }
    },

    async clearCredentials(): Promise<void> {
      try {
        await SecureStore.deleteItemAsync(
          CREDENTIALS_STORAGE_KEY,
          SECURE_STORE_OPTIONS
        );
      } catch {
        // Best-effort delete; never throw sensitive diagnostics
      }
    },

    async getOrCreateDeviceInstallId(): Promise<string> {
      try {
        const existing = await SecureStore.getItemAsync(
          DEVICE_INSTALL_ID_STORAGE_KEY,
          SECURE_STORE_OPTIONS
        );
        if (existing && MOBILE_DEVICE_INSTALL_ID_REGEX.test(existing)) {
          return existing;
        }
      } catch {
        // Fall through to generate a fresh ID
      }

      const freshId = generateDeviceInstallId();
      try {
        await SecureStore.setItemAsync(
          DEVICE_INSTALL_ID_STORAGE_KEY,
          freshId,
          SECURE_STORE_OPTIONS
        );
      } catch {
        throw new SecureStoragePersistenceError(
          'Unable to persist device installation identifier to secure storage.'
        );
      }
      return freshId;
    },
  };
}
