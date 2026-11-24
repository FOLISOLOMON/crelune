/**
 * CRELUNE Mobile — Environment & Secure Transport Configuration
 *
 * Security Invariants:
 * - Zero server secrets are ever read or bundled into the mobile app.
 * - Release builds (`!isDev`) fail closed if `API_BASE_URL` is missing or non-HTTPS.
 * - Development builds allow `http://` ONLY for explicit local hosts
 *   (`10.0.2.2`, `localhost`, `127.0.0.1`, or private RFC-1918 LAN IPv4 addresses).
 */

import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import type { MobileDeviceMetadataInput, MobilePlatform } from '@crelune/shared';

export class MobileConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MobileConfigError';
  }
}

const PRIVATE_LAN_IPV4_PATTERNS = [
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/,
];

function isAllowedDevHttpHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower === '127.0.0.1' || lower === '10.0.2.2') {
    return true;
  }
  return PRIVATE_LAN_IPV4_PATTERNS.some((pattern) => pattern.test(lower));
}

export function validateApiBaseUrl(
  rawUrl: string,
  options: { isDev: boolean }
): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new MobileConfigError('CRELUNE API URL is required.');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new MobileConfigError('CRELUNE API URL is malformed.');
  }

  if (parsed.username || parsed.password) {
    throw new MobileConfigError('CRELUNE API URL must not embed credentials.');
  }
  if (parsed.search || parsed.hash) {
    throw new MobileConfigError(
      'CRELUNE API URL must not contain query parameters or fragments.'
    );
  }

  if (parsed.protocol === 'https:') {
    return parsed.origin + parsed.pathname.replace(/\/+$/, '');
  }

  if (parsed.protocol === 'http:') {
    if (!options.isDev) {
      throw new MobileConfigError(
        'HTTPS is mandatory for CRELUNE API connections in release builds.'
      );
    }
    if (!isAllowedDevHttpHost(parsed.hostname)) {
      throw new MobileConfigError(
        `Cleartext HTTP is permitted only for local development hosts, not "${parsed.hostname}".`
      );
    }
    return parsed.origin + parsed.pathname.replace(/\/+$/, '');
  }

  throw new MobileConfigError(
    `Unsupported API URL protocol "${parsed.protocol}". Use HTTPS.`
  );
}

export function getDefaultDevApiBaseUrl(platformOs: string = Platform.OS): string {
  // Android Emulator maps host machine loopback 127.0.0.1 to 10.0.2.2
  return platformOs === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';
}

export function resolveMobileApiBaseUrl(options?: {
  overrideUrl?: string | null;
  isDev?: boolean;
  platformOs?: string;
}): string {
  const isDev = options?.isDev ?? Boolean(typeof __DEV__ !== 'undefined' && __DEV__);
  const platformOs = options?.platformOs ?? Platform.OS;

  const extra = Constants.expoConfig?.extra as
    | { apiBaseUrl?: string | null }
    | undefined;
  const configured =
    options?.overrideUrl ??
    process.env.EXPO_PUBLIC_API_BASE_URL ??
    extra?.apiBaseUrl ??
    null;

  if (configured && configured.trim().length > 0) {
    return validateApiBaseUrl(configured, { isDev });
  }

  if (isDev) {
    return validateApiBaseUrl(getDefaultDevApiBaseUrl(platformOs), { isDev: true });
  }

  throw new MobileConfigError(
    'EXPO_PUBLIC_API_BASE_URL must be configured with an HTTPS URL for release builds.'
  );
}

export function getAppVariant(): 'development' | 'preview' | 'production' {
  const extra = Constants.expoConfig?.extra as
    | { appVariant?: string }
    | undefined;
  if (extra?.appVariant === 'production') return 'production';
  if (extra?.appVariant === 'preview') return 'preview';
  return 'development';
}

export function getClientPlatform(): MobilePlatform {
  return Platform.OS === 'ios' ? 'IOS' : 'ANDROID';
}

export function buildDeviceMetadata(
  deviceInstallId: string
): MobileDeviceMetadataInput {
  const platform = getClientPlatform();
  const osLabel = [Device.osName ?? (platform === 'IOS' ? 'iOS' : 'Android'), Device.osVersion]
    .filter(Boolean)
    .join(' ')
    .slice(0, 60);

  return {
    deviceInstallId,
    platform,
    deviceName: (Device.modelName ?? `${platform} Device`).slice(0, 120),
    osVersion: osLabel || null,
    appVersion: (
      Application.nativeApplicationVersion ??
      Constants.expoConfig?.version ??
      '0.1.0'
    ).slice(0, 40),
  };
}
