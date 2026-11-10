/**
 * CRELUNE — Authoritative Design Tokens: Color Palette
 *
 * Implements the approved creative operations brand palette:
 * Primary: #6541A5
 * Muted lavender: #A99AD1
 * Background: #F8F7FA
 * Surface: #FFFFFF
 * Main text: #24212B
 * Secondary text: #77727F
 * Border: #E8E5ED
 */

export const colors = {
  // Brand foundation
  primary: {
    DEFAULT: '#6541A5',
    hover: '#54348C',
    active: '#452A74',
    light: '#F2EDFA',
    subtle: '#EAE3F7',
  },
  lavender: {
    DEFAULT: '#A99AD1',
    light: '#D3CAEC',
    subtle: '#EFEBF8',
  },

  // Surfaces and Layout
  background: '#F8F7FA',
  surface: {
    DEFAULT: '#FFFFFF',
    subtle: '#FBFBFC',
    muted: '#F3F2F6',
  },

  // Typography
  text: {
    primary: '#24212B',
    secondary: '#77727F',
    muted: '#9B96A4',
    inverted: '#FFFFFF',
  },

  // Borders & Dividers
  border: {
    DEFAULT: '#E8E5ED',
    subtle: '#F0EEF4',
    focus: '#6541A5',
  },

  // Semantic Status
  status: {
    success: {
      DEFAULT: '#16A34A',
      background: '#F0FDF4',
      border: '#BBF7D0',
      text: '#166534',
    },
    warning: {
      DEFAULT: '#D97706',
      background: '#FFFBEB',
      border: '#FDE68A',
      text: '#92400E',
    },
    error: {
      DEFAULT: '#DC2626',
      background: '#FEF2F2',
      border: '#FECACA',
      text: '#991B1B',
    },
    info: {
      DEFAULT: '#2563EB',
      background: '#EFF6FF',
      border: '#BFDBFE',
      text: '#1E40AF',
    },
  },
} as const;

export type ColorTokens = typeof colors;
