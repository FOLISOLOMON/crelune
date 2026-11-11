import { describe, it, expect } from 'vitest';
import { validatePasswordStrength, isValidCallbackUrl } from '@crelune/shared';
import { isAllowedOrigin, validateRequestOriginDetails } from './csrf';

describe('Security Hardening Validations (Milestone 2.1 & 2.1.1)', () => {
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
      expect(isAllowedOrigin(null, 'http://localhost:3000/login', HOST)).toBe(true);
    });

    it('rejects mismatched origins and does not fall back to a valid referer', () => {
      expect(
        validateRequestOriginDetails({
          originHeader: 'https://attacker.com',
          refererHeader: 'http://localhost:3000/login',
          hostHeader: HOST,
        })
      ).toEqual({ allowed: false, reason: 'origin_host_mismatch' });
    });

    it('rejects cross-site referers when Origin is null', () => {
      expect(isAllowedOrigin(null, 'http://attacker.com/evil', HOST)).toBe(false);
    });

    it('rejects when both Origin and Referer are absent', () => {
      expect(
        validateRequestOriginDetails({
          originHeader: null,
          refererHeader: null,
          hostHeader: HOST,
        })
      ).toEqual({ allowed: false, reason: 'missing_origin_and_referer' });
    });

    it('rejects malformed Origin headers (null literal, paths, userinfo, schemes)', () => {
      for (const badOrigin of [
        '',
        'null',
        'not-a-url',
        'javascript:alert(1)',
        'http://localhost:3000/path',
        'http://user:pass@localhost:3000',
        'http://localhost:3000 ',
      ]) {
        expect(
          validateRequestOriginDetails({
            originHeader: badOrigin,
            refererHeader: 'http://localhost:3000/login',
            hostHeader: HOST,
          }).allowed
        ).toBe(false);
      }
    });

    it('rejects malformed Referer headers', () => {
      for (const badRef of ['', 'not-a-url', 'javascript:alert(1)', 'http://user:pass@localhost:3000/login']) {
        expect(
          validateRequestOriginDetails({
            originHeader: null,
            refererHeader: badRef,
            hostHeader: HOST,
          }).allowed
        ).toBe(false);
      }
    });

    it('rejects when Host header is missing or malformed', () => {
      expect(isAllowedOrigin('http://localhost:3000', null, null)).toBe(false);
      expect(isAllowedOrigin('http://localhost:3000', null, 'evil.com/path')).toBe(false);
    });

    describe('Reverse-Proxy & Deployment Configuration', () => {
      it('ignores arbitrary X-Forwarded-Host headers when trustProxy is disabled', () => {
        expect(
          validateRequestOriginDetails({
            originHeader: 'https://evil.com',
            refererHeader: null,
            hostHeader: 'crelune.internal',
            forwardedHostHeader: 'evil.com',
            forwardedProtoHeader: 'https',
            trustProxy: false,
          })
        ).toEqual({ allowed: false, reason: 'origin_host_mismatch' });
      });

      it('allows matching X-Forwarded-Host and X-Forwarded-Proto when trustProxy is enabled', () => {
        expect(
          validateRequestOriginDetails({
            originHeader: 'https://crelune.example.com',
            refererHeader: null,
            hostHeader: '127.0.0.1:3000',
            forwardedHostHeader: 'crelune.example.com',
            forwardedProtoHeader: 'https',
            trustProxy: true,
          })
        ).toEqual({ allowed: true });
      });

      it('rejects protocol downgrade mismatch under trusted reverse proxy', () => {
        expect(
          validateRequestOriginDetails({
            originHeader: 'http://crelune.example.com',
            refererHeader: null,
            hostHeader: '127.0.0.1:3000',
            forwardedHostHeader: 'crelune.example.com',
            forwardedProtoHeader: 'https',
            trustProxy: true,
          })
        ).toEqual({ allowed: false, reason: 'origin_protocol_mismatch' });
      });

      it('enforces explicit ALLOWED_ORIGINS allowlist strictly over Host/Forwarded headers', () => {
        expect(
          validateRequestOriginDetails({
            originHeader: 'https://app.crelune.example',
            refererHeader: null,
            hostHeader: '127.0.0.1:3000',
            allowedOrigins: 'https://app.crelune.example, https://admin.crelune.example',
          })
        ).toEqual({ allowed: true });

        expect(
          validateRequestOriginDetails({
            originHeader: 'http://127.0.0.1:3000',
            refererHeader: null,
            hostHeader: '127.0.0.1:3000',
            allowedOrigins: 'https://app.crelune.example',
          })
        ).toEqual({ allowed: false, reason: 'origin_not_allowlisted' });
      });

      it('supports APP_URL canonical origin match behind reverse proxy', () => {
        expect(
          validateRequestOriginDetails({
            originHeader: 'https://studio.crelune.example',
            refererHeader: null,
            hostHeader: '127.0.0.1:3000',
            appUrl: 'https://studio.crelune.example',
          })
        ).toEqual({ allowed: true });
      });
    });
  });
});
