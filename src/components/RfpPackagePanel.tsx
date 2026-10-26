import React from 'react';
import { AlertTriangle, Check, FileText, Loader2, MapPin, Paperclip, Plus, X } from 'lucide-react';
import type { PackageFileRole, RfpAnalysis, RfpConflictField, RfpPackageFile } from '../types';
import { PACKAGE_ROLE_LABELS, missingAttachments } from '../research/rfpPackage';

const ROLE_ORDER: PackageFileRole[] = ['rfp', 'reference', 'geo_list', 'media_plan'];

/** A file's progress through the parse. "waiting" is before the server has said anything about it. */
export type PackageFileStatus = 'waiting' | 'reading' | 'done' | 'cached' | 'failed';

function FileStatus({ status }: { status?: PackageFileStatus }) {
  if (!status) return null;
  if (status === 'waiting' || status === 'reading') {
    return (
      <span className="shrink-0 flex items-center gap-1 text-[10px] font-semibold text-indigo-600">
        <Loader2 className="w-3 h-3 animate-spin" />
        {status === 'waiting' ? 'Waiting' : 'Reading'}
      </span>
    );
  }
  if (status === 'failed') return <span className="shrink-0 text-[10px] font-semibold text-rose-600">Not read</span>;
  return (
    <span className="shrink-0 flex items-center gap-1 text-[10px] font-semibold text-emerald-600" title={status === 'cached' ? 'Read earlier; the saved reading was reused' : undefined}>
      <Check className="w-3 h-3" />
      Read
    </span>
  );
}

interface RfpPackageFileListProps {
  files: RfpPackageFile[];
  statuses?: Record<string, PackageFileStatus>;
  disabled: boolean;
  canAdd: boolean;
  onRoleChange: (index: number, role: PackageFileRole) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
}

/** The uploaded package's files, each with the role it is read as. Changing a role re-reads the package. */
export const RfpPackageFileList: React.FC<RfpPackageFileListProps> = ({ files, statuses = {}, disabled, canAdd, onRoleChange, onRemove, onAdd }) => (
  <div className="mt-2.5 rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
    {files.map((file, index) => (
      <div key={`${file.name}-${index}`} className="flex items-center gap-2 px-2.5 py-2">
        <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700" title={file.name}>{file.name}</span>
        <FileStatus status={statuses[file.name]} />
        <select
          value={file.role}
          disabled={disabled}
          onChange={(e) => onRoleChange(index, e.target.value as PackageFileRole)}
          aria-label={`What ${file.name} is`}
          className="shrink-0 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 disabled:opacity-50"
        >
          {ROLE_ORDER.map((role) => (
            <option key={role} value={role}>{PACKAGE_ROLE_LABELS[role]}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => onRemove(index)}
          disabled={disabled}
          aria-label={`Remove ${file.name}`}
          className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    ))}
    {canAdd && (
      <button
        type="button"
        onClick={onAdd}
        disabled={disabled}
        className="flex w-full items-center gap-1.5 px-2.5 py-2 text-[11px] font-bold text-indigo-600 hover:bg-indigo-50/60 disabled:opacity-50 cursor-pointer rounded-b-xl"
      >
        <Plus className="w-3.5 h-3.5" />
        Add attachment
      </button>
    )}
  </div>
);

const CONFLICT_LABELS: Record<RfpConflictField, string> = {
  advertiserName: 'advertiser',
  websiteUrl: 'website',
  budget: 'budget',
  flightDates: 'flight dates',
  submissionDueDate: 'due date',
};

function conflictValue(field: RfpConflictField, value: string): string {
  const amount = Number(value.replace(/[^\d.]/g, ''));
  return field === 'budget' && amount > 0 ? `$${Math.round(amount).toLocaleString()}` : value;
}

export interface PackageGeoSuggestion {
  fileName: string;
  type: 'State' | 'DMA';
  targets: string[];
}

interface RfpPackageNoticesProps {
  analysis: RfpAnalysis | null;
  geoSuggestions: PackageGeoSuggestion[];
  appliedGeoFile: string | null;
  canAdd: boolean;
  onAdd: () => void;
  onPickConflict: (field: RfpConflictField, value: string) => void;
  onApplyGeo: (suggestion: PackageGeoSuggestion) => void;
}

/**
 * What reading the package together turned up that the planner should act on before generating:
 * attachments the RFP points to that were not uploaded, files that disagree, and location lists
 * that could set the brief's geography.
 */
export const RfpPackageNotices: React.FC<RfpPackageNoticesProps> = ({ analysis, geoSuggestions, appliedGeoFile, canAdd, onAdd, onPickConflict, onApplyGeo }) => {
  const missing = missingAttachments(analysis);
  const conflicts = analysis?.conflicts ?? [];
  if (missing.length === 0 && conflicts.length === 0 && geoSuggestions.length === 0) return null;

  return (
    <div className="mt-2.5 space-y-2">
      {missing.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
          <p className="flex items-start gap-1.5 text-xs font-bold">
            <Paperclip className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            The RFP refers to {missing.length === 1 ? 'a file that was' : `${missing.length} files that were`} not uploaded
          </p>
          <ul className="mt-1 ml-5 list-disc text-[11px] text-amber-800">
            {missing.map((attachment) => <li key={attachment.name}>{attachment.name}</li>)}
          </ul>
          <p className="mt-1 text-[11px] text-amber-700">Without {missing.length === 1 ? 'it' : 'them'}, anything the RFP leaves to {missing.length === 1 ? 'that file' : 'those files'} is missing from the plan.</p>
          {canAdd && (
            <button type="button" onClick={onAdd} className="mt-2 inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2 py-1 text-[11px] font-bold text-amber-800 hover:bg-amber-100 cursor-pointer">
              <Plus className="w-3 h-3" />
              Add attachment
            </button>
          )}
        </div>
      )}

      {conflicts.map((conflict) => (
        <div key={conflict.field} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
          <p className="flex items-start gap-1.5 text-xs font-bold">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            The files disagree on the {CONFLICT_LABELS[conflict.field]}
          </p>
          <p className="mt-0.5 ml-5 text-[11px] text-amber-700">The RFP's value is used until you pick one.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {conflict.values.map((entry) => (
              <button
                key={`${entry.sourceFile}-${entry.value}`}
                type="button"
                onClick={() => onPickConflict(conflict.field, entry.value)}
                className="rounded-lg border border-amber-300 bg-white px-2 py-1 text-left text-[11px] text-amber-900 hover:bg-amber-100 cursor-pointer"
              >
                <span className="font-bold">Use {conflictValue(conflict.field, entry.value)}</span>
                <span className="block text-[10px] text-amber-700">from {entry.sourceFile}</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {geoSuggestions.map((suggestion) => {
        const kind = suggestion.type === 'State' ? (suggestion.targets.length === 1 ? 'state' : 'states') : (suggestion.targets.length === 1 ? 'DMA' : 'DMAs');
        const applied = appliedGeoFile === suggestion.fileName;
        return (
          <div key={suggestion.fileName} className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3 text-indigo-900">
            <p className="flex items-start gap-1.5 text-xs font-bold">
              <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              {applied ? `Geography set to the ${suggestion.targets.length} ${kind} in ${suggestion.fileName}` : `${suggestion.fileName} lists locations in ${suggestion.targets.length} ${kind}`}
            </p>
            <p className="mt-0.5 ml-5 text-[11px] text-indigo-700">
              {suggestion.targets.slice(0, 8).join(', ')}{suggestion.targets.length > 8 ? `, and ${suggestion.targets.length - 8} more` : ''}
            </p>
            {!applied && (
              <button type="button" onClick={() => onApplyGeo(suggestion)} className="mt-2 rounded-lg border border-indigo-300 bg-white px-2 py-1 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100 cursor-pointer">
                Target these {kind}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};
