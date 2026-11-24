const path = require('node:path');

module.exports = {
  preset: 'jest-expo',
  rootDir: __dirname,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx', '<rootDir>/app/**/*.test.tsx'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@crelune/ui/colors$': path.resolve(__dirname, '../../packages/ui/dist/tokens/colors.js'),
    '^@crelune/shared$': path.resolve(__dirname, '../../packages/shared/dist/index.js'),
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|lucide-react-native|@tanstack/react-query)',
  ],
};
