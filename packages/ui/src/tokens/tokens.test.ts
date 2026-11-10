import { describe, it, expect } from 'vitest';
import { colors, radii, spacing, shadows } from './index.js';

describe('Design System Tokens', () => {
  it('defines the approved primary brand colors', () => {
    expect(colors.primary.DEFAULT).toBe('#6541A5');
    expect(colors.lavender.DEFAULT).toBe('#A99AD1');
    expect(colors.background).toBe('#F8F7FA');
    expect(colors.surface.DEFAULT).toBe('#FFFFFF');
    expect(colors.text.primary).toBe('#24212B');
    expect(colors.text.secondary).toBe('#77727F');
    expect(colors.border.DEFAULT).toBe('#E8E5ED');
  });

  it('defines semantic status colors', () => {
    expect(colors.status.success.DEFAULT).toBe('#16A34A');
    expect(colors.status.error.DEFAULT).toBe('#DC2626');
    expect(colors.status.warning.DEFAULT).toBe('#D97706');
    expect(colors.status.info.DEFAULT).toBe('#2563EB');
  });

  it('defines consistent radii and spacing', () => {
    expect(radii.md).toBe('8px');
    expect(radii.lg).toBe('12px');
    expect(spacing[4]).toBe('1rem');
    expect(shadows.sm).toBeDefined();
  });
});
