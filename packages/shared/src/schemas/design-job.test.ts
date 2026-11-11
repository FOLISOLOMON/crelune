import { describe, expect, it } from 'vitest';
import {
  birthdayOverviewQuerySchema,
  birthdayPreferencesUpdateSchema,
  birthdayPrepStatusUpdateSchema,
  birthdayPrepTargetYearParamSchema,
} from './birthday';
import {
  createDesignJobSchema,
  designJobListQuerySchema,
  transitionDesignJobSchema,
  updateDesignJobSchema,
} from './design-job';

describe('Design Job & Birthday Stage 3.6 Zod Schemas', () => {
  it('requires a linked member and birthdayTargetYear for BIRTHDAY_FLYER jobs and rejects year on non-birthday jobs', () => {
    expect(
      createDesignJobSchema.safeParse({
        title: 'Member Birthday Flyer',
        category: 'BIRTHDAY_FLYER',
        birthdayTargetYear: 2026,
      }).success
    ).toBe(false);

    expect(
      createDesignJobSchema.safeParse({
        title: 'Member Birthday Flyer',
        category: 'BIRTHDAY_FLYER',
        memberId: 'mem_123',
      }).success
    ).toBe(false);

    expect(
      createDesignJobSchema.safeParse({
        title: 'Service Flyer With Stranded Year',
        category: 'SERVICE_FLYER',
        memberId: 'mem_123',
        birthdayTargetYear: 2026,
      }).success
    ).toBe(false);

    expect(
      createDesignJobSchema.safeParse({
        title: 'Complete Birthday Flyer',
        category: 'BIRTHDAY_FLYER',
        memberId: 'mem_123',
        birthdayTargetYear: 2026,
      }).success
    ).toBe(true);
  });

  it('accepts valid civil dueDate and normalizes optional blank fields to null', () => {
    const result = createDesignJobSchema.safeParse({
      title: '  Midweek Service Poster  ',
      category: 'SERVICE_FLYER',
      priority: 'HIGH',
      dueDate: '2026-11-20',
      dimensions: '   ',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe('Midweek Service Poster');
      expect(result.data.dueDate).toBe('2026-11-20');
      expect(result.data.dimensions).toBeNull();
    }
  });

  it('rejects impossible calendar dueDate values', () => {
    const result = createDesignJobSchema.safeParse({
      title: 'Invalid Date Flyer',
      dueDate: '2026-02-30',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty update payloads, invalid birthday update combos, and enforces transition status enum', () => {
    expect(updateDesignJobSchema.safeParse({}).success).toBe(false);
    expect(
      updateDesignJobSchema.safeParse({
        category: 'BIRTHDAY_FLYER',
        memberId: null,
      }).success
    ).toBe(false);
    expect(
      updateDesignJobSchema.safeParse({
        category: 'SERVICE_FLYER',
        birthdayTargetYear: 2026,
      }).success
    ).toBe(false);
    expect(
      updateDesignJobSchema.safeParse({
        category: 'GENERAL_GRAPHIC_DESIGN',
        birthdayTargetYear: null,
        memberId: null,
      }).success
    ).toBe(true);
    expect(
      transitionDesignJobSchema.safeParse({ status: 'PUBLISHED', note: 'Posted' })
        .success
    ).toBe(true);
    expect(
      transitionDesignJobSchema.safeParse({ status: 'DISPATCHED' }).success
    ).toBe(false);
  });

  it('defaults designJobListQuerySchema to active queue', () => {
    const parsed = designJobListQuerySchema.parse({});
    expect(parsed.status).toBe('active');
    expect(parsed.category).toBe('ALL');
    expect(parsed.priority).toBe('ALL');
  });

  it('validates birthday overview queries, prep status updates, and preferences', () => {
    expect(
      birthdayOverviewQuerySchema.parse({ month: '11', year: '2026' })
    ).toMatchObject({ month: 11, year: 2026, prepStatus: 'ALL' });

    expect(birthdayPrepTargetYearParamSchema.safeParse('2026').success).toBe(true);
    expect(birthdayPrepTargetYearParamSchema.safeParse('1800').success).toBe(false);

    expect(
      birthdayPrepStatusUpdateSchema.safeParse({
        status: 'DESIGN_IN_PROGRESS',
        notes: 'Working on portrait crop',
      }).success
    ).toBe(true);

    expect(
      birthdayPreferencesUpdateSchema.safeParse({
        timezone: 'Invalid/Timezone',
        leapDayPolicy: 'FEB_28',
        birthdayReminderDays: [7, 1, 0],
      }).success
    ).toBe(false);

    expect(
      birthdayPreferencesUpdateSchema.safeParse({
        timezone: 'Europe/London',
        leapDayPolicy: 'MAR_1',
        birthdayReminderDays: [7, 3, 1, 0],
      }).success
    ).toBe(true);
  });
});

