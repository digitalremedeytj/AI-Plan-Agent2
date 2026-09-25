import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Award,
  BarChart3,
  Check,
  ChevronDown,
  ClipboardCopy,
  Edit2,
  Eye,
  EyeOff,
  Layers,
  Lightbulb,
  Loader2,
  MonitorPlay,
  RefreshCw,
  RotateCcw,
  StickyNote,
  Target,
  Undo2,
  Users,
  Wand2,
} from 'lucide-react';
import { SectionVisibilityButton } from './SectionVisibilityButton';
import { ExecutiveBriefSlideModal } from './ExecutiveBriefSlideModal';
import { BRIEF_SLIDE_VARIANTS, buildBriefSlides, buildGoogleSlidesPrompt, type BriefSlideVariant } from '../research/executiveBriefSlides';
import {
  BRIEF_SECTION_LABELS,
  parseEditText,
  sectionToEditText,
  type BriefBullet,
  type BriefSection,
  type BriefSectionEdit,
  type BriefSectionKey,
  type ExecutiveBrief,
} from '../research/executiveBrief';

export type ExecutiveBriefStatus = 'idle' | 'loading' | 'error';

export interface ExecutiveBriefSectionProps {
  brief?: ExecutiveBrief;
  /** The one-paragraph summary older plans carry. Shown until the planner upgrades. */
  legacySummary?: string;
  status: ExecutiveBriefStatus;
  error?: string | null;
  /** The plan has changed since the brief was written. */
  isStale: boolean;
  readOnly: boolean;
  isHidden: boolean;
  onToggleSection: (sectionKey: string, inactive: boolean) => void;
  onGenerate: (options: { instructions: string; keepEdits: boolean }) => void;
  onUndo: () => void;
  onChangeBrief: (next: ExecutiveBrief) => void;
  /** Plan facts for the "at a glance" strip, read live from the plan. */
  glance: Array<{ label: string; value: string }>;
  /** Live allocation per channel id, so the media table never drifts from the channel plan. */
  livePercents: Record<string, number>;
  /** For slide subtitles and file names. */
  advertiserName?: string;
  geography?: string;
}

const SECTION_ICONS: Record<BriefSectionKey, React.ComponentType<{ className?: string }>> = {
  understanding: Target,
  strategicPov: Lightbulb,
  audience: Users,
  media: Layers,
  measurement: BarChart3,
};

const FUNNEL_STYLES: Record<string, string> = {
  Awareness: 'bg-sky-50 text-sky-700 border-sky-200',
  Consideration: 'bg-violet-50 text-violet-700 border-violet-200',
  Conversion: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Full funnel': 'bg-slate-50 text-slate-700 border-slate-200',
};

const formatPercent = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(1)}%`;

const Bullets: React.FC<{ bullets: BriefBullet[] }> = ({ bullets }) => (
  <ul className="space-y-1.5">
    {bullets.map((bullet, i) => (
      <li key={i} className="flex gap-2 text-[13px] leading-snug text-slate-700">
        <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" aria-hidden="true" />
        <span>
          {bullet.lead && <span className="font-semibold text-slate-900">{bullet.lead}: </span>}
          {bullet.text}
        </span>
      </li>
    ))}
  </ul>
);

const StructuredView: React.FC<{ section: BriefSection; livePercents: Record<string, number> }> = ({ section, livePercents }) => (
  <>
    {section.audienceMatches && section.audienceMatches.length > 0 && (
      <div className="mt-3 space-y-2">
        {section.audienceMatches.map((match, i) => (
          <div key={i} className="rounded-lg border border-slate-100 bg-white px-3 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-bold text-slate-900">{match.audience}</span>
              <span className="text-[10px] text-slate-400">reached with</span>
              {match.reachedWith.map((name) => (
                <span key={name} className="rounded-md border border-indigo-100 bg-indigo-50/70 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                  {name}
                </span>
              ))}
            </div>
            <p className="mt-1 text-xs leading-snug text-slate-600">{match.why}</p>
          </div>
        ))}
      </div>
    )}

    {section.channels && section.channels.length > 0 && (
      <div className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-100 bg-white">
        {section.channels.map((channel) => {
          const live = livePercents[channel.channelId];
          return (
            <div key={channel.channelId} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 px-3 py-2 sm:grid-cols-[minmax(0,11rem)_4rem_7rem_1fr] sm:items-center">
              <span className="text-xs font-bold text-slate-900">{channel.channelName}</span>
              <span className="text-right text-xs font-semibold tabular-nums text-slate-700 sm:text-left">
                {formatPercent(live ?? channel.allocationPercent)}
              </span>
              <span className={`w-fit rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${FUNNEL_STYLES[channel.funnelRole] || FUNNEL_STYLES['Full funnel']}`}>
                {channel.funnelRole}
              </span>
              <span className="col-span-2 text-xs leading-snug text-slate-600 sm:col-span-1">{channel.role}</span>
            </div>
          );
        })}
      </div>
    )}

    {section.measurement && section.measurement.length > 0 && (
      <div className="mt-3 space-y-2">
        {section.measurement.map((item) => (
          <div key={item.capability} className="flex flex-col gap-1 rounded-lg border border-slate-100 bg-white px-3 py-2 sm:flex-row sm:items-start sm:gap-3">
            <div className="flex shrink-0 items-center gap-1.5 sm:w-52">
              <span className="text-xs font-bold text-slate-900">{item.capability}</span>
              {item.advanced && (
                <span className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700">
                  Business impact
                </span>
              )}
            </div>
            <span className="flex-1 text-xs leading-snug text-slate-600">{item.proves}</span>
            {item.kpi && (
              <span className="w-fit shrink-0 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                {item.kpi}
              </span>
            )}
          </div>
        ))}
      </div>
    )}
  </>
);

interface SectionCardProps {
  section: BriefSection;
  edit?: BriefSectionEdit;
  isInactive: boolean;
  readOnly: boolean;
  livePercents: Record<string, number>;
  onSave: (edit: BriefSectionEdit) => void;
  onReset: () => void;
  onToggleActive: (inactive: boolean) => void;
}

/** One brief section, editable the way the channel details are: edit, reset, hide from share link. */
const SectionCard: React.FC<SectionCardProps> = ({ section, edit, isInactive, readOnly, livePercents, onSave, onReset, onToggleActive }) => {
  const labels = BRIEF_SECTION_LABELS[section.key];
  const Icon = SECTION_ICONS[section.key];
  const title = edit?.title || labels.title;
  const defaultText = sectionToEditText(section, livePercents);
  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftContent, setDraftContent] = useState(edit?.content ?? defaultText);

  useEffect(() => {
    if (!isEditing) {
      setDraftTitle(title);
      setDraftContent(edit?.content ?? defaultText);
    }
  }, [title, edit?.content, defaultText, isEditing]);

  if (readOnly && isInactive) return null;

  const edited = edit?.content !== undefined ? parseEditText(edit.content) : null;
  const headline = edited ? edited.headline : section.headline;
  const bullets = edited ? edited.bullets : section.bullets;
  const hasOverride = Boolean(edit?.content !== undefined || edit?.title || isInactive);

  const commit = () => {
    setIsEditing(false);
    const nextTitle = draftTitle.trim();
    const nextContent = draftContent.trim();
    onSave({
      ...(nextTitle && nextTitle !== labels.title ? { title: nextTitle } : {}),
      ...(nextContent !== defaultText ? { content: nextContent } : {}),
    });
  };
  const cancel = () => {
    setDraftTitle(title);
    setDraftContent(edit?.content ?? defaultText);
    setIsEditing(false);
  };

  return (
    <div
      data-brief-section={section.key}
      className={`group/section relative rounded-xl border p-4 transition-all ${
        isInactive
          ? 'border-dashed border-slate-300 bg-slate-100/70 opacity-40 hover:opacity-70'
          : 'border-indigo-100/70 bg-white/85 shadow-2xs'
      }`}
    >
      {!readOnly && !isEditing && (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
          {hasOverride && (
            <button
              type="button"
              onClick={onReset}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 opacity-0 transition-opacity hover:bg-slate-200/60 hover:text-slate-700 group-hover/section:opacity-100"
              title="Reset to the generated version"
              aria-label="Reset to the generated version"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 opacity-0 transition-opacity hover:bg-slate-200/60 hover:text-slate-700 group-hover/section:opacity-100"
            title="Edit this section"
            aria-label="Edit this section"
          >
            <Edit2 className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => onToggleActive(!isInactive)}
            className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition-all ${
              isInactive
                ? 'bg-amber-100/80 text-amber-700 hover:bg-amber-200'
                : 'text-slate-400 opacity-0 hover:bg-slate-200/60 hover:text-slate-700 group-hover/section:opacity-100'
            }`}
            title={isInactive ? 'Inactive (hidden from share link) - click to show' : 'Active - click to hide from share link'}
            aria-label={isInactive ? 'Show in share view' : 'Hide from share view'}
          >
            {isInactive ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
      )}

      <div className="mb-2 flex items-center gap-2 pr-20">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <h4 className="text-sm font-bold leading-tight text-slate-900">{title}</h4>
          <p className="text-[11px] leading-tight text-slate-500">{labels.subtitle}</p>
        </div>
        {isInactive && !readOnly && (
          <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-800">Inactive in share link</span>
        )}
      </div>

      {!readOnly && isEditing ? (
        <div
          className="space-y-2"
          onKeyDown={(e) => {
            if (e.key === 'Escape') cancel();
          }}
        >
          <input
            type="text"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            className="w-full rounded-md border border-indigo-300 bg-white px-2 py-1 text-xs font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            aria-label="Section title"
            autoFocus
          />
          <textarea
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
            rows={Math.min(14, Math.max(5, draftContent.split('\n').length + 1))}
            className="w-full rounded-md border border-indigo-300 bg-white px-2 py-1.5 font-mono text-[11px] leading-relaxed text-slate-800 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            aria-label="Section content"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] text-slate-400">First line is the headline. One bullet per line starting with "- "; "Lead: text" makes the lead bold. Esc to cancel.</span>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={cancel} className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200">
                Cancel
              </button>
              <button type="button" onClick={commit} className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-indigo-700">
                Save
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div onClick={() => { if (!readOnly) setIsEditing(true); }} className={readOnly ? '' : 'cursor-pointer'}>
          {headline && <p className="mb-2 text-[13px] font-semibold leading-snug text-indigo-950">{headline}</p>}
          {bullets.length > 0 && <Bullets bullets={bullets} />}
          {!edited && <StructuredView section={section} livePercents={livePercents} />}
        </div>
      )}
    </div>
  );
};

const RegeneratePanel: React.FC<{
  initialInstructions: string;
  editedCount: number;
  onSubmit: (options: { instructions: string; keepEdits: boolean }) => void;
  onCancel: () => void;
}> = ({ initialInstructions, editedCount, onSubmit, onCancel }) => {
  const [instructions, setInstructions] = useState(initialInstructions);
  const [keepEdits, setKeepEdits] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="rounded-xl border border-indigo-200 bg-white p-4 shadow-xs">
      <label htmlFor="brief-instructions" className="mb-1 block text-xs font-bold text-slate-900">
        Instructions for this version <span className="font-normal text-slate-500">(optional)</span>
      </label>
      <textarea
        id="brief-instructions"
        ref={ref}
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        maxLength={600}
        rows={2}
        placeholder='e.g. "Really highlight our advanced attribution" or "Lead with the retail data partnership"'
        className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
      />
      <p className="mt-1 text-[10px] text-slate-500">
        Instructions change emphasis and wording. They can't add anything the plan doesn't include; you'll get a note if one asks for that.
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {editedCount > 0 ? (
          <label className="flex items-center gap-1.5 text-xs text-slate-700">
            <input type="checkbox" checked={keepEdits} onChange={(e) => setKeepEdits(e.target.checked)} className="accent-indigo-600" />
            Keep my hand edits ({editedCount} section{editedCount === 1 ? '' : 's'})
          </label>
        ) : <span />}
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={onCancel} className="rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSubmit({ instructions: instructions.trim(), keepEdits })}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700"
          >
            <Wand2 className="h-3.5 w-3.5" />
            Regenerate
          </button>
        </div>
      </div>
    </div>
  );
};

export const ExecutiveBriefSection: React.FC<ExecutiveBriefSectionProps> = ({
  brief,
  legacySummary,
  status,
  error,
  isStale,
  readOnly,
  isHidden,
  onToggleSection,
  onGenerate,
  onUndo,
  onChangeBrief,
  glance,
  livePercents,
  advertiserName,
  geography,
}) => {
  const [showRegenerate, setShowRegenerate] = useState(false);
  const [slideModalOpen, setSlideModalOpen] = useState(false);
  const [promptMenuOpen, setPromptMenuOpen] = useState(false);
  const [promptCopied, setPromptCopied] = useState<string | null>(null);
  const slideContext = { advertiserName, geography, livePercents, glance };
  const promptMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!promptMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (promptMenuRef.current && !promptMenuRef.current.contains(e.target as Node)) setPromptMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [promptMenuOpen]);

  // Gemini in Google Slides builds one slide per request, so each slide has its own prompt.
  const copyGoogleSlidesPrompt = async (variant: BriefSlideVariant, index: number) => {
    if (!brief) return;
    setPromptMenuOpen(false);
    const slides = buildBriefSlides(brief, variant, slideContext);
    try {
      await navigator.clipboard.writeText(buildGoogleSlidesPrompt(slides[index], { advertiserName, position: { index, count: slides.length } }));
      setPromptCopied(`${variant}:${index}`);
      setTimeout(() => setPromptCopied(null), 2500);
    } catch (err) {
      console.error('Copying the Google Slides prompt failed:', err);
    }
  };
  const loading = status === 'loading';
  const edits = brief?.edits || {};
  const hiddenPanels = new Set(brief?.hiddenPanels || []);
  const editedCount = Object.values(edits).filter((e) => e && (e.content !== undefined || e.title)).length;

  const updateBrief = (change: Partial<ExecutiveBrief>) => brief && onChangeBrief({ ...brief, ...change });
  const saveEdit = (key: BriefSectionKey, edit: BriefSectionEdit) => {
    const next = { ...edits };
    if (edit.content === undefined && !edit.title) delete next[key];
    else next[key] = edit;
    updateBrief({ edits: next });
  };
  const resetSection = (key: BriefSectionKey) => {
    const next = { ...edits };
    delete next[key];
    updateBrief({ edits: next, hiddenPanels: (brief?.hiddenPanels || []).filter((k) => k !== key) });
  };
  const toggleSection = (key: BriefSectionKey, inactive: boolean) => {
    const current = brief?.hiddenPanels || [];
    updateBrief({ hiddenPanels: inactive ? Array.from(new Set([...current, key])) : current.filter((k) => k !== key) });
  };
  const generate = (options: { instructions: string; keepEdits: boolean }) => {
    setShowRegenerate(false);
    onGenerate(options);
  };

  const sections = brief?.sections || [];
  const top = sections.filter((s) => s.key === 'understanding' || s.key === 'strategicPov');
  const rest = sections.filter((s) => s.key !== 'understanding' && s.key !== 'strategicPov');
  const renderCard = (section: BriefSection) => (
    <SectionCard
      key={section.key}
      section={section}
      edit={edits[section.key]}
      isInactive={hiddenPanels.has(section.key)}
      readOnly={readOnly}
      livePercents={livePercents}
      onSave={(edit) => saveEdit(section.key, edit)}
      onReset={() => resetSection(section.key)}
      onToggleActive={(inactive) => toggleSection(section.key, inactive)}
    />
  );

  // A shared plan with neither a brief nor a legacy paragraph has nothing to show.
  if (readOnly && !brief && !legacySummary) return null;

  return (
    <div
      id="executive-brief"
      className={`group relative space-y-5 rounded-2xl p-6 shadow-xs transition-all md:p-8 ${
        isHidden
          ? 'border border-dashed border-slate-300 bg-slate-100/70 opacity-40 hover:opacity-70'
          : 'border border-indigo-100/90 bg-gradient-to-br from-indigo-50/70 via-white to-slate-50'
      }`}
    >
      <div className="flex flex-col justify-between gap-3 border-b border-indigo-100/60 pb-4 sm:flex-row sm:items-center">
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-indigo-700">
            <Award className="h-4 w-4 text-indigo-600" />
            <span>Executive Summary Blueprint</span>
          </div>
          <h3 className="font-display text-xl font-bold text-slate-900">The Plan at a Glance</h3>
        </div>
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2 self-start sm:justify-end sm:self-auto">
            <SectionVisibilityButton sectionKey="executiveSummary" isInactive={isHidden} onToggle={onToggleSection} />
            {brief?.previous && !loading && (
              <button
                type="button"
                onClick={onUndo}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                title="Go back to the version before the last regenerate"
              >
                <Undo2 className="h-3.5 w-3.5" />
                Undo
              </button>
            )}
            {brief && (
              <div className="relative" ref={promptMenuRef}>
                <button
                  type="button"
                  onClick={() => setPromptMenuOpen((v) => !v)}
                  disabled={loading}
                  aria-haspopup="menu"
                  aria-expanded={promptMenuOpen}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                  title="Copy a prompt for the Gemini chat in Google Slides"
                >
                  {promptCopied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
                  {promptCopied ? 'Copied' : 'Google Slides prompt'}
                  <ChevronDown className="h-3 w-3" />
                </button>
                {promptMenuOpen && (
                  <div role="menu" className="absolute right-0 z-20 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
                    {(Object.keys(BRIEF_SLIDE_VARIANTS) as BriefSlideVariant[]).map((variant) => {
                      const slides = buildBriefSlides(brief, variant, slideContext);
                      if (!slides.length) return null;
                      return (
                        <div key={variant} className="py-0.5">
                          <p className="px-3 pb-0.5 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            {BRIEF_SLIDE_VARIANTS[variant].label}
                          </p>
                          {slides.map((slide, index) => (
                            <button
                              key={slide.id}
                              type="button"
                              role="menuitem"
                              onClick={() => copyGoogleSlidesPrompt(variant, index)}
                              className="block w-full rounded-lg px-3 py-1.5 text-left text-xs font-semibold text-slate-900 hover:bg-slate-50"
                            >
                              {slides.length === 1 ? 'Copy overview slide prompt' : `Copy slide ${index + 1}: ${slide.label.replace(/^\d+\.\s*/, '')}`}
                            </button>
                          ))}
                        </div>
                      );
                    })}
                    <p className="px-3 pb-1 pt-1.5 text-[10px] text-slate-400">Gemini in Google Slides builds one slide at a time: paste each prompt into a new chat request.</p>
                  </div>
                )}
              </div>
            )}
            {brief && (
              <button
                type="button"
                onClick={() => setSlideModalOpen(true)}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-100 disabled:opacity-60"
              >
                <MonitorPlay className="h-3.5 w-3.5 text-[#0e8f86]" />
                Export slide
              </button>
            )}
            {brief && (
              <button
                type="button"
                onClick={() => setShowRegenerate((v) => !v)}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {loading ? 'Writing...' : 'Regenerate'}
              </button>
            )}
          </div>
        )}
      </div>

      {!readOnly && isStale && brief && !loading && (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2 text-xs font-medium text-amber-900">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            The plan has changed since this summary was written.
          </span>
          <button
            type="button"
            onClick={() => setShowRegenerate(true)}
            className="inline-flex w-fit items-center gap-1.5 rounded-md bg-amber-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-amber-700"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Regenerate
          </button>
        </div>
      )}

      {!readOnly && showRegenerate && !loading && (
        <RegeneratePanel
          initialInstructions={brief?.instructions || ''}
          editedCount={editedCount}
          onSubmit={generate}
          onCancel={() => setShowRegenerate(false)}
        />
      )}

      {!readOnly && status === 'error' && (
        <div className="flex flex-col gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-rose-800">{error || 'The executive summary could not be written.'}{brief ? ' The previous version is still shown.' : ''}</span>
          <button
            type="button"
            onClick={() => onGenerate({ instructions: brief?.instructions || '', keepEdits: true })}
            className="inline-flex w-fit items-center gap-1.5 rounded-md border border-rose-300 bg-white px-2.5 py-1 text-xs font-bold text-rose-700 hover:bg-rose-100"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Try again
          </button>
        </div>
      )}

      {glance.length > 0 && (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {glance.map((fact) => (
            <div key={fact.label} className="rounded-lg border border-indigo-100/70 bg-white/80 px-3 py-2">
              <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{fact.label}</dt>
              <dd className="truncate text-sm font-semibold text-slate-900" title={fact.value}>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {brief ? (
        <div className={`space-y-4 transition-opacity ${loading ? 'pointer-events-none opacity-50' : ''}`} aria-busy={loading}>
          {loading && (
            <p className="flex items-center gap-2 text-xs font-medium text-indigo-700">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Rewriting the summary from the current plan...
            </p>
          )}
          {top.length > 0 && <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{top.map(renderCard)}</div>}
          {rest.map(renderCard)}

          {!readOnly && brief.plannerNotes.length > 0 && (
            <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 px-3.5 py-2.5">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-800">
                <StickyNote className="h-3.5 w-3.5" />
                Notes for you (not shown in the share link)
              </div>
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-900">
                {brief.plannerNotes.map((note, i) => <li key={i}>{note}</li>)}
              </ul>
            </div>
          )}

          {!readOnly && (
            <p className="text-[10px] text-slate-400">
              Written {new Date(brief.generatedAt).toLocaleString()} from the plan as it stood then
              {brief.instructions ? `, with your instructions: "${brief.instructions}"` : ''}.
            </p>
          )}
        </div>
      ) : loading ? (
        <div className="space-y-3" aria-busy="true">
          <p className="flex items-center gap-2 text-xs font-medium text-indigo-700">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Writing the executive summary from the finished plan...
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {[0, 1].map((i) => <div key={i} className="h-32 animate-pulse rounded-xl bg-indigo-100/40" />)}
          </div>
          {[0, 1].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-indigo-100/40" />)}
        </div>
      ) : (
        <div className="space-y-3">
          {legacySummary && <p className="text-sm leading-relaxed text-slate-700">{legacySummary}</p>}
          {!readOnly && (
            <div className="flex flex-col gap-2 rounded-xl border border-indigo-100 bg-white/80 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs text-slate-600">
                {legacySummary
                  ? 'This plan uses the older one-paragraph summary. The new format covers understanding, strategy, audience, media and measurement.'
                  : 'No executive summary yet.'}
              </span>
              <button
                type="button"
                onClick={() => onGenerate({ instructions: '', keepEdits: false })}
                className="inline-flex w-fit items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700"
              >
                <Wand2 className="h-3.5 w-3.5" />
                {legacySummary ? 'Upgrade to the new format' : 'Write the executive summary'}
              </button>
            </div>
          )}
        </div>
      )}

      {brief && !readOnly && (
        <ExecutiveBriefSlideModal
          isOpen={slideModalOpen}
          onClose={() => setSlideModalOpen(false)}
          brief={brief}
          context={slideContext}
          isStale={isStale}
        />
      )}
    </div>
  );
};
