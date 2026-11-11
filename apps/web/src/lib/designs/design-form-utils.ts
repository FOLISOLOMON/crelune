import {
  createDesignJobSchema,
  updateDesignJobSchema,
  type BirthdayPrepStatus,
  type CreateDesignJobInput,
  type DesignCategory,
  type DesignJobDetail,
  type DesignJobStatus,
  type DesignPriority,
  type UpdateDesignJobInput,
} from '@crelune/shared';

export type DesignBadgeVariant =
  | 'default'
  | 'primary'
  | 'success'
  | 'warning'
  | 'error'
  | 'info';

export function getDesignStatusBadgeVariant(
  status: DesignJobStatus
): DesignBadgeVariant {
  switch (status) {
    case 'PUBLISHED':
      return 'success';
    case 'APPROVED':
    case 'EXPORTED':
    case 'IN_PROGRESS':
      return 'primary';
    case 'AWAITING_REVIEW':
      return 'warning';
    case 'CANCELLED':
      return 'error';
    case 'PENDING':
      return 'info';
    case 'DRAFT':
    default:
      return 'default';
  }
}

export function getDesignPriorityBadgeVariant(
  priority: DesignPriority
): DesignBadgeVariant {
  switch (priority) {
    case 'URGENT':
      return 'error';
    case 'HIGH':
      return 'warning';
    case 'LOW':
    case 'NORMAL':
    default:
      return 'default';
  }
}

export function getBirthdayPrepBadgeVariant(
  status: BirthdayPrepStatus
): DesignBadgeVariant {
  switch (status) {
    case 'PUBLISHED':
      return 'success';
    case 'AWAITING_APPROVAL':
      return 'warning';
    case 'DESIGN_IN_PROGRESS':
      return 'primary';
    case 'PREPARATION_PENDING':
      return 'info';
    case 'SKIPPED':
    case 'UPCOMING':
    default:
      return 'default';
  }
}

export function formatCivilIsoDisplay(isoDate: string | null | undefined): string {
  if (!isoDate) return 'No due date';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const monthNames = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const monthIdx = Number.parseInt(match[2], 10) - 1;
  const day = Number.parseInt(match[3], 10);
  const year = match[1];
  const monthLabel = monthNames[monthIdx] ?? match[2];
  return `${day} ${monthLabel} ${year}`;
}

export interface DesignJobFormValues {
  title: string;
  category: DesignCategory;
  priority: DesignPriority;
  initialStatus: 'DRAFT' | 'PENDING';
  memberId: string;
  birthdayTargetYear: string;
  dueDate: string;
  targetPlatform: string;
  dimensions: string;
  requiredText: string;
  preferredTemplateNote: string;
  referenceNotes: string;
  notes: string;
}

export const EMPTY_DESIGN_JOB_FORM_VALUES: DesignJobFormValues = {
  title: '',
  category: 'GENERAL_GRAPHIC_DESIGN',
  priority: 'NORMAL',
  initialStatus: 'DRAFT',
  memberId: '',
  birthdayTargetYear: '',
  dueDate: '',
  targetPlatform: '',
  dimensions: '',
  requiredText: '',
  preferredTemplateNote: '',
  referenceNotes: '',
  notes: '',
};

export function designJobDetailToFormValues(
  job: DesignJobDetail
): DesignJobFormValues {
  return {
    title: job.title,
    category: job.category,
    priority: job.priority,
    initialStatus: job.status === 'PENDING' ? 'PENDING' : 'DRAFT',
    memberId: job.memberId ?? '',
    birthdayTargetYear:
      job.birthdayTargetYear !== null ? String(job.birthdayTargetYear) : '',
    dueDate: job.dueDate ?? '',
    targetPlatform: job.targetPlatform ?? '',
    dimensions: job.dimensions ?? '',
    requiredText: job.requiredText ?? '',
    preferredTemplateNote: job.preferredTemplateNote ?? '',
    referenceNotes: job.referenceNotes ?? '',
    notes: job.notes ?? '',
  };
}

export function buildCreateDesignJobPayload(
  values: DesignJobFormValues
):
  | { success: true; data: CreateDesignJobInput }
  | { success: false; fieldErrors: Record<string, string>; formError: string } {
  const targetYearRaw = values.birthdayTargetYear.trim();
  let birthdayTargetYear: number | null = null;
  if (targetYearRaw.length > 0) {
    if (!/^\d{4}$/.test(targetYearRaw)) {
      return {
        success: false,
        fieldErrors: { birthdayTargetYear: 'Enter a 4-digit target year.' },
        formError: 'Please fix the highlighted fields.',
      };
    }
    birthdayTargetYear = Number.parseInt(targetYearRaw, 10);
  }

  const parsed = createDesignJobSchema.safeParse({
    title: values.title,
    category: values.category,
    priority: values.priority,
    initialStatus: values.initialStatus,
    memberId: values.memberId || null,
    birthdayTargetYear,
    dueDate: values.dueDate || null,
    targetPlatform: values.targetPlatform || null,
    dimensions: values.dimensions || null,
    requiredText: values.requiredText || null,
    preferredTemplateNote: values.preferredTemplateNote || null,
    referenceNotes: values.referenceNotes || null,
    notes: values.notes || null,
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'title');
      if (!fieldErrors[key]) {
        fieldErrors[key] = issue.message;
      }
    }
    return {
      success: false,
      fieldErrors,
      formError: parsed.error.issues[0]?.message ?? 'Please review the form.',
    };
  }

  return { success: true, data: parsed.data };
}

export function buildUpdateDesignJobPayload(
  initial: DesignJobDetail,
  values: DesignJobFormValues
):
  | { success: true; hasChanges: true; data: UpdateDesignJobInput }
  | { success: true; hasChanges: false; data: null }
  | { success: false; fieldErrors: Record<string, string>; formError: string } {
  const normalize = (s: string): string | null => {
    const trimmed = s.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const patch: Record<string, unknown> = {};
  const nextTitle = values.title.trim();
  if (nextTitle !== initial.title) patch.title = nextTitle;
  if (values.category !== initial.category) patch.category = values.category;
  if (values.priority !== initial.priority) patch.priority = values.priority;

  const nextMemberId = values.memberId || null;
  if (nextMemberId !== initial.memberId) patch.memberId = nextMemberId;

  const nextDueDate = normalize(values.dueDate);
  if (nextDueDate !== initial.dueDate) patch.dueDate = nextDueDate;

  const nextTargetPlatform = normalize(values.targetPlatform);
  if (nextTargetPlatform !== initial.targetPlatform) {
    patch.targetPlatform = nextTargetPlatform;
  }

  const nextDimensions = normalize(values.dimensions);
  if (nextDimensions !== initial.dimensions) {
    patch.dimensions = nextDimensions;
  }

  const nextRequiredText = normalize(values.requiredText);
  if (nextRequiredText !== initial.requiredText) {
    patch.requiredText = nextRequiredText;
  }

  const nextTemplateNote = normalize(values.preferredTemplateNote);
  if (nextTemplateNote !== initial.preferredTemplateNote) {
    patch.preferredTemplateNote = nextTemplateNote;
  }

  const nextReferenceNotes = normalize(values.referenceNotes);
  if (nextReferenceNotes !== initial.referenceNotes) {
    patch.referenceNotes = nextReferenceNotes;
  }

  const nextNotes = normalize(values.notes);
  if (nextNotes !== initial.notes) patch.notes = nextNotes;

  if (Object.keys(patch).length === 0) {
    return { success: true, hasChanges: false, data: null };
  }

  const parsed = updateDesignJobSchema.safeParse(patch);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'title');
      if (!fieldErrors[key]) {
        fieldErrors[key] = issue.message;
      }
    }
    return {
      success: false,
      fieldErrors,
      formError: parsed.error.issues[0]?.message ?? 'Please review the form.',
    };
  }

  return { success: true, hasChanges: true, data: parsed.data };
}
