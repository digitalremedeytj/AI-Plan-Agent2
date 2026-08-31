import React from 'react';
import { Check, CheckSquare, Square, FileSpreadsheet, Layers, MapPin, Tag, ShieldCheck } from 'lucide-react';
import { ParsedPlanOption, TaxonomyMapping } from '../types';

interface MediaPlanSelectorProps {
  filename: string;
  planOptions: ParsedPlanOption[];
  taxonomyMappings: TaxonomyMapping[];
  onToggleOption: (id: string) => void;
  onToggleAll: (selectAll: boolean) => void;
  onOpenTaxonomyModal: () => void;
}

export const MediaPlanSelector: React.FC<MediaPlanSelectorProps> = ({
  filename,
  planOptions,
  taxonomyMappings,
  onToggleOption,
  onToggleAll,
  onOpenTaxonomyModal,
}) => {
  if (!planOptions || planOptions.length === 0) return null;

  const allSelected = planOptions.every(p => p.selected);
  const selectedCount = planOptions.filter(p => p.selected).length;
  const totalSelectedBudget = planOptions
    .filter(p => p.selected)
    .reduce((sum, p) => sum + p.budget, 0);

  const unverifiedCount = taxonomyMappings.filter(m => !m.isUserVerified).length;

  return (
    <div className="bg-slate-900 rounded-xl p-3.5 text-white shadow-md border border-indigo-500/30 my-3">
      {/* Header */}
      <div className="space-y-2.5 pb-3 border-b border-indigo-500/20">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1.5 bg-indigo-600/30 rounded-lg border border-indigo-400/30 text-indigo-300 shrink-0">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="font-display font-bold text-xs text-white leading-tight">
                Detected Media Strategy Options
              </h3>
              <p className="text-[10px] font-mono text-indigo-300 truncate max-w-[180px]" title={filename}>
                {filename}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenTaxonomyModal}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 text-[10px] font-medium border border-indigo-400/30 transition-colors cursor-pointer shrink-0"
            title="Configure channel taxonomy mappings"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-300" />
            <span>Taxonomy</span>
            {unverifiedCount > 0 && (
              <span className="ml-0.5 bg-amber-500/90 text-white text-[9px] px-1 py-0.2 rounded-full font-bold">
                {unverifiedCount}
              </span>
            )}
          </button>
        </div>

        {/* Spend Summary */}
        <div className="bg-indigo-950/60 border border-indigo-500/20 rounded-lg p-2 flex items-center justify-between text-xs">
          <span className="text-[11px] text-indigo-200 font-medium">Active Analysis Spend</span>
          <span className="font-display font-bold text-sm text-emerald-400">
            ${totalSelectedBudget.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </span>
        </div>
      </div>

      {/* Select All / Deselect All Bar */}
      <div className="my-2.5 flex items-center justify-between text-[11px] text-indigo-200/90 font-medium px-0.5">
        <button
          type="button"
          onClick={() => onToggleAll(!allSelected)}
          className="flex items-center gap-1.5 hover:text-white transition-colors cursor-pointer"
        >
          {allSelected ? (
            <CheckSquare className="w-3.5 h-3.5 text-indigo-400" />
          ) : (
            <Square className="w-3.5 h-3.5 text-slate-400" />
          )}
          <span>
            {allSelected ? 'Deselect All' : 'Select All'} ({selectedCount}/{planOptions.length})
          </span>
        </button>

        <span className="text-[10px] text-indigo-300/70 font-mono">
          {selectedCount === 0 ? '⚠️ None active' : `${selectedCount} selected`}
        </span>
      </div>

      {/* Stacked Vertical List (Full Width Cards) */}
      <div className="flex flex-col gap-2.5">
        {planOptions.map((option) => {
          return (
            <div
              key={option.id}
              onClick={() => onToggleOption(option.id)}
              className={`w-full rounded-lg p-3 border transition-all cursor-pointer select-none ${
                option.selected
                  ? 'bg-indigo-950/70 border-indigo-400/60 shadow-xs ring-1 ring-indigo-400/20'
                  : 'bg-slate-950/50 border-slate-800 opacity-60 hover:opacity-90'
              }`}
            >
              {/* Card Title & Checkbox & Budget */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className={`p-1 rounded shrink-0 transition-colors ${
                      option.selected ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-500 border border-slate-700'
                    }`}
                  >
                    {option.selected ? <Check className="w-3 h-3 stroke-[3]" /> : <Square className="w-3 h-3" />}
                  </div>
                  <h4 className="font-semibold text-xs text-white leading-snug break-words">
                    {option.name}
                  </h4>
                </div>
                <div className="font-mono text-xs font-bold text-emerald-400 shrink-0 pl-1">
                  ${option.budget.toLocaleString()}
                </div>
              </div>

              {/* Placements & Channel Counts */}
              <div className="mt-2 pt-2 border-t border-indigo-500/15 flex items-center justify-between text-[10px] text-indigo-200/80 font-mono">
                <div className="flex items-center gap-1">
                  <Layers className="w-3 h-3 text-indigo-400 shrink-0" />
                  <span>{option.lineItemsCount} Line Item(s)</span>
                </div>
                <div className="flex items-center gap-1">
                  <Tag className="w-3 h-3 text-indigo-400 shrink-0" />
                  <span>{option.rawChannels.length} Channel Type(s)</span>
                </div>
              </div>

              {/* Geo Summary if present */}
              {option.geosSummary && (
                <div className="mt-1 flex items-center gap-1 text-[10px] text-indigo-300/70">
                  <MapPin className="w-3 h-3 text-indigo-400 shrink-0" />
                  <span className="truncate" title={option.geosSummary}>{option.geosSummary}</span>
                </div>
              )}

              {/* Channel Tags */}
              <div className="mt-2 flex flex-wrap gap-1">
                {option.rawChannels.slice(0, 4).map((ch, idx) => (
                  <span
                    key={idx}
                    className="text-[9px] bg-slate-800/90 text-indigo-200 px-1.5 py-0.5 rounded border border-indigo-500/20 truncate max-w-[130px]"
                  >
                    {ch}
                  </span>
                ))}
                {option.rawChannels.length > 4 && (
                  <span className="text-[9px] bg-slate-800/90 text-indigo-300 px-1.5 py-0.5 rounded">
                    +{option.rawChannels.length - 4} more
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
