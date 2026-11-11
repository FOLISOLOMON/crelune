import { describe, expect, it } from 'vitest';
import {
  ACTIVE_DESIGN_JOB_STATUSES,
  ALLOWED_DESIGN_JOB_TRANSITIONS,
  canTransitionDesignJobStatus,
  DESIGN_JOB_STATUSES,
  getAllowedNextDesignJobStatuses,
  isActiveDesignJobStatus,
} from './design-job';

describe('Design Job State Machine', () => {
  it('keeps EXPORTED and PUBLISHED as distinct sequential transitions', () => {
    expect(canTransitionDesignJobStatus('APPROVED', 'EXPORTED')).toBe(true);
    expect(canTransitionDesignJobStatus('APPROVED', 'PUBLISHED')).toBe(false);
    expect(canTransitionDesignJobStatus('EXPORTED', 'PUBLISHED')).toBe(true);
    expect(canTransitionDesignJobStatus('PUBLISHED', 'EXPORTED')).toBe(false);
    expect(getAllowedNextDesignJobStatuses('PUBLISHED')).toEqual([]);
  });

  it('rejects self-transitions across all statuses', () => {
    for (const status of DESIGN_JOB_STATUSES) {
      expect(canTransitionDesignJobStatus(status, status)).toBe(false);
    }
  });

  it('allows reopening a CANCELLED job only to DRAFT', () => {
    expect(ALLOWED_DESIGN_JOB_TRANSITIONS.CANCELLED).toEqual(['DRAFT']);
    expect(canTransitionDesignJobStatus('CANCELLED', 'DRAFT')).toBe(true);
    expect(canTransitionDesignJobStatus('CANCELLED', 'PUBLISHED')).toBe(false);
  });

  it('excludes PUBLISHED and CANCELLED from active design queue', () => {
    for (const status of ACTIVE_DESIGN_JOB_STATUSES) {
      expect(isActiveDesignJobStatus(status)).toBe(true);
    }
    expect(isActiveDesignJobStatus('PUBLISHED')).toBe(false);
    expect(isActiveDesignJobStatus('CANCELLED')).toBe(false);
  });
});

