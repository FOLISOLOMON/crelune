/**
 * CRELUNE — Authoritative Design Tokens: Spacing, Radii, Shadows, Typography
 */

export * from './colors.js';

export const typography = {
  fontFamily: {
    sans: 'var(--font-sans, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif)',
    mono: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)',
  },
  fontSize: {
    xs: ['0.75rem', { lineHeight: '1rem' }],
    sm: ['0.875rem', { lineHeight: '1.25rem' }],
    base: ['1rem', { lineHeight: '1.5rem' }],
    lg: ['1.125rem', { lineHeight: '1.75rem' }],
    xl: ['1.25rem', { lineHeight: '1.75rem' }],
    '2xl': ['1.5rem', { lineHeight: '2rem' }],
    '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
    '4xl': ['2.25rem', { lineHeight: '2.5rem' }],
  },
  fontWeight: {
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
} as const;

export const radii = {
  none: '0px',
  sm: '4px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  '2xl': '20px',
  full: '9999px',
} as const;

export const shadows = {
  sm: '0 1px 2px 0 rgba(36, 33, 43, 0.05)',
  md: '0 4px 6px -1px rgba(36, 33, 43, 0.08), 0 2px 4px -2px rgba(36, 33, 43, 0.05)',
  lg: '0 10px 15px -3px rgba(36, 33, 43, 0.08), 0 4px 6px -4px rgba(36, 33, 43, 0.04)',
  focus: '0 0 0 3px rgba(101, 65, 165, 0.25)',
} as const;

export const spacing = {
  1: '0.25rem',
  2: '0.5rem',
  3: '0.75rem',
  4: '1rem',
  5: '1.25rem',
  6: '1.5rem',
  8: '2rem',
  10: '2.5rem',
  12: '3rem',
  16: '4rem',
  20: '5rem',
} as const;
