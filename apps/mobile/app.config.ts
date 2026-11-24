import type { ConfigContext, ExpoConfig } from 'expo/config';

export type AppVariant = 'development' | 'preview' | 'production';

function resolveVariant(): AppVariant {
  const raw = (process.env.APP_VARIANT ?? 'development').trim().toLowerCase();
  if (raw === 'production') return 'production';
  if (raw === 'preview') return 'preview';
  return 'development';
}

const VARIANT_CONFIG: Record<
  AppVariant,
  {
    name: string;
    bundleIdentifier: string;
    androidPackage: string;
    scheme: string;
  }
> = {
  development: {
    name: 'CRELUNE (Dev)',
    bundleIdentifier: 'com.crelune.app.dev',
    androidPackage: 'com.crelune.app.dev',
    scheme: 'crelune-dev',
  },
  preview: {
    name: 'CRELUNE (Preview)',
    bundleIdentifier: 'com.crelune.app.preview',
    androidPackage: 'com.crelune.app.preview',
    scheme: 'crelune-preview',
  },
  production: {
    name: 'CRELUNE',
    bundleIdentifier: 'com.crelune.app',
    androidPackage: 'com.crelune.app',
    scheme: 'crelune',
  },
};

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = resolveVariant();
  const profile = VARIANT_CONFIG[variant];
  const easProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim() || undefined;

  return {
    ...config,
    name: profile.name,
    slug: 'crelune',
    version: '0.1.0',
    orientation: 'portrait',
    scheme: profile.scheme,
    userInterfaceStyle: 'light',
    backgroundColor: '#F8F7FA',
    icon: './assets/images/icon.png',
    ios: {
      supportsTablet: false,
      bundleIdentifier: profile.bundleIdentifier,
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSCameraUsageDescription:
          'CRELUNE uses your camera so you can photograph members and attach portraits directly to their private member profiles.',
        NSPhotoLibraryUsageDescription:
          'CRELUNE accesses your selected photos so you can attach member portraits to private profiles and creative design requests.',
      },
    },
    android: {
      package: profile.androidPackage,
      adaptiveIcon: {
        foregroundImage: './assets/images/adaptive-icon.png',
        backgroundColor: '#6541A5',
      },
      permissions: ['INTERNET'],
      blockedPermissions: [
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
      ],
    },
    plugins: [
      'expo-router',
      'expo-secure-store',
      'expo-font',
      [
        'expo-splash-screen',
        {
          backgroundColor: '#F8F7FA',
          image: './assets/images/splash-icon.png',
          imageWidth: 160,
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      appVariant: variant,
      apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL?.trim() || null,
      ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
    },
  };
};
