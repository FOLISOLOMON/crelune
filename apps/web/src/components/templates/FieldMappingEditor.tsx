'use client';

import React, { useState } from 'react';
import {
  AlertCircle,
  Check,
  Info,
  Layers,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import { Badge, Button } from '@crelune/ui';
import {
  TEMPLATE_FIELD_TYPES,
  type TemplateFieldMappingSummary,
  type TemplateFieldType,
} from '@crelune/shared';
import {
  TemplateApiError,
  upsertTemplateFieldMappingsRequest,
} from '@/lib/templates/template-api-client';
import {
  CANONICAL_FIELD_OPTIONS,
  type EditableMappingRow,
  validateMappingRows,
} from '@/lib/templates/template-ui-utils';

export interface FieldMappingEditorProps {
  templateId: string;
  versionId: string;
  versionNumber: number;
  format: string;
  initialMappings: TemplateFieldMappingSummary[];
  onMappingsSaved?: (mappings: TemplateFieldMappingSummary[]) => void;
  isArchived?: boolean;
}

export function FieldMappingEditor({
  templateId,
  versionId,
  versionNumber,
  format,
  initialMappings,
  onMappingsSaved,
  isArchived = false,
}: FieldMappingEditorProps) {
  const [rows, setRows] = useState<EditableMappingRow[]>(() =>
    initialMappings.map((m) => ({
      id: m.id,
      fieldKey: m.fieldKey,
      fieldType: m.fieldType,
      targetLayerName: m.targetLayerName,
      layerPath: m.layerPath ? m.layerPath.join('/') : '',
      isRequired: m.isRequired,
      defaultValue: m.defaultValue || '',
      notes: m.notes || '',
    }))
  );

  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleAddRow = () => {
    setSuccessMessage(null);
    setFormError(null);
    const newId = `new_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setRows((prev) => [
      ...prev,
      {
        id: newId,
        fieldKey: '',
        fieldType: 'TEXT',
        targetLayerName: '',
        layerPath: '',
        isRequired: false,
        defaultValue: '',
        notes: '',
      },
    ]);
  };

  const handleRemoveRow = (id: string) => {
    setSuccessMessage(null);
    setFormError(null);
    setRows((prev) => prev.filter((r) => r.id !== id));
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleUpdateRow = (
    id: string,
    field: keyof EditableMappingRow,
    value: unknown
  ) => {
    setSuccessMessage(null);
    setFormError(null);
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, [field]: value };
        // If selecting a canonical key, auto-set recommended field type if fieldType was default
        if (field === 'fieldKey') {
          const canon = CANONICAL_FIELD_OPTIONS.find((c) => c.value === value);
          if (canon) {
            next.fieldType = canon.recommendedType;
          }
        }
        return next;
      })
    );
    if (rowErrors[id]) {
      setRowErrors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const handleSave = async () => {
    setSuccessMessage(null);
    setFormError(null);

    const validation = validateMappingRows(rows);
    if (!validation.valid) {
      setFormError(validation.error);
      setRowErrors(validation.rowErrors);
      return;
    }

    setIsSaving(true);
    try {
      const saved = await upsertTemplateFieldMappingsRequest(
        templateId,
        versionId,
        {
          templateVersionId: versionId,
          mappings: validation.payload,
        }
      );
      setSuccessMessage('Field mappings saved successfully.');
      onMappingsSaved?.(saved);
    } catch (err) {
      if (err instanceof TemplateApiError) {
        setFormError(err.message);
        if (err.fieldErrors) {
          // Map to general error since path may be mappings.0.fieldKey
          setFormError(Object.values(err.fieldErrors).join(', ') || err.message);
        }
      } else {
        setFormError(
          err instanceof Error
            ? err.message
            : 'Unable to save field mappings right now.'
        );
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border border-[#E8E5ED] bg-white p-5 shadow-xs">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-[#E8E5ED] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-[#24212B]">
              Field Mappings for Version {versionNumber}
            </h3>
            <Badge variant="primary" size="sm">
              {rows.length} {rows.length === 1 ? 'binding' : 'bindings'}
            </Badge>
          </div>
          <p className="text-xs text-[#77727F] mt-0.5">
            Bind job data fields to exact layer names in this {format} master document.
          </p>
        </div>

        {!isArchived && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddRow}
              disabled={isSaving}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Field
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={isSaving}
            >
              <Save className="h-3.5 w-3.5 mr-1" />
              {isSaving ? 'Saving...' : 'Save Mappings'}
            </Button>
          </div>
        )}
      </div>

      {/* Honest Inspection Limitation Notice */}
      <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900">
        <Info className="h-4 w-4 shrink-0 text-amber-700 mt-0.5" />
        <div className="space-y-1">
          <p className="font-medium text-amber-950">
            Manual Layer Name Verification Required
          </p>
          <p className="text-[11px] leading-relaxed">
            Automatic binary layer detection for Photoshop and native Affinity files is disabled in production for security. Inspect your layer names inside Affinity 3.3 and enter them into the <strong>Target Layer Name</strong> column below.
          </p>
        </div>
      </div>

      {formError && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
          <span>{formError}</span>
        </div>
      )}

      {successMessage && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
          <Check className="h-4 w-4 text-emerald-600" />
          <span>{successMessage}</span>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#E8E5ED] bg-[#F8F7FA] p-8 text-center">
          <Layers className="h-7 w-7 text-[#A09BAA] mx-auto mb-2" />
          <p className="text-xs font-semibold text-[#24212B]">
            No field bindings configured for this version
          </p>
          <p className="text-[11px] text-[#77727F] max-w-sm mx-auto mt-1 mb-3">
            Without field mappings, design jobs using this template will require manual text and image placement by the artist.
          </p>
          {!isArchived && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddRow}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add First Field Binding
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="hidden md:grid md:grid-cols-12 gap-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-[#77727F]">
            <span className="col-span-4">CRELUNE Field Key</span>
            <span className="col-span-2">Type</span>
            <span className="col-span-3">Target Layer Name</span>
            <span className="col-span-2">Required?</span>
            <span className="col-span-1 text-right">Action</span>
          </div>

          {rows.map((row) => (
            <div
              key={row.id}
              className={`rounded-xl border p-3 transition-colors ${
                rowErrors[row.id]
                  ? 'border-rose-300 bg-rose-50/40'
                  : 'border-[#E8E5ED] bg-[#F8F7FA]/40 hover:bg-white'
              }`}
            >
              <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-start">
                {/* Field Key */}
                <div className="col-span-4 space-y-1">
                  <label className="md:hidden block text-[11px] font-semibold text-[#77727F]">
                    Field Key
                  </label>
                  <input
                    list={`canonical-keys-${row.id}`}
                    value={row.fieldKey}
                    onChange={(e) => handleUpdateRow(row.id, 'fieldKey', e.target.value)}
                    placeholder="e.g. member.fullName or custom.header"
                    className="w-full h-9 rounded-lg border border-[#E8E5ED] bg-white px-2.5 text-xs text-[#24212B] focus:border-[#6541A5] focus:outline-none"
                    disabled={isArchived || isSaving}
                  />
                  <datalist id={`canonical-keys-${row.id}`}>
                    {CANONICAL_FIELD_OPTIONS.map((canon) => (
                      <option key={canon.value} value={canon.value}>
                        {canon.label}
                      </option>
                    ))}
                  </datalist>
                </div>

                {/* Field Type */}
                <div className="col-span-2 space-y-1">
                  <label className="md:hidden block text-[11px] font-semibold text-[#77727F]">
                    Type
                  </label>
                  <select
                    value={row.fieldType}
                    onChange={(e) =>
                      handleUpdateRow(row.id, 'fieldType', e.target.value as TemplateFieldType)
                    }
                    className="w-full h-9 rounded-lg border border-[#E8E5ED] bg-white px-2 text-xs text-[#24212B] focus:border-[#6541A5] focus:outline-none"
                    disabled={isArchived || isSaving}
                  >
                    {TEMPLATE_FIELD_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Target Layer Name */}
                <div className="col-span-3 space-y-1">
                  <label className="md:hidden block text-[11px] font-semibold text-[#77727F]">
                    Target Layer Name
                  </label>
                  <input
                    type="text"
                    value={row.targetLayerName}
                    onChange={(e) =>
                      handleUpdateRow(row.id, 'targetLayerName', e.target.value)
                    }
                    placeholder="Exact Affinity layer name"
                    className="w-full h-9 rounded-lg border border-[#E8E5ED] bg-white px-2.5 text-xs text-[#24212B] focus:border-[#6541A5] focus:outline-none"
                    disabled={isArchived || isSaving}
                  />
                </div>

                {/* Is Required Checkbox */}
                <div className="col-span-2 flex items-center h-9 gap-2">
                  <input
                    type="checkbox"
                    id={`req-${row.id}`}
                    checked={row.isRequired}
                    onChange={(e) =>
                      handleUpdateRow(row.id, 'isRequired', e.target.checked)
                    }
                    className="h-4 w-4 rounded border-[#E8E5ED] text-[#6541A5] focus:ring-[#6541A5]"
                    disabled={isArchived || isSaving}
                  />
                  <label
                    htmlFor={`req-${row.id}`}
                    className="text-xs text-[#24212B] cursor-pointer"
                  >
                    Required
                  </label>
                </div>

                {/* Action */}
                <div className="col-span-1 flex items-center justify-end h-9">
                  {!isArchived && (
                    <button
                      type="button"
                      onClick={() => handleRemoveRow(row.id)}
                      className="p-1.5 text-[#77727F] hover:text-rose-600 rounded-lg hover:bg-rose-50"
                      title="Remove binding"
                      disabled={isSaving}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Optional Notes or Layer Path expansion */}
              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 pt-2 border-t border-[#E8E5ED]/60 text-[11px]">
                <div>
                  <input
                    type="text"
                    value={row.layerPath}
                    onChange={(e) =>
                      handleUpdateRow(row.id, 'layerPath', e.target.value)
                    }
                    placeholder="Optional Group Path (e.g. Header/TextGroup)"
                    className="w-full h-7 rounded border border-[#E8E5ED] bg-white px-2 text-[11px] text-[#77727F] focus:border-[#6541A5] focus:outline-none"
                    disabled={isArchived || isSaving}
                  />
                </div>
                <div>
                  <input
                    type="text"
                    value={row.defaultValue}
                    onChange={(e) =>
                      handleUpdateRow(row.id, 'defaultValue', e.target.value)
                    }
                    placeholder="Optional default value fallback"
                    className="w-full h-7 rounded border border-[#E8E5ED] bg-white px-2 text-[11px] text-[#77727F] focus:border-[#6541A5] focus:outline-none"
                    disabled={isArchived || isSaving}
                  />
                </div>
              </div>

              {rowErrors[row.id] && (
                <p className="mt-1.5 text-xs text-rose-600 font-medium">
                  {rowErrors[row.id]}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
