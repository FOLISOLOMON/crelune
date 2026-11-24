// Global test setup for @crelune/mobile (Jest + React Native Testing Library)

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  const insets = { top: 44, right: 0, bottom: 34, left: 0 };
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(View, null, children),
    SafeAreaView: ({
      children,
      ...rest
    }: {
      children: React.ReactNode;
      [key: string]: unknown;
    }) => React.createElement(View, rest, children),
    useSafeAreaInsets: () => insets,
    initialWindowMetrics: {
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets,
    },
  };
});

jest.mock('lucide-react-native', () => {
  const React = require('react');
  const { View } = require('react-native');
  return new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === '__esModule') return true;
        return (props: Record<string, unknown>) =>
          React.createElement(View, { testID: `icon-${String(prop)}`, ...props });
      },
    }
  );
});

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  selectionAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

jest.mock('expo-image', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockImage = (props: Record<string, unknown>) => React.createElement(View, props);
  MockImage.clearMemoryCache = jest.fn(async () => true);
  MockImage.clearDiskCache = jest.fn(async () => true);
  return { Image: MockImage };
});

jest.mock('expo-device', () => ({
  modelName: 'CRELUNE Test Device',
  osName: 'Android',
  osVersion: '16',
}));

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '0.1.0',
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      version: '0.1.0',
      extra: {
        appVariant: 'development',
        apiBaseUrl: 'https://api.crelune.test',
      },
    },
  },
}));

jest.mock('expo-crypto', () => {
  let seq = 0;
  return {
    randomUUID: jest.fn(() => {
      seq += 1;
      return `11111111-2222-4333-8444-${String(seq).padStart(12, '0')}`;
    }),
  };
});

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 2,
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    __resetMockStore: () => store.clear(),
    __getMockStore: () => store,
  };
});

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: jest.fn(async () => ({
      isConnected: true,
      isInternetReachable: true,
    })),
    addEventListener: jest.fn(() => jest.fn()),
  },
}));
