import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, Download, Loader2, Plus, Sparkles, Tags, X } from 'lucide-react';
import type { Persona, SegmentDimension, SegmentRecommendation } from '../types';
import {
  MAX_SEGMENT_JUSTIFICATION_LENGTH,
  MAX_SEGMENT_NAME_LENGTH,
  MAX_TOTAL_SEGMENTS,
  SEGMENT_DIMENSIONS,
  orderSegmentsForDisplay,
} from '../research/segmentRecommendations';

/** Static class strings so Tailwind can see every one of them at build time. */
export const SEGMENT_DIMENSION_STYLES: Record<SegmentDimension, { chip: string; remove: string; dot: string; ring: string }> = {
  'Demographics': {
    chip: 'bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100',
    remove: 'text-sky-500 hover:text-sky-800 hover:bg-sky-200/70',
    dot: 'bg-sky-500',
    ring: 'ring-2 ring-sky-300 ring-offset-2',
  },
  'In-Market / Intent': {
    chip: 'bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100',
    remove: 'text-amber-500 hover:text-amber-900 hover:bg-amber-200/70',
    dot: 'bg-amber-500',
    ring: 'ring-2 ring-amber-300 ring-offset-2',
  },
  'Interest & Affinity': {
    chip: 'bg-violet-50 text-violet-800 border-violet-200 hover:bg-violet-100',
    remove: 'text-violet-500 hover:text-violet-800 hover:bg-violet-200/70',
    dot: 'bg-violet-500',
    ring: 'ring-2 ring-violet-300 ring-offset-2',
  },
  'Behavioral': {
    chip: 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100',
    remove: 'text-emerald-500 hover:text-emerald-800 hover:bg-emerald-200/70',
    dot: 'bg-emerald-500',
    ring: 'ring-2 ring-emerald-300 ring-offset-2',
  },
};

export type SegmentStatus = 'idle' | 'loading' | 'error';

interface SegmentRecommendationsProps {
  segments: SegmentRecommendation[] | undefined;
  personas: Persona[];
  status: SegmentStatus;
  /** True while a "Suggest more" request (rather than the first set) is in flight. */
  isToppingUp?: boolean;
  error?: string | null;
  autoSaveError?: string | null;
  readOnly?: boolean;
  undoName?: string | null;
  onRemove?: (id: string) => void;
  onUndo?: () => void;
  /** Returns an error message, or null when the segment was added. */
  onAdd?: (input: { name: string; dimension: string; justification: string }) => string | null;
  onSuggestMore?: () => void;
  onGenerate?: () => void;
  onExportCsv?: () => void;
  onHoverSegment?: (segment: SegmentRecommendation | null) => void;
}

const TOOLTIP_WIDTH_PX = 288;

const SegmentTag: React.FC<{
  segment: SegmentRecommendation;
  personas: Persona[];
  readOnly: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onRemove?: (id: string) => void;
}> = ({ segment, personas, readOnly, isOpen, onOpenChange, onRemove }) => {
  const tooltipId = useId();
  const tagRef = useRef<HTMLSpanElement>(null);
  const lastPointerType = useRef<string>('mouse');
  const [alignRight, setAlignRight] = useState(false);
  const styles = SEGMENT_DIMENSION_STYLES[segment.dimension];

  useEffect(() => {
    if (!isOpen || !tagRef.current) return;
    const rect = tagRef.current.getBoundingClientRect();
    setAlignRight(rect.left + TOOLTIP_WIDTH_PX > window.innerWidth - 16);
  }, [isOpen]);

  // Taps never produce a pointerleave, so a touch-opened tooltip closes on the next outside tap.
  useEffect(() => {
    if (!isOpen) return;
    const handleOutside = (event: PointerEvent) => {
      if (tagRef.current && !tagRef.current.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener('pointerdown', handleOutside);
    return () => document.removeEventListener('pointerdown', handleOutside);
  }, [isOpen, onOpenChange]);

  const servedPersonas = segment.personaIndices.map((index) => personas[index]?.name).filter(Boolean);
  const meta = [
    segment.taxonomyPath,
    segment.dataSignal,
    segment.tier,
    segment.source === 'RFP' ? 'From media plan' : undefined,
  ].filter(Boolean);
  const justification = segment.justification || (segment.source === 'User' ? 'Added by planner.' : '');

  return (
    <span
      ref={tagRef}
      className={`relative inline-flex items-center rounded-full border text-xs font-medium transition-colors ${styles.chip}`}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') onOpenChange(true); }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') onOpenChange(false); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onOpenChange(false); }}
    >
      <button
        type="button"
        className={`py-1 cursor-default focus:outline-none focus-visible:underline ${readOnly ? 'px-3' : 'pl-3 pr-1'}`}
        aria-describedby={isOpen ? tooltipId : undefined}
        onPointerDown={(e) => { lastPointerType.current = e.pointerType; }}
        onClick={() => { if (lastPointerType.current !== 'mouse') onOpenChange(!isOpen); }}
        onFocus={() => onOpenChange(true)}
        onBlur={() => onOpenChange(false)}
      >
        {segment.name}
      </button>
      {!readOnly && onRemove && (
        <button
          type="button"
          onClick={() => onRemove(segment.id)}
          className={`mr-1 p-0.5 rounded-full cursor-pointer transition-colors ${styles.remove}`}
          aria-label={`Remove ${segment.name}`}
          title="Remove segment"
        >
          <X className="w-3 h-3" />
        </button>
      )}
      {isOpen && (justification || meta.length > 0 || servedPersonas.length > 0) && (
        <span
          id={tooltipId}
          role="tooltip"
          className={`absolute bottom-full mb-2 z-30 w-72 max-w-[calc(100vw-2rem)] rounded-lg bg-slate-900 text-white shadow-lg p-3 text-left pointer-events-none ${alignRight ? 'right-0' : 'left-0'}`}
        >
          {justification && <span className="block text-xs leading-relaxed">{justification}</span>}
          {meta.length > 0 && (
            <span className="block mt-1.5 text-[11px] leading-snug text-slate-300">{meta.join(' · ')}</span>
          )}
          {servedPersonas.length > 0 && (
            <span className="block mt-1.5 text-[11px] leading-snug text-slate-300">
              <span className="font-semibold text-slate-200">Serves:</span> {servedPersonas.join(', ')}
            </span>
          )}
        </span>
      )}
    </span>
  );
};

const AddSegmentForm: React.FC<{
  onAdd: NonNullable<SegmentRecommendationsProps['onAdd']>;
  onClose: () => void;
}> = ({ onAdd, onClose }) => {
  const [name, setName] = useState('');
  const [dimension, setDimension] = useState('');
  const [justification, setJustification] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const failure = onAdd({ name, dimension, justification });
    if (failure) {
      setFormError(failure);
      return;
    }
    onClose();
  };

  return (
    <form onSubmit={submit} className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => { setName(e.target.value); setFormError(null); }}
          maxLength={MAX_SEGMENT_NAME_LENGTH}
          placeholder="Segment name"
          aria-label="Segment name"
          className="flex-1 min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-200"
        />
        <select
          value={dimension}
          onChange={(e) => { setDimension(e.target.value); setFormError(null); }}
          aria-label="Dimension"
          className="sm:w-48 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-200"
        >
          <option value="">Dimension…</option>
          {SEGMENT_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
      <input
        value={justification}
        onChange={(e) => setJustification(e.target.value)}
        maxLength={MAX_SEGMENT_JUSTIFICATION_LENGTH}
        placeholder="Why this segment? (optional, shown on hover)"
        aria-label="Justification"
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-200"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-rose-600 min-h-[1em]">{formError}</span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1 text-xs font-semibold text-slate-600 hover:text-slate-800 cursor-pointer">
            Cancel
          </button>
          <button type="submit" className="px-3 py-1 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 cursor-pointer">
            Add
          </button>
        </div>
      </div>
    </form>
  );
};

export const SegmentRecommendations: React.FC<SegmentRecommendationsProps> = ({
  segments,
  personas,
  status,
  isToppingUp = false,
  error,
  autoSaveError,
  readOnly = false,
  undoName,
  onRemove,
  onUndo,
  onAdd,
  onSuggestMore,
  onGenerate,
  onExportCsv,
  onHoverSegment,
}) => {
  const [openId, setOpenId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const list = orderSegmentsForDisplay(segments ?? []);
  const hasSegments = list.length > 0;
  const isInitialLoad = status === 'loading' && !isToppingUp;

  useEffect(() => {
    onHoverSegment?.(list.find((s) => s.id === openId) ?? null);
    // Only the open id matters; `list` is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  if (readOnly && !hasSegments) return null;

  const handleOpenChange = (id: string) => (open: boolean) => {
    setOpenId((current) => (open ? id : current === id ? null : current));
  };

  const atCap = list.length >= MAX_TOTAL_SEGMENTS;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-xs space-y-4" id="segment-recommendations">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 text-slate-700 text-xs font-bold uppercase tracking-wider">
          <Tags className="w-4 h-4 text-indigo-600" />
          <span>Segment Recommendations</span>
        </div>
        {!readOnly && hasSegments && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onSuggestMore}
              disabled={status === 'loading' || atCap}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 disabled:text-slate-400 disabled:cursor-not-allowed inline-flex items-center gap-1 cursor-pointer"
              title={atCap ? `Plans hold up to ${MAX_TOTAL_SEGMENTS} segments` : 'Suggest additional segments'}
            >
              {isToppingUp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              <span>{isToppingUp ? 'Suggesting…' : 'Suggest more'}</span>
            </button>
            <button
              type="button"
              onClick={() => setIsAdding(true)}
              disabled={atCap || isAdding}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 disabled:text-slate-400 disabled:cursor-not-allowed inline-flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add segment</span>
            </button>
            <button
              type="button"
              onClick={onExportCsv}
              className="p-1.5 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200/90 rounded-lg inline-flex items-center justify-center cursor-pointer transition-all"
              title="Download segments as CSV"
              aria-label="Download segments as CSV"
            >
              <Download className="w-4 h-4 text-indigo-600" />
            </button>
          </div>
        )}
      </div>

      {isInitialLoad && (
        <div aria-live="polite">
          <div className="flex flex-wrap gap-2">
            {[88, 120, 104, 140, 96, 128, 112, 84].map((width, i) => (
              <span key={i} className="h-6 rounded-full bg-slate-100 animate-pulse" style={{ width }} />
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500 inline-flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />
            Building segment recommendations from your personas…
          </p>
        </div>
      )}

      {hasSegments && (
        <div className="flex flex-wrap gap-2">
          {list.map((segment) => (
            <SegmentTag
              key={segment.id}
              segment={segment}
              personas={personas}
              readOnly={readOnly}
              isOpen={openId === segment.id}
              onOpenChange={handleOpenChange(segment.id)}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}

      {!readOnly && isAdding && onAdd && <AddSegmentForm onAdd={onAdd} onClose={() => setIsAdding(false)} />}

      {status === 'error' && !readOnly && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-100 bg-rose-50/70 px-3 py-2 text-xs text-rose-800">
          <span className="inline-flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            {error || 'Segment recommendations could not be generated.'}
          </span>
          <button type="button" onClick={hasSegments ? onSuggestMore : onGenerate} className="font-semibold underline cursor-pointer shrink-0">
            Retry
          </button>
        </div>
      )}

      {!readOnly && !hasSegments && status === 'idle' && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onGenerate}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200/90 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Generate segment recommendations
          </button>
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            disabled={isAdding}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 disabled:text-slate-400 inline-flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Add segment
          </button>
        </div>
      )}

      {!readOnly && undoName && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-800 px-3 py-2 text-xs text-white" role="status">
          <span className="truncate">Removed “{undoName}”</span>
          <button type="button" onClick={onUndo} className="font-semibold text-indigo-200 hover:text-white cursor-pointer shrink-0">
            Undo
          </button>
        </div>
      )}

      {!readOnly && autoSaveError && (
        <p className="text-[11px] text-amber-700 inline-flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {autoSaveError}
        </p>
      )}

      {(hasSegments || isInitialLoad) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-3 border-t border-slate-100">
          {SEGMENT_DIMENSIONS.map((dimension) => (
            <span key={dimension} className="inline-flex items-center gap-1.5 text-[11px] text-slate-600">
              <span className={`w-2.5 h-2.5 rounded-full ${SEGMENT_DIMENSION_STYLES[dimension].dot}`} aria-hidden="true" />
              {dimension}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
