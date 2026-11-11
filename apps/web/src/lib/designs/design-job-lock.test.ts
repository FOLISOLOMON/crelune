import { describe, expect, it } from 'vitest';
import { deriveBirthdayDesignJobLockKeys } from './design-job-service';

describe('deriveBirthdayDesignJobLockKeys', () => {
  it('produces deterministic signed 32-bit integer pairs', () => {
    const a = deriveBirthdayDesignJobLockKeys({
      organisationId: 'org-1',
      memberId: 'member-1',
      targetYear: 2026,
    });
    const b = deriveBirthdayDesignJobLockKeys({
      organisationId: 'org-1',
      memberId: 'member-1',
      targetYear: 2026,
    });

    expect(a).toEqual(b);
    expect(Number.isInteger(a[0])).toBe(true);
    expect(Number.isInteger(a[1])).toBe(true);
    expect(a[0]).toBeGreaterThanOrEqual(-2147483648);
    expect(a[0]).toBeLessThanOrEqual(2147483647);
    expect(a[1]).toBeGreaterThanOrEqual(-2147483648);
    expect(a[1]).toBeLessThanOrEqual(2147483647);
  });

  it('prevents delimiter ambiguity and separates orgs, members, and years', () => {
    const splitA = deriveBirthdayDesignJobLockKeys({
      organisationId: 'org|a',
      memberId: 'mem',
      targetYear: 2026,
    });
    const splitB = deriveBirthdayDesignJobLockKeys({
      organisationId: 'org',
      memberId: 'a|mem',
      targetYear: 2026,
    });
    const nextYear = deriveBirthdayDesignJobLockKeys({
      organisationId: 'org|a',
      memberId: 'mem',
      targetYear: 2027,
    });
    const otherMember = deriveBirthdayDesignJobLockKeys({
      organisationId: 'org|a',
      memberId: 'mem-2',
      targetYear: 2026,
    });

    expect(splitA).not.toEqual(splitB);
    expect(splitA).not.toEqual(nextYear);
    expect(splitA).not.toEqual(otherMember);
  });
});
