/**
 * CRELUNE Mobile — Authoritative Native Design Tokens
 *
 * Imports canonical brand hex values directly from `@crelune/ui/colors`
 * (pure hex subpath with zero web DOM imports) and pairs them with native
 * numeric spacing, border radii, typography, and accessible touch targets.
 */

import { colors } from '@crelune/ui/colors';
import type { TextStyle } from 'react-native';

export { colors };

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
} as const;

export const radii = {
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  pill: 9999,
} as const;

export const touchTarget = {
  /** Exceeds both iOS (44pt) and Android (48dp) accessibility minimums. */
  min: 48,
} as const;

export const typography: Record<string, TextStyle> = {
  display: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700',
    letterSpacing: -0.4,
    color: colors.text.primary,
  },
  title: {
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: colors.text.primary,
  },
  sectionTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    letterSpacing: -0.1,
    color: colors.text.primary,
  },
  cardTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.text.primary,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
    color: colors.text.primary,
  },
  bodyStrong: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.text.primary,
  },
  secondary: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '400',
    color: colors.text.secondary,
  },
  label: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: colors.text.primary,
  },
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: colors.text.secondary,
  },
  metric: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    color: colors.text.primary,
  },
};

export const theme = {
  colors,
  spacing,
  radii,
  touchTarget,
  typography,
} as const;
