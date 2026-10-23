import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, ArrowRight, Check, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import * as api from '../api/client';
import { OUTSIDE_CATALOG, type ChannelStrategyData, type ExtractedPlacement, type ParsedPlanOption, type RfpAnalysis } from '../types';
import { BudgetStrategyControl } from './BudgetStrategyControl';
import { modeNeedsAdditionalBudget, type BudgetStrategyMode } from '../planning/budgetStrategy';
import { parseCurrencyInput } from '../planning/settings';
import {
  allocationChanges, briefChanges, lineMappings, uploadedBrief, withChannelMapping,
  type BriefFields, type UploadedBrief,
} from '../planning/planUpload';
import { groupPlacementsIntoPlanOptions } from '../utils/planPromptOptimizer';

/**
 * Uploading a media plan onto a plan that already exists. The planner picks how to use it (as is,
 * or as the baseline ScoutAI adds to), checks how its lines map to media types and what it changes
 * in the brief, and sees the plan before and after. Nothing is saved until they approve; the
 * re-plan behind the preview reuses the plan's existing research, so it takes seconds.
 */

export interface PlanUploadPreviewInput {
  selectedOptions: ParsedPlanOption[];
  mode: BudgetStrategyMode;
  additionalBudget: number;
  brief: UploadedBrief;
}

export interface AppliedPlanUpload extends PlanUploadPreviewInput {
  fileName: string;
  placements: ExtractedPlacement[];
  planOptions: ParsedPlanOption[];
  rfpAnalysis: RfpAnalysis | null;
  strategy: ChannelStrategyData;
}

interface PlanUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentStrategy: ChannelStrategyData | null | undefined;
  brief: BriefFields;
  /** Catalog media types a line can be mapped to. */
  mediaTypes: Array<{ id: string; displayName: string }>;
  /** Who the research and personas were built for, beside the upload's own audiences. */
  researchAudience?: string;
  capFor?: (budget: number) => number;
  onPreview: (input: PlanUploadPreviewInput) => Promise<ChannelStrategyData>;
  onApply: (upload: AppliedPlanUpload) => Promise<void>;
}

const money = (value: number) => `$${Math.round(value).toLocaleString()}`;
const ADDITION_MODES: BudgetStrategyMode[] = ['reallocation', 'incremental', 'grow'];

export const PlanUploadModal: React.FC<PlanUploadModalProps> = ({
  isOpen, onClose, currentStrategy, brief, mediaTypes, researchAudience, capFor, onPreview, onApply,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<{ placements: ExtractedPlacement[]; rfpAnalysis: RfpAnalysis | null } | null>(null);
  const [options, setOptions] = useState<ParsedPlanOption[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<BudgetStrategyMode>('asIs');
  const [additionalInput, setAdditionalInput] = useState('');
  const [preview, setPreview] = useState<ChannelStrategyData | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewToken = useRef(0);

  useEffect(() => {
    if (!isOpen) return;
    setFileName('');
    setParsing(false);
    setParsed(null);
    setOptions([]);
    setMapping({});
    setMode('asIs');
    setAdditionalInput('');
    setPreview(null);
    setError(null);
    setApplying(false);
  }, [isOpen]);

  // The chosen options with the planner's mapping applied: what the preview plans and what is saved.
  const selectedOptions = useMemo(
    () => options.filter((option) => option.selected).map((option) => ({ ...option, placements: withChannelMapping(option.placements, mapping) })),
    [options, mapping],
  );
  const additionalBudget = parseCurrencyInput(additionalInput);
  const nextBrief = useMemo(() => uploadedBrief(selectedOptions, parsed?.rfpAnalysis?.extractedMetadata), [selectedOptions, parsed]);
  const needsAdditional = modeNeedsAdditionalBudget(mode);
  const ready = selectedOptions.length > 0 && (!needsAdditional || additionalBudget > 0);

  // Re-plans whenever a choice changes. Only the latest request's answer is shown.
  useEffect(() => {
    if (!isOpen || !parsed || !ready) {
      setPreview(null);
      return;
    }
    const token = ++previewToken.current;
    setPreviewing(true);
    setError(null);
    const timer = setTimeout(() => {
      onPreview({ selectedOptions, mode, additionalBudget: needsAdditional ? additionalBudget : 0, brief: nextBrief })
        .then((strategy) => { if (token === previewToken.current) setPreview(strategy); })
        .catch((err) => { if (token === previewToken.current) { setPreview(null); setError(err?.message || 'The plan could not be previewed.'); } })
        .finally(() => { if (token === previewToken.current) setPreviewing(false); });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, parsed, selectedOptions, mode, additionalBudget, ready]);

  if (!isOpen) return null;

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setParsing(true);
    setError(null);
    setParsed(null);
    setMapping({});
    try {
      const result = await api.parseMediaPlan(file);
      setParsed(result);
      setOptions(groupPlacementsIntoPlanOptions(result.placements));
    } catch (err: any) {
      setError(err?.message || 'The media plan could not be read.');
    } finally {
      setParsing(false);
    }
  };

  const handleApply = async () => {
    if (!preview || !parsed || applying) return;
    setApplying(true);
    setError(null);
    try {
      // Every line carries the planner's mapping, including options left unselected, so switching
      // options later in the brief keeps it.
      const planOptions = options.map((option) => ({ ...option, placements: withChannelMapping(option.placements, mapping) }));
      await onApply({
        fileName,
        placements: withChannelMapping(parsed.placements, mapping),
        planOptions,
        rfpAnalysis: parsed.rfpAnalysis,
        strategy: preview,
        selectedOptions,
        mode,
        additionalBudget: needsAdditional ? additionalBudget : 0,
        brief: nextBrief,
      });
      onClose();
    } catch (err: any) {
      setError(
        err instanceof api.ApiError && err.isConflict
          ? 'Someone else changed this plan just now. Close this, reload the plan, and try again.'
          : err?.message || 'The plan could not be updated.',
      );
      setApplying(false);
    }
  };

  const changes = briefChanges(brief, nextBrief);
  const lines = preview ? lineMappings(preview) : [];
  const comparison = preview ? allocationChanges(currentStrategy, preview) : null;
  const mediaTypeChoices = (current: string | null) => {
    const known = mediaTypes.some((type) => type.id === current);
    const extra = current && !known ? [{ id: current, displayName: lines.find((line) => line.channelId === current)?.channelName || current }] : [];
    return [...mediaTypes, ...extra];
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 font-sans backdrop-blur-xs" onClick={() => !applying && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-upload-title"
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white text-left shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-indigo-100 bg-indigo-50 text-indigo-600"><Upload className="h-4 w-4" /></div>
            <div>
              <h3 id="plan-upload-title" className="text-sm font-bold text-slate-800">Upload a media plan</h3>
              <p className="text-[11px] text-slate-500">Replaces any media plan uploaded before. Nothing changes until you approve.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={applying} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="Close"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-5 overflow-y-auto p-6">
          <div className="flex flex-wrap items-center gap-3">
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv,.pdf" className="hidden" onChange={(event) => { void handleFile(event.target.files?.[0]); event.target.value = ''; }} />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={parsing || applying}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
            >
              {parsing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
              {fileName ? 'Choose another file' : 'Choose a file'}
            </button>
            {fileName && <span className="truncate text-xs font-semibold text-slate-700">{fileName}</span>}
            {parsing && <span className="text-xs text-slate-500">Reading the plan. Large files can take a minute or two.</span>}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-100 bg-rose-50 p-3 text-xs text-rose-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" /><span>{error}</span>
            </div>
          )}

          {parsed && (
            <>
              {options.length > 1 && (
                <section>
                  <h4 className="mb-2 text-[11px] font-extrabold uppercase tracking-wide text-slate-700">Plan options in this file</h4>
                  <div className="space-y-1.5">
                    {options.map((option) => (
                      <label key={option.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs hover:bg-slate-50">
                        <input type="checkbox" checked={option.selected} onChange={() => setOptions((prev) => prev.map((item) => item.id === option.id ? { ...item, selected: !item.selected } : item))} />
                        <span className="font-bold text-slate-900">{option.name}</span>
                        <span className="text-slate-500">{money(option.budget)} · {option.lineItemsCount} line{option.lineItemsCount === 1 ? '' : 's'}</span>
                      </label>
                    ))}
                  </div>
                </section>
              )}

              <section>
                <h4 className="mb-2 text-[11px] font-extrabold uppercase tracking-wide text-slate-700">How should this plan be used?</h4>
                <div role="radiogroup" aria-label="How to use the uploaded plan" className="grid gap-2 sm:grid-cols-2">
                  {[
                    { id: 'asIs', title: 'Use this plan as is', body: 'Its media types and dollars become the plan exactly. The rest of the plan is written to support it.' },
                    { id: 'additions', title: 'Recommend additions to it', body: 'Treat it as the baseline and let ScoutAI recommend changes and additions, as when uploading before generating.' },
                  ].map((choice) => {
                    const selected = choice.id === 'asIs' ? mode === 'asIs' : mode !== 'asIs';
                    return (
                      <button
                        key={choice.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={applying}
                        onClick={() => setMode(choice.id === 'asIs' ? 'asIs' : mode === 'asIs' ? 'reallocation' : mode)}
                        className={`rounded-xl border p-3 text-left ${selected ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                      >
                        <div className={`text-xs font-extrabold ${selected ? 'text-indigo-900' : 'text-slate-900'}`}>{choice.title}</div>
                        <div className="mt-1 text-[11px] leading-4 text-slate-600">{choice.body}</div>
                      </button>
                    );
                  })}
                </div>
                {mode !== 'asIs' && (
                  <div className="mt-3">
                    <BudgetStrategyControl
                      mode={mode}
                      modes={ADDITION_MODES}
                      additionalBudgetInput={additionalInput}
                      onModeChange={setMode}
                      onAdditionalBudgetChange={setAdditionalInput}
                      rfpBudget={nextBrief.budget || 0}
                      capFor={capFor}
                      disabled={applying}
                      idPrefix="plan-upload"
                    />
                  </div>
                )}
              </section>

              {(changes.length > 0 || nextBrief.unreadLocations.length > 0) && (
                <section>
                  <h4 className="mb-2 text-[11px] font-extrabold uppercase tracking-wide text-slate-700">Brief changes from this plan</h4>
                  {changes.length > 0 && (
                    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-xs">
                      {changes.map((change) => (
                        <li key={change.field} className="flex flex-wrap items-center gap-2 px-3 py-2">
                          <span className="w-20 font-bold text-slate-700">{change.label}</span>
                          <span className="text-slate-500 line-through">{change.from}</span>
                          <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                          <span className="font-bold text-slate-900">{change.to}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {nextBrief.unreadLocations.length > 0 && (
                    <p className="mt-2 text-[11px] text-amber-800">
                      {nextBrief.geography ? 'Some locations in the plan were not recognised and are left out' : 'The plan\'s locations were not recognised, so the brief\'s stay'}: {nextBrief.unreadLocations.slice(0, 8).join('; ')}{nextBrief.unreadLocations.length > 8 ? '…' : ''}. Check them in the brief.
                    </p>
                  )}
                </section>
              )}

              {nextBrief.audiences.length > 0 && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <div>
                    <div className="font-bold">Check the audience</div>
                    <div className="mt-0.5">
                      This plan targets: {nextBrief.audiences.slice(0, 6).join('; ')}{nextBrief.audiences.length > 6 ? '…' : ''}.
                      {researchAudience ? <> The research and personas were built for: {researchAudience.trim().replace(/\.+$/, '')}.</> : null} They are not re-run.
                    </div>
                  </div>
                </div>
              )}

              {lines.length > 0 && (
                <section>
                  <h4 className="mb-1 text-[11px] font-extrabold uppercase tracking-wide text-slate-700">Media types</h4>
                  <p className="mb-2 text-[11px] text-slate-500">How each line in the plan was read. Change any that are wrong.</p>
                  <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {lines.map((line) => {
                      const value = mapping[line.label] || line.channelId || OUTSIDE_CATALOG;
                      return (
                        <div key={line.label} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-slate-900">{line.label}</div>
                            <div className="text-slate-500">{money(line.dollars)}</div>
                          </div>
                          <select
                            aria-label={`Media type for ${line.label}`}
                            value={value}
                            disabled={applying}
                            onChange={(event) => setMapping((prev) => ({ ...prev, [line.label]: event.target.value }))}
                            className="max-w-[16rem] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-800"
                          >
                            {mediaTypeChoices(line.channelId).map((type) => <option key={type.id} value={type.id}>{type.displayName}</option>)}
                            <option value={OUTSIDE_CATALOG}>Outside ScoutAI catalog</option>
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              <section>
                <h4 className="mb-2 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-wide text-slate-700">
                  Channel Allocation, before and after {previewing && <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-500" />}
                </h4>
                {!ready && needsAdditional && <p className="text-xs font-semibold text-amber-700">Enter the additional budget to preview.</p>}
                {!ready && selectedOptions.length === 0 && <p className="text-xs font-semibold text-amber-700">Select at least one plan option.</p>}
                {comparison && (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
                        <th className="py-1.5">Media type</th>
                        <th className="py-1.5 text-right">Now</th>
                        <th className="py-1.5 text-right">After</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {comparison.rows.map((row) => (
                        <tr key={row.name}>
                          <td className="py-1.5 font-semibold text-slate-900">{row.name}</td>
                          <td className="py-1.5 text-right tabular-nums text-slate-500">{row.before === null ? '–' : money(row.before)}</td>
                          <td className={`py-1.5 text-right font-bold tabular-nums ${row.after === null ? 'text-rose-700' : 'text-slate-900'}`}>{row.after === null ? 'Removed' : money(row.after)}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-slate-200">
                        <td className="py-1.5 font-extrabold text-slate-900">Total</td>
                        <td className="py-1.5 text-right font-bold tabular-nums text-slate-600">{money(comparison.beforeTotal)}</td>
                        <td className="py-1.5 text-right font-extrabold tabular-nums text-slate-900">{money(comparison.afterTotal)}</td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </section>
            </>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-100 bg-slate-50/50 px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] text-slate-500">The plan as it is now is saved in History first. Its written content is then rewritten for the new channels, and a QA audit opens.</p>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={onClose} disabled={applying} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
            <button
              type="button"
              onClick={handleApply}
              disabled={!preview || previewing || applying}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Approve and update plan
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
