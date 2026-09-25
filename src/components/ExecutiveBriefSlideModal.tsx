import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCopy,
  Copy,
  Download,
  LayoutGrid,
  Maximize2,
  MonitorPlay,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sliders,
  Sparkles,
  X,
} from 'lucide-react';
import { authFetch } from '../api/client';
import type { ExecutiveBrief } from '../research/executiveBrief';
import {
  BRIEF_SLIDE_VARIANTS,
  SLIDE_WORD_BUDGET,
  buildBriefSlides,
  buildGoogleSlidesPrompt,
  countWords,
  type BriefSlideContext,
  type BriefSlideSpec,
  type BriefSlideStyle,
  type BriefSlideVariant,
  type ProofreadResult,
} from '../research/executiveBriefSlides';
import { ASPECT_RATIO_OPTIONS, type SlideAspectRatio } from './PersonaSlideExportModal';

interface GeneratedBriefSlide {
  specId: string;
  label: string;
  imageUrl: string;
  aspectRatio: SlideAspectRatio;
  proofread: ProofreadResult | null;
}

export interface ExecutiveBriefSlideModalProps {
  isOpen: boolean;
  onClose: () => void;
  brief: ExecutiveBrief;
  context: BriefSlideContext;
  isStale: boolean;
  initialVariant?: BriefSlideVariant;
}

const STYLE_OPTIONS: Array<{ value: BriefSlideStyle; label: string; hint: string }> = [
  { value: 'corporate_light', label: 'Corporate Light', hint: 'White canvas, teal accents' },
  { value: 'modern_dark', label: 'Modern Dark', hint: 'Deep teal canvas' },
  { value: 'minimal_slate', label: 'Minimal Slate', hint: 'Editorial, thin dividers' },
];

const ISSUE_LABELS: Record<string, string> = {
  misspelling: 'Misspelling',
  wrong_number: 'Wrong number',
  missing_text: 'Missing',
  extra_text: 'Extra text',
  logo_or_footer: 'Logo / footer',
};

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

export const ExecutiveBriefSlideModal: React.FC<ExecutiveBriefSlideModalProps> = ({
  isOpen,
  onClose,
  brief,
  context,
  isStale,
  initialVariant = 'highlights',
}) => {
  const [variant, setVariant] = useState<BriefSlideVariant>(initialVariant);
  const [aspectRatio, setAspectRatio] = useState<SlideAspectRatio>('16:9');
  const [style, setStyle] = useState<BriefSlideStyle>('corporate_light');
  const [proofread, setProofread] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customNotes, setCustomNotes] = useState('');
  const [specs, setSpecs] = useState<Record<BriefSlideVariant, BriefSlideSpec[]>>({ highlights: [], full: [] });
  const [slides, setSlides] = useState<Record<BriefSlideVariant, GeneratedBriefSlide[]>>({ highlights: [], full: [] });
  const [activeIndex, setActiveIndex] = useState(0);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  // 'image', or the id of the slide whose Google Slides prompt was copied.
  const [copied, setCopied] = useState<string | null>(null);
  const [isZoomed, setIsZoomed] = useState(false);

  const buildSpecs = () => ({
    highlights: buildBriefSlides(brief, 'highlights', context),
    full: buildBriefSlides(brief, 'full', context),
  });

  // Fresh slide text from the brief as it stands each time the studio opens.
  useEffect(() => {
    if (!isOpen) return;
    setSpecs(buildSpecs());
    setVariant(initialVariant);
    setActiveIndex(0);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const currentSpecs = specs[variant];
  const currentSlides = slides[variant];
  const activeSlide = currentSlides[activeIndex];
  const isGenerating = pending.size > 0;
  const budget = SLIDE_WORD_BUDGET[variant];
  const ratioOption = ASPECT_RATIO_OPTIONS.find((o) => o.value === aspectRatio) || ASPECT_RATIO_OPTIONS[2];

  const flash = (kind: string) => {
    setCopied(kind);
    setTimeout(() => setCopied(null), 2500);
  };

  const generateOne = async (spec: BriefSlideSpec): Promise<GeneratedBriefSlide> => {
    const response = await authFetch('/api/executive-brief/generate-slide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: spec.text, layout: spec.layout, style, aspectRatio, customNotes: customNotes.trim(), proofread }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.dataUrl) throw new Error(data.details || data.error || `Server responded with ${response.status}`);
    return { specId: spec.id, label: spec.label, imageUrl: data.dataUrl, aspectRatio, proofread: data.proofread || null };
  };

  // Slides render in parallel; each one lands in its own position as it finishes.
  const generate = async (only?: BriefSlideSpec) => {
    const targets = only ? [only] : currentSpecs;
    const forVariant = variant;
    setError(null);
    const order = currentSpecs.map((s) => s.id);
    setPending(new Set(targets.map((t) => t.id)));
    // A full regenerate starts a fresh set; regenerating one slide replaces only that slide.
    if (!only) {
      setActiveIndex(0);
      setSlides((prev) => ({ ...prev, [forVariant]: [] }));
    }
    await Promise.all(targets.map(async (spec) => {
      try {
        const slide = await generateOne(spec);
        setSlides((prev) => ({
          ...prev,
          [forVariant]: [...prev[forVariant].filter((s) => s.specId !== slide.specId), slide]
            .sort((a, b) => order.indexOf(a.specId) - order.indexOf(b.specId)),
        }));
      } catch (err: any) {
        console.error('[ExecutiveBriefSlideModal] Slide generation failed:', err);
        setError(`${spec.label}: ${err?.message || 'the slide could not be generated.'}`);
      } finally {
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(spec.id);
          return next;
        });
      }
    }));
  };

  const updateText = (id: string, text: string) =>
    setSpecs((prev) => ({ ...prev, [variant]: prev[variant].map((s) => (s.id === id ? { ...s, text } : s)) }));

  const resetText = () => setSpecs((prev) => ({ ...prev, [variant]: buildSpecs()[variant] }));

  const filename = (slide: GeneratedBriefSlide) => {
    const brand = (context.advertiserName || 'plan').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'plan';
    return `${brand}-executive-summary-${variant}-${slide.specId}-${slide.aspectRatio.replace(':', 'x')}.png`;
  };

  const download = (slide: GeneratedBriefSlide) => {
    const link = document.createElement('a');
    link.href = slide.imageUrl;
    link.download = filename(slide);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const copyImage = async (slide: GeneratedBriefSlide) => {
    try {
      const blob = await (await fetch(slide.imageUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      flash('image');
    } catch (err) {
      console.error('Copying the slide image failed:', err);
      setError('Your browser blocked copying the image. Use Download instead.');
    }
  };

  // Gemini in Google Slides builds one slide per request, so each slide has its own prompt.
  const copyPrompt = async (index: number) => {
    const spec = currentSpecs[index];
    try {
      await copyText(buildGoogleSlidesPrompt(spec, { advertiserName: context.advertiserName, style, position: { index, count: currentSpecs.length } }));
      flash(spec.id);
    } catch (err) {
      console.error('Copying the Google Slides prompt failed:', err);
      setError('Your browser blocked the clipboard. Try again after clicking inside the page.');
    }
  };

  const overBudget = currentSpecs.some((s) => countWords(s.text) > budget);

  return (
    <div
      id="executive-brief-slide-modal"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/70 p-3 backdrop-blur-xs sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isGenerating) onClose();
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/80 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0e8f86] text-white shadow-xs">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">Export Executive Summary Slide</h2>
                <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                  {ratioOption.label} ({ratioOption.width}×{ratioOption.height})
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">Complete slides with a title, in Digital Remedy branding, with no logo or footer.</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
              <span className="hidden sm:inline">Ratio:</span>
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value as SlideAspectRatio)}
                disabled={isGenerating}
                className="rounded-lg border border-slate-300 bg-white py-1.5 pl-2 pr-7 text-xs font-bold text-slate-800 shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-[#0e8f86] disabled:opacity-50"
              >
                {ASPECT_RATIO_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.name}</option>)}
              </select>
            </label>
            <button
              type="button"
              onClick={onClose}
              disabled={isGenerating}
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
              aria-label="Close executive summary slide export"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          {isStale && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>The plan has changed since this summary was written. Close this and regenerate the summary first, or the slide will describe the older plan.</span>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <span className="flex-1">{error}</span>
              <button type="button" onClick={() => setError(null)} className="font-semibold text-red-500 hover:text-red-700">Dismiss</button>
            </div>
          )}

          {/* Version */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(Object.keys(BRIEF_SLIDE_VARIANTS) as BriefSlideVariant[]).map((key) => {
              const selected = variant === key;
              const count = specs[key].length;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => { if (!isGenerating) { setVariant(key); setActiveIndex(0); } }}
                  disabled={isGenerating}
                  className={`rounded-xl border p-4 text-left transition-all ${
                    selected ? 'border-[#0e8f86] bg-teal-50/60 ring-1 ring-[#0e8f86]' : 'border-slate-200 bg-white hover:border-slate-300'
                  } disabled:cursor-not-allowed`}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm font-bold text-slate-900">
                      <LayoutGrid className={`h-4 w-4 ${selected ? 'text-[#0e8f86]' : 'text-slate-400'}`} />
                      {BRIEF_SLIDE_VARIANTS[key].label}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                      {count} slide{count === 1 ? '' : 's'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{BRIEF_SLIDE_VARIANTS[key].description}</p>
                </button>
              );
            })}
          </div>

          {/* Style */}
          <div className="space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Visual style</span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {STYLE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setStyle(option.value)}
                  disabled={isGenerating}
                  className={`rounded-lg border px-3 py-2 text-left text-xs transition-all ${
                    style === option.value ? 'border-[#0e8f86] bg-teal-50/60 font-bold text-slate-900' : 'border-slate-200 text-slate-700 hover:border-slate-300'
                  }`}
                >
                  {option.label}
                  <span className="block text-[10px] font-normal text-slate-500">{option.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Slide content, editable */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Slide content (rendered word for word)</span>
              <button type="button" onClick={resetText} disabled={isGenerating} className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800">
                <RotateCcw className="h-3 w-3" />
                Reset from the summary
              </button>
            </div>
            {currentSpecs.length === 0 && <p className="text-xs text-slate-500">The summary has no visible sections to put on a slide.</p>}
            {currentSpecs.map((spec) => {
              const words = countWords(spec.text);
              return (
                <div key={spec.id} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-800">{spec.label}</span>
                    <span className={words > budget ? 'font-bold text-amber-700' : 'text-slate-500'}>
                      {words} / {budget} words{words > budget ? ' - long text may render with errors' : ''}
                    </span>
                  </div>
                  <textarea
                    value={spec.text}
                    onChange={(e) => updateText(spec.id, e.target.value)}
                    disabled={isGenerating}
                    rows={Math.min(16, spec.text.split('\n').length + 1)}
                    className="w-full rounded-lg border border-slate-200 bg-white p-2.5 font-mono text-[11px] leading-relaxed text-slate-800 focus:border-[#0e8f86] focus:outline-hidden focus:ring-2 focus:ring-[#0e8f86]/20"
                    aria-label={`${spec.label} content`}
                  />
                </div>
              );
            })}
            <p className="text-[11px] text-slate-500">
              Edits here apply to this export only. Labels like SLIDE TITLE and SECTION tell the renderer how to lay out the slide; they aren't printed.
            </p>
          </div>

          {/* Options */}
          <div className="space-y-3">
            <label className="flex items-start gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={proofread} onChange={(e) => setProofread(e.target.checked)} disabled={isGenerating} className="mt-0.5 accent-[#0e8f86]" />
              <span>
                <span className="font-semibold text-slate-900">Proofread each slide</span> (about 20s more). Gemini reads the finished image back and flags misspellings, wrong numbers, missing lines, or a logo or footer.
              </span>
            </label>
            <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800">
              <Sliders className="h-3.5 w-3.5" />
              {showAdvanced ? 'Hide custom design directives' : 'Add custom design directives (optional)'}
              <ChevronRight className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} />
            </button>
            {showAdvanced && (
              <textarea
                rows={2}
                value={customNotes}
                onChange={(e) => setCustomNotes(e.target.value)}
                maxLength={600}
                placeholder="e.g. Make the channel allocation bars the visual focus, or use more generous spacing between cards..."
                className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-xs placeholder:text-slate-400 focus:border-[#0e8f86] focus:outline-hidden focus:ring-2 focus:ring-[#0e8f86]/20"
              />
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              {currentSpecs.length > 1 && <span className="text-xs font-semibold text-slate-500">Google Slides prompts, one per slide:</span>}
              {currentSpecs.map((spec, index) => (
                <button
                  key={spec.id}
                  type="button"
                  onClick={() => copyPrompt(index)}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                  title="Copies a prompt for the Gemini chat in Google Slides, with this slide's content and the brand design"
                >
                  {copied === spec.id ? <Check className="h-4 w-4 text-emerald-600" /> : <ClipboardCopy className="h-4 w-4" />}
                  {copied === spec.id
                    ? 'Copied: paste into Gemini in Google Slides'
                    : currentSpecs.length === 1 ? 'Copy Google Slides prompt' : `Slide ${index + 1}: ${spec.label.replace(/^\d+\.\s*/, '')}`}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => generate()}
              disabled={isGenerating || currentSpecs.length === 0}
              className={`flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-bold shadow-xs transition-all ${
                isGenerating ? 'cursor-not-allowed bg-slate-200 text-slate-400' : 'bg-[#0e8f86] text-white hover:bg-[#0c7a72]'
              }`}
            >
              {isGenerating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {isGenerating
                ? `Generating ${currentSpecs.length - pending.size}/${currentSpecs.length} done...`
                : `${currentSlides.length ? 'Regenerate' : 'Generate'} ${currentSpecs.length === 1 ? 'slide' : `${currentSpecs.length} slides`} (${aspectRatio})`}
            </button>
          </div>
          {overBudget && !isGenerating && (
            <p className="-mt-3 text-right text-[11px] text-amber-700">A slide is over its word budget; consider trimming it first.</p>
          )}

          {isGenerating && (
            <div className="space-y-2 rounded-xl border border-teal-100 bg-teal-50/80 p-4 text-xs font-semibold text-teal-950">
              <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-[#0e8f86]" />
                Rendering {pending.size === 1 ? 'the slide' : `${pending.size} slides in parallel`}{proofread ? ', then proofreading' : ''}... usually 1-3 minutes.
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-teal-100">
                <div className="h-full animate-pulse rounded-full bg-[#0e8f86]" style={{ width: `${Math.max(15, ((currentSpecs.length - pending.size) / Math.max(1, currentSpecs.length)) * 100)}%` }} />
              </div>
            </div>
          )}

          {/* Gallery */}
          {currentSlides.length > 0 && (
            <div className="space-y-4 border-t border-slate-200 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-900">
                  <MonitorPlay className="h-4 w-4 text-[#0e8f86]" />
                  Generated slides ({currentSlides.length})
                </span>
                {currentSlides.length > 1 && (
                  <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
                    {currentSlides.map((s, i) => (
                      <button
                        key={s.specId}
                        type="button"
                        onClick={() => setActiveIndex(i)}
                        className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium ${
                          activeIndex === i ? 'border border-slate-200/80 bg-white font-bold text-[#0e8f86] shadow-xs' : 'text-slate-600 hover:bg-slate-200/50'
                        }`}
                      >
                        {s.label}
                        {s.proofread?.status === 'issues' && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-label="has proofread issues" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {activeSlide && (
                <div className="space-y-3">
                  <div className="flex w-full justify-center">
                    <div
                      className="group relative flex items-center justify-center overflow-hidden rounded-[4px] border border-gray-200 bg-white p-1 shadow-xs sm:p-2"
                      style={{ aspectRatio: activeSlide.aspectRatio.replace(':', '/'), maxHeight: '520px', maxWidth: '100%' }}
                    >
                      <img src={activeSlide.imageUrl} alt={`Executive summary slide: ${activeSlide.label}`} className="max-h-full max-w-full rounded-[4px] object-contain" />
                      <button
                        type="button"
                        onClick={() => setIsZoomed(true)}
                        className="absolute right-2.5 top-2.5 flex items-center gap-1.5 rounded-[4px] bg-slate-900/80 p-1.5 text-xs font-medium text-white hover:bg-slate-900"
                      >
                        <Maximize2 className="h-3.5 w-3.5" />
                        <span className="hidden text-[11px] sm:inline">Inspect Full</span>
                      </button>
                    </div>
                  </div>

                  {/* Proofread result */}
                  {activeSlide.proofread && (
                    activeSlide.proofread.status === 'clean' ? (
                      <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium text-emerald-800">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        Proofread: the slide matches its content, with no logo or footer.
                      </div>
                    ) : activeSlide.proofread.status === 'issues' ? (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
                        <div className="mb-1 flex items-center gap-2 font-bold">
                          <ShieldCheck className="h-4 w-4 text-amber-600" />
                          Proofread found {activeSlide.proofread.issues.length} issue{activeSlide.proofread.issues.length === 1 ? '' : 's'}. Regenerate this slide, or fix it in your deck.
                        </div>
                        <ul className="space-y-0.5 pl-6">
                          {activeSlide.proofread.issues.map((issue, i) => (
                            <li key={i} className="list-disc">
                              <span className="font-semibold">{ISSUE_LABELS[issue.type] || issue.type}:</span>{' '}
                              {issue.found && <>shows "{issue.found}"</>}
                              {issue.found && issue.expected && ', '}
                              {issue.expected && <>should be "{issue.expected}"</>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
                        The proofread did not complete for this slide; check its text yourself before using it.
                      </div>
                    )
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                    <span className="text-xs text-slate-600">
                      <span className="font-semibold text-slate-900">{activeSlide.label}</span>
                      <span className="mx-1.5 text-slate-400">•</span>
                      {ratioOption.value === activeSlide.aspectRatio ? `${ratioOption.width}×${ratioOption.height} ` : ''}PNG ({activeSlide.aspectRatio})
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const spec = currentSpecs.find((s) => s.id === activeSlide.specId);
                          if (spec) generate(spec);
                        }}
                        disabled={isGenerating}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                      >
                        <RefreshCw className="h-3.5 w-3.5 text-slate-500" />
                        Regenerate this slide
                      </button>
                      <button
                        type="button"
                        onClick={() => copyImage(activeSlide)}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        {copied === 'image' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-slate-500" />}
                        {copied === 'image' ? 'Copied!' : 'Copy image'}
                      </button>
                      <button
                        type="button"
                        onClick={() => download(activeSlide)}
                        className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-slate-800"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download PNG
                      </button>
                      {currentSlides.length > 1 && (
                        <button
                          type="button"
                          onClick={() => currentSlides.forEach((s, i) => setTimeout(() => download(s), i * 300))}
                          className="flex items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-3.5 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-100"
                        >
                          <Download className="h-3.5 w-3.5 text-[#0e8f86]" />
                          Download All ({currentSlides.length})
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {isZoomed && activeSlide && (
        <div className="fixed inset-0 z-60 flex flex-col bg-black/90 p-4 backdrop-blur-sm" onClick={() => setIsZoomed(false)}>
          <div className="flex items-center justify-between pb-3 text-white">
            <span className="text-sm font-semibold">{activeSlide.label} ({activeSlide.aspectRatio})</span>
            <button type="button" onClick={() => setIsZoomed(false)} className="rounded-lg bg-white/10 p-2 text-white hover:bg-white/20" aria-label="Close full view">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center overflow-hidden">
            <img src={activeSlide.imageUrl} alt="" className="max-h-full max-w-full rounded-[4px] border border-gray-200 bg-white object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
          </div>
        </div>
      )}
    </div>
  );
};
