import { describe, it, expect } from 'vitest';
import { validatePasswordStrength, isValidCallbackUrl } from '@crelune/shared';
import { isAllowedOrigin } from './csrf';

describe('Security Hardening Validations (Milestone 2.1)', () => {
  describe('Password Strength Validation', () => {
    it('accepts a strong, non-trivial password', () => {
      expect(validatePasswordStrength('cReLuNe_OpS#2026!Master')).toBeNull();
      expect(validatePasswordStrength('correct-horse-battery-staple')).toBeNull();
    });

    it('rejects passwords shorter than 8 characters', () => {
      expect(validatePasswordStrength('1234567')).toBe('Password must be at least 8 characters long.');
      expect(validatePasswordStrength('')).toBe('Password must be at least 8 characters long.');
    });

    it('rejects trivial or common dictionary passwords', () => {
      expect(validatePasswordStrength('password')).toContain('too common or trivial');
      expect(validatePasswordStrength('12345678')).toContain('too common or trivial');
      expect(validatePasswordStrength('admin123')).toContain('too common or trivial');
      expect(validatePasswordStrength('crelune123')).toContain('too common or trivial');
      expect(validatePasswordStrength('qwertyuiop')).toContain('too common or trivial');
    });

    it('rejects excessively long passwords (> 128 characters)', () => {
      expect(validatePasswordStrength('a'.repeat(129))).toBe('Password must not exceed 128 characters.');
    });
  });

  describe('Callback URL Open Redirect Protection', () => {
    it('allows valid internal relative paths', () => {
      expect(isValidCallbackUrl('/')).toBe(true);
      expect(isValidCallbackUrl('/members')).toBe(true);
      expect(isValidCallbackUrl('/settings?tab=security')).toBe(true);
      expect(isValidCallbackUrl('/templates/affinity-01')).toBe(true);
    });

    it('rejects protocol-relative URLs (//evil.com)', () => {
      expect(isValidCallbackUrl('//evil.com')).toBe(false);
      expect(isValidCallbackUrl('//evil.com/phish')).toBe(false);
    });

    it('rejects backslash-relative URLs (/\\evil.com)', () => {
      expect(isValidCallbackUrl('/\\evil.com')).toBe(false);
    });

    it('rejects absolute URLs with schemes (http:, https:, javascript:)', () => {
      expect(isValidCallbackUrl('https://evil.com')).toBe(false);
      expect(isValidCallbackUrl('http://localhost:3000')).toBe(false);
      expect(isValidCallbackUrl('javascript:alert(1)')).toBe(false);
      expect(isValidCallbackUrl('data:text/html,<script>')).toBe(false);
    });

    it('rejects non-string or empty inputs', () => {
      expect(isValidCallbackUrl(null)).toBe(false);
      expect(isValidCallbackUrl(undefined)).toBe(false);
      expect(isValidCallbackUrl('')).toBe(false);
      expect(isValidCallbackUrl(12345)).toBe(false);
    });
  });

  describe('CSRF Origin & Referer Verification', () => {
    const HOST = 'localhost:3000';

    it('allows requests when Origin host matches Host header', () => {
      expect(isAllowedOrigin('http://localhost:3000', null, HOST)).toBe(true);
      expect(isAllowedOrigin('https://localhost:3000', null, HOST)).toBe(true);
    });

    it('allows requests when Referer host matches Host header if Origin is null', () => {
      expect(isAllowedOrigin(null, 'http://localhost:3000/dashboard', HOST)).toBe(true);
    });

    it('rejects cross-site origins', () => {
      expect(isAllowedOrigin('http://attacker.com', null, HOST)).toBe(false);
      expect(isAllowedOrigin('https://malicious.org', null, HOST)).toBe(false);
    });

    it('rejects cross-site referers', () => {
      expect(isAllowedOrigin(null, 'http://attacker.com/evil', HOST)).toBe(false);
    });

    it('rejects when both Origin and Referer are absent', () => {
      expect(isAllowedOrigin(null, null, HOST)).toBe(false);
    });

    it('rejects when Host header is absent', () => {
      expect(isAllowedOrigin('http://localhost:3000', null, null)).toBe(false);
    });
  });
});
