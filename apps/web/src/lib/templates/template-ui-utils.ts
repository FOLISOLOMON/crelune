import {
  CREATIVE_BYTE_LIMITS,
  isValidTemplateFieldKey,
  TEMPLATE_FILE_FORMATS,
  TEMPLATE_FORMAT_EXTENSIONS,
  type CanonicalTemplateFieldKey,
  type TemplateFieldMappingInput,
  type TemplateFieldType,
  type TemplateFileFormat,
  type TemplateInspectionStatus,
} from '@crelune/shared';

export const TEMPLATE_CATEGORY_LABELS: Record<string, string> = {
  ALL: 'All Categories',
  BIRTHDAY_FLYER: 'Birthday Flyer',
  EVENT_ANNOUNCEMENT: 'Event Announcement',
  SUNDAY_SERVICE: 'Sunday Service',
  SERMON_SERIES: 'Sermon Series',
  MINISTRY_PROMO: 'Ministry Promo',
  TESTIMONY_FEATURE: 'Testimony Feature',
  SOCIAL_MEDIA_QUOTE: 'Social Media Quote',
  GENERAL_GRAPHIC_DESIGN: 'General Graphic Design',
};

export const TEMPLATE_STUDIO_LABELS: Record<string, string> = {
  ALL: 'All Studios',
  AFFINITY_PHOTO: 'Affinity Photo',
  AFFINITY_DESIGNER: 'Affinity Designer',
  AFFINITY_PUBLISHER: 'Affinity Publisher',
  AFFINITY_STUDIO: 'Affinity Studio (Universal)',
};

export const TEMPLATE_FORMAT_LABELS: Record<TemplateFileFormat, string> = {
  PSD: 'Photoshop Document (.psd)',
  AF: 'Affinity Universal (.af)',
  AFPHOTO: 'Affinity Photo (.afphoto)',
  AFDESIGN: 'Affinity Designer (.afdesign)',
  AFPUB: 'Affinity Publisher (.afpub)',
};

export function getTemplateInspectionBadgeVariant(
  status: TemplateInspectionStatus
): 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info' {
  switch (status) {
    case 'INSPECTED':
      return 'success';
    case 'MANUAL_REQUIRED':
      return 'warning';
    case 'FAILED':
      return 'error';
    case 'PENDING':
    default:
      return 'default';
  }
}

export function formatByteSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDateTimeDisplay(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

export async function computeBufferSha256Hex(
  buffer: ArrayBuffer | Uint8Array
): Promise<string> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const subtle =
    typeof globalThis !== 'undefined' && globalThis.crypto?.subtle
      ? globalThis.crypto.subtle
      : null;

  if (subtle) {
    const digest = await subtle.digest('SHA-256', bytes as unknown as BufferSource);
    const hashArray = Array.from(new Uint8Array(digest));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  throw new Error('Web Cryptography API (crypto.subtle) is not available in this environment.');
}

export interface ClientFileValidationResult {
  valid: boolean;
  error?: string;
  format?: TemplateFileFormat;
  mimeType?: string;
  byteSize?: number;
}

export function validateTemplateMasterFile(
  file: File
): ClientFileValidationResult {
  if (!file) {
    return { valid: false, error: 'Please choose a template file to upload.' };
  }

  const name = file.name;
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === name.length - 1) {
    return {
      valid: false,
      error: 'The selected file does not have a valid extension.',
    };
  }

  const ext = name.slice(dotIndex + 1).toLowerCase();
  let matchedFormat: TemplateFileFormat | undefined;
  for (const fmt of TEMPLATE_FILE_FORMATS) {
    if ((TEMPLATE_FORMAT_EXTENSIONS[fmt] as readonly string[]).includes(ext)) {
      matchedFormat = fmt;
      break;
    }
  }

  if (!matchedFormat) {
    return {
      valid: false,
      error: `Unsupported file format ".${ext}". Supported formats are .psd, .af, .afphoto, .afdesign, and .afpub.`,
    };
  }

  if (file.size <= 0) {
    return { valid: false, error: 'The selected file is empty (0 bytes).' };
  }

  if (file.size > CREATIVE_BYTE_LIMITS.TEMPLATE_MASTER_MAX_BYTES) {
    return {
      valid: false,
      error: `Template file exceeds the maximum allowed size of ${formatByteSize(
        CREATIVE_BYTE_LIMITS.TEMPLATE_MASTER_MAX_BYTES
      )}.`,
    };
  }

  const mime =
    matchedFormat === 'PSD'
      ? 'image/vnd.adobe.photoshop'
      : 'application/octet-stream';

  return {
    valid: true,
    format: matchedFormat,
    mimeType: mime,
    byteSize: file.size,
  };
}

export function validateTemplatePreviewFile(
  file: File
): ClientFileValidationResult {
  if (!file) {
    return { valid: false, error: 'Please choose a preview image file.' };
  }

  const name = file.name;
  const dotIndex = name.lastIndexOf('.');
  const ext =
    dotIndex > 0 && dotIndex < name.length - 1
      ? name.slice(dotIndex + 1).toLowerCase()
      : '';

  const validExts: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
  };

  const detectedMime = validExts[ext] || file.type;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(detectedMime)) {
    return {
      valid: false,
      error: 'Preview file must be a PNG, JPEG, or WebP image.',
    };
  }

  if (file.size <= 0) {
    return { valid: false, error: 'Preview file is empty (0 bytes).' };
  }

  if (file.size > CREATIVE_BYTE_LIMITS.TEMPLATE_PREVIEW_MAX_BYTES) {
    return {
      valid: false,
      error: `Preview image exceeds the maximum allowed size of ${formatByteSize(
        CREATIVE_BYTE_LIMITS.TEMPLATE_PREVIEW_MAX_BYTES
      )}.`,
    };
  }

  return {
    valid: true,
    mimeType: detectedMime,
    byteSize: file.size,
  };
}

export interface EditableMappingRow {
  id: string; // client temporary or db id
  fieldKey: string;
  fieldType: TemplateFieldType;
  targetLayerName: string;
  layerPath: string; // comma-delimited or empty for UI editing
  isRequired: boolean;
  defaultValue: string;
  notes: string;
}

export const CANONICAL_FIELD_OPTIONS: Array<{
  value: CanonicalTemplateFieldKey;
  label: string;
  recommendedType: TemplateFieldType;
}> = [
  {
    value: 'member.firstName',
    label: 'Member First Name (member.firstName)',
    recommendedType: 'TEXT',
  },
  {
    value: 'member.lastName',
    label: 'Member Last Name (member.lastName)',
    recommendedType: 'TEXT',
  },
  {
    value: 'member.fullName',
    label: 'Member Full Name (member.fullName)',
    recommendedType: 'TEXT',
  },
  {
    value: 'member.birthdayDisplay',
    label: 'Celebration Date (member.birthdayDisplay)',
    recommendedType: 'DATE',
  },
  {
    value: 'member.photo',
    label: 'Member Portrait Photo (member.photo)',
    recommendedType: 'IMAGE',
  },
  {
    value: 'design.title',
    label: 'Design Job Title (design.title)',
    recommendedType: 'TEXT',
  },
  {
    value: 'design.requiredText',
    label: 'Required Text Brief (design.requiredText)',
    recommendedType: 'TEXT',
  },
  {
    value: 'design.notes',
    label: 'Design Notes (design.notes)',
    recommendedType: 'TEXT',
  },
  {
    value: 'event.title',
    label: 'Event Title (event.title)',
    recommendedType: 'TEXT',
  },
  {
    value: 'event.dateDisplay',
    label: 'Event Date Display (event.dateDisplay)',
    recommendedType: 'DATE',
  },
];

export function validateMappingRows(
  rows: EditableMappingRow[]
): { valid: true; payload: TemplateFieldMappingInput[] } | { valid: false; error: string; rowErrors: Record<string, string> } {
  const seenKeys = new Set<string>();
  const rowErrors: Record<string, string> = {};
  const payload: TemplateFieldMappingInput[] = [];

  for (const row of rows) {
    const key = row.fieldKey.trim();
    if (!key) {
      rowErrors[row.id] = 'Field key is required.';
      continue;
    }
    if (!isValidTemplateFieldKey(key)) {
      rowErrors[row.id] =
        'Field key must be a canonical key or follow custom.<lowercase_slug>.';
      continue;
    }
    if (seenKeys.has(key)) {
      rowErrors[row.id] = `Duplicate field key "${key}". Each field key must be unique.`;
      continue;
    }
    seenKeys.add(key);

    const layerName = row.targetLayerName.trim();
    if (!layerName) {
      rowErrors[row.id] = 'Target layer name is required.';
      continue;
    }

    let parsedPath: string[] | null = null;
    if (row.layerPath.trim()) {
      const parts = row.layerPath
        .split('/')
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length > 0) {
        if (parts.length > 16) {
          rowErrors[row.id] = 'Layer path exceeds 16 nesting levels.';
          continue;
        }
        parsedPath = parts;
      }
    }

    payload.push({
      fieldKey: key,
      fieldType: row.fieldType,
      targetLayerName: layerName,
      layerPath: parsedPath,
      isRequired: Boolean(row.isRequired),
      defaultValue: row.defaultValue.trim() || null,
      notes: row.notes.trim() || null,
    });
  }

  if (Object.keys(rowErrors).length > 0) {
    return {
      valid: false,
      error: 'Please resolve the highlighted field mapping errors.',
      rowErrors,
    };
  }

  return { valid: true, payload };
}
