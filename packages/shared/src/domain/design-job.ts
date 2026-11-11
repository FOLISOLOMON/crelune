/**
 * CRELUNE — Design Management Domain Rules & Status State Machine
 *
 * Aligns with PRODUCT_MASTER_SPECIFICATION.md Module 4:
 * Exported and Published remain strictly separate explicit transitions.
 */

export const DESIGN_CATEGORIES = [
  'BIRTHDAY_FLYER',
  'CHURCH_PROGRAMME_FLYER',
  'EVENT_ANNOUNCEMENT',
  'SERVICE_FLYER',
  'SOCIAL_MEDIA_GRAPHIC',
  'SPECIAL_EVENT_ARTWORK',
  'GENERAL_GRAPHIC_DESIGN',
] as const;

export type DesignCategory = (typeof DESIGN_CATEGORIES)[number];

export const DESIGN_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;

export type DesignPriority = (typeof DESIGN_PRIORITIES)[number];

export const DESIGN_JOB_STATUSES = [
  'DRAFT',
  'PENDING',
  'IN_PROGRESS',
  'AWAITING_REVIEW',
  'APPROVED',
  'EXPORTED',
  'PUBLISHED',
  'CANCELLED',
] as const;

export type DesignJobStatus = (typeof DESIGN_JOB_STATUSES)[number];

export const ACTIVE_DESIGN_JOB_STATUSES: readonly DesignJobStatus[] = [
  'DRAFT',
  'PENDING',
  'IN_PROGRESS',
  'AWAITING_REVIEW',
  'APPROVED',
  'EXPORTED',
];

export const DESIGN_CATEGORY_LABELS: Record<DesignCategory, string> = {
  BIRTHDAY_FLYER: 'Birthday Flyer',
  CHURCH_PROGRAMME_FLYER: 'Church Programme Flyer',
  EVENT_ANNOUNCEMENT: 'Event Announcement',
  SERVICE_FLYER: 'Service Flyer',
  SOCIAL_MEDIA_GRAPHIC: 'Social Media Graphic',
  SPECIAL_EVENT_ARTWORK: 'Special Event Artwork',
  GENERAL_GRAPHIC_DESIGN: 'General Graphic Design',
};

export const DESIGN_PRIORITY_LABELS: Record<DesignPriority, string> = {
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
  URGENT: 'Urgent',
};

export const DESIGN_JOB_STATUS_LABELS: Record<DesignJobStatus, string> = {
  DRAFT: 'Draft',
  PENDING: 'Pending',
  IN_PROGRESS: 'In Progress',
  AWAITING_REVIEW: 'Awaiting Review',
  APPROVED: 'Approved',
  EXPORTED: 'Exported',
  PUBLISHED: 'Published',
  CANCELLED: 'Cancelled',
};

export const ALLOWED_DESIGN_JOB_TRANSITIONS: Record<
  DesignJobStatus,
  readonly DesignJobStatus[]
> = {
  DRAFT: ['PENDING', 'IN_PROGRESS', 'CANCELLED'],
  PENDING: ['IN_PROGRESS', 'DRAFT', 'CANCELLED'],
  IN_PROGRESS: ['AWAITING_REVIEW', 'PENDING', 'CANCELLED'],
  AWAITING_REVIEW: ['APPROVED', 'IN_PROGRESS', 'CANCELLED'],
  APPROVED: ['EXPORTED', 'IN_PROGRESS', 'CANCELLED'],
  EXPORTED: ['PUBLISHED', 'APPROVED', 'IN_PROGRESS', 'CANCELLED'],
  PUBLISHED: [],
  CANCELLED: ['DRAFT'],
};

export function getAllowedNextDesignJobStatuses(
  current: DesignJobStatus
): readonly DesignJobStatus[] {
  return ALLOWED_DESIGN_JOB_TRANSITIONS[current] ?? [];
}

export function canTransitionDesignJobStatus(
  from: DesignJobStatus,
  to: DesignJobStatus
): boolean {
  if (from === to) {
    return false;
  }
  return getAllowedNextDesignJobStatuses(from).includes(to);
}

export function isActiveDesignJobStatus(status: DesignJobStatus): boolean {
  return status !== 'PUBLISHED' && status !== 'CANCELLED';
}

