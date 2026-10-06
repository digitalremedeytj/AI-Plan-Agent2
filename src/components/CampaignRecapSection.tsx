import React from "react";
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3, Brush, CalendarClock, Check, CircleDollarSign, ClipboardCheck,
  Download, Equal, FileText, Gauge, History, Lightbulb, Loader2, Minus, Plus, Ruler, Sparkles, Target, ThumbsDown,
  ThumbsUp, Tv, Undo2, Users, Wand2, X, type LucideIcon,
} from "lucide-react";
import type { ProposalChange } from "../assistant/operations";
import {
  fundingSummary, projectChannel, projectPlan,
  type CampaignRecap, type EvidenceStrength, type RecapBenchmarks, type RecapCampaign, type RecapChangeLine, type RecapRecommendation, type RecommendationArea,
} from "../performance/recap";
import type { FindingKind } from "../performance/review";
import { SectionVisibilityButton } from "./SectionVisibilityButton";
import {
  KIND_LABELS, PROJECTION_FOOTNOTE, STRENGTH_HINTS, projectsCtv, STRENGTH_LABELS, approxRange, campaignSubtitle, compactMoney, fundingText,
  cpaText, flightText, percentText, shareText, singular, tileText,
} from "./recapFormat";

// The client-facing Campaign Recap: their past campaign at a glance, what worked and what didn't,
// and what we recommend, each recommendation with its evidence, the exact change to the plan, how
// strong the evidence is and how we will measure it. Built on the server from the linked
// campaigns (src/performance/recap); this only draws it. Planner controls (rebuild, apply,
// remove, export) never reach a share link.

export const AREA_ICONS: Record<RecommendationArea, LucideIcon> = {
  channel: Tv,
  publisher: Tv,
  audience: Users,
  creative: Brush,
  budget: CircleDollarSign,
  timing: CalendarClock,
  measurement: Ruler,
};

const KIND_STYLES: Record<FindingKind, { icon: LucideIcon; text: string; bg: string; border: string }> = {
  worked: { icon: ThumbsUp, text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-100" },
  didnt: { icon: ThumbsDown, text: "text-rose-700", bg: "bg-rose-50", border: "border-rose-100" },
  watch: { icon: Lightbulb, text: "text-amber-700", bg: "bg-amber-50", border: "border-amber-100" },
};

const STRENGTH_STYLES: Record<EvidenceStrength, string> = {
  strong: "bg-emerald-50 text-emerald-700 border-emerald-100",
  directional: "bg-indigo-50 text-indigo-700 border-indigo-100",
  test: "bg-amber-50 text-amber-800 border-amber-100",
};

export interface PlanChannel {
  channelId: string;
  channelName: string;
  allocationPercent: number;
  allocationDollars: number;
}

export interface RecapPlannerControls {
  /** Linked past campaigns exist, so a recap can be built. */
  canBuild: boolean;
  /** Why building is not possible right now (unsaved edits), shown instead of running. */
  blockedReason: string | null;
  building: boolean;
  error: string | null;
  /** What the last build left out, and why. */
  dropped: string[];
  onBuild: () => void;
  /** Dry-runs a recommendation's change so the planner sees exactly what Apply saves. */
  onPreview: (rec: RecapRecommendation) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onUndo: () => void;
  pending: { recId: string; changes: ProposalChange[]; rejected: string[]; loading: boolean; applying: boolean } | null;
  /** The recommendation whose apply can still be undone. */
  undoableId: string | null;
  onAskScout: (rec: RecapRecommendation) => void;
  onRemove: (kind: "card" | "recommendation", id: string) => void;
  /** Index into the slide list, or "pdf" for every slide. */
  onExport: (target: number | "pdf") => void;
  exporting: boolean;
  slideTitles: string[];
}

interface Props {
  recap: CampaignRecap | undefined;
  /** The plan's channels as they stand, for applied changes and projections. */
  planChannels: PlanChannel[];
  isHidden: boolean;
  isShareView: boolean;
  onToggle: (sectionKey: string, inactive: boolean) => void;
  planner?: RecapPlannerControls;
}

const findingKey = (campaignId: string, findingId: string) => `${campaignId}:${findingId}`;

export function CampaignRecapSection({ recap, planChannels, isHidden, isShareView, onToggle, planner }: Props) {
  const controls = isShareView ? undefined : planner;
  // Hovering a finding lights up the recommendations built on it, and the other way round.
  const [linked, setLinked] = React.useState<string[]>([]);
  if (!recap?.campaigns?.length) {
    if (!controls?.canBuild) return null;
    return <BuildPrompt controls={controls} />;
  }
  if (isShareView && isHidden) return null;
  const several = recap.campaigns.length > 1;
  const only = recap.campaigns[0];

  return (
    <div className={`group relative rounded-2xl border shadow-xs overflow-hidden transition-all duration-200 ${
      isHidden ? "border-dashed border-slate-300 bg-slate-100/70 opacity-60 hover:opacity-90" : "border-slate-100 bg-white hover:border-slate-200"
    }`}>
      <div className="p-4 md:p-6 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
            <History className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-indigo-600 text-[11px] font-bold uppercase tracking-wider">Campaign Recap</div>
            <h3 className="text-base font-display font-bold text-slate-800">
              {several ? "What your recent campaigns showed us" : "What your last campaign showed us"}
            </h3>
            {!several && <p className="text-[11px] text-slate-500">{campaignSubtitle(only)}</p>}
          </div>
        </div>
        {controls && (
          <div className="flex items-center gap-2">
            <ExportMenu controls={controls} />
            <button
              type="button"
              onClick={controls.onBuild}
              disabled={controls.building}
              title={controls.blockedReason ?? "Rebuild from the campaign data and review"}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer disabled:opacity-60"
            >
              {controls.building ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
              {controls.building ? "Rebuilding…" : "Rebuild"}
            </button>
            <SectionVisibilityButton sectionKey="campaignRecap" isInactive={isHidden} onToggle={onToggle} />
          </div>
        )}
      </div>

      {controls && <PlannerMessages controls={controls} />}

      <div className="px-4 md:px-6 pb-6 space-y-6">
        {recap.campaigns.map((campaign) => (
          <CampaignBlock
            key={campaign.campaignId}
            campaign={campaign}
            showName={several}
            linked={linked}
            onHover={setLinked}
            recommendations={recap.recommendations}
            onRemove={controls ? (id) => controls.onRemove("card", id) : undefined}
          />
        ))}
        {recap.recommendations.length > 0 && (
          <Recommendations recap={recap} planChannels={planChannels} controls={controls} linked={linked} onHover={setLinked} />
        )}
        <PlanChangeStrip recap={recap} planChannels={planChannels} />
      </div>
    </div>
  );
}

function BuildPrompt({ controls }: { controls: RecapPlannerControls }) {
  return (
    <div className="rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/40 p-4 md:p-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center text-indigo-600 shrink-0 border border-indigo-100">
          <History className="w-4 h-4" />
        </div>
        <div>
          <div className="text-indigo-600 text-[11px] font-bold uppercase tracking-wider">Campaign Recap</div>
          <p className="text-sm text-slate-700">Show the client what their past campaign showed: results at a glance, what worked, what didn't and what we recommend.</p>
          {controls.error && <p className="text-xs text-rose-600 mt-1">{controls.error}</p>}
        </div>
      </div>
      <button
        type="button"
        onClick={controls.onBuild}
        disabled={controls.building}
        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs cursor-pointer disabled:opacity-70"
      >
        {controls.building ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
        {controls.building ? "Building the recap…" : "Build recap"}
      </button>
    </div>
  );
}

function PlannerMessages({ controls }: { controls: RecapPlannerControls }) {
  if (!controls.error && controls.dropped.length === 0) return null;
  return (
    <div className="px-4 md:px-6 pb-3 space-y-1">
      {controls.error && <p className="flex items-start gap-1.5 text-xs text-rose-700"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{controls.error}</p>}
      {controls.dropped.length > 0 && (
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer">Only you can see this: {controls.dropped.length} item{controls.dropped.length === 1 ? " was" : "s were"} left out of the recap</summary>
          <ul className="mt-1 ml-4 list-disc space-y-0.5">{controls.dropped.map((d, i) => <li key={i}>{d}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

function ExportMenu({ controls }: { controls: RecapPlannerControls }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const pick = (target: number | "pdf") => { setOpen(false); controls.onExport(target); };
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={controls.exporting}
        title="Export as 16:9 slides"
        className="inline-flex items-center justify-center w-8 h-8 text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer disabled:opacity-60"
      >
        {controls.exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-72 rounded-xl border border-slate-200 bg-white shadow-lg z-30 py-1">
          <button type="button" onClick={() => pick("pdf")} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
            <FileText className="w-3.5 h-3.5 text-indigo-600" /> All slides (PDF)
          </button>
          <div className="my-1 border-t border-slate-100" />
          {controls.slideTitles.map((title, i) => (
            <button key={i} type="button" onClick={() => pick(i)} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50 cursor-pointer text-left">
              <BarChart3 className="w-3.5 h-3.5 text-slate-400 shrink-0" /> Slide {i + 1}: {title} (PNG)
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CampaignBlock({ campaign, showName, linked, onHover, recommendations, onRemove }: {
  campaign: RecapCampaign;
  showName: boolean;
  linked: string[];
  onHover: (keys: string[]) => void;
  recommendations: RecapRecommendation[];
  onRemove?: (id: string) => void;
}) {
  const kinds = (["worked", "didnt", "watch"] as FindingKind[]).filter((k) => campaign.cards.some((c) => c.kind === k));
  return (
    <div className="space-y-4">
      {showName && (
        <div className="flex items-baseline gap-2 border-b border-slate-100 pb-2">
          <h4 className="text-sm font-bold text-slate-800">{campaign.name}</h4>
          <span className="text-[11px] text-slate-500">{flightText(campaign.flight)}</span>
        </div>
      )}
      {campaign.summary && <p className="text-sm text-slate-600 leading-relaxed max-w-3xl">{campaign.summary}.</p>}

      {campaign.tiles.length > 0 && (
        <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
          {campaign.tiles.map((tile) => {
            const { value, label } = tileText(tile, campaign);
            return (
              <div key={tile.metric} className="rounded-xl bg-slate-50 px-3.5 py-3">
                <div className="text-xl font-display font-bold text-slate-800 leading-tight">{value}</div>
                <div className="text-[11px] font-medium text-slate-500 mt-0.5">{label}</div>
              </div>
            );
          })}
        </div>
      )}

      <div className={`grid gap-4 ${campaign.mix && kinds.length ? "lg:grid-cols-5" : ""}`}>
        {campaign.mix && (
          <div className="lg:col-span-3 rounded-xl border border-slate-100 p-4">
            <div className="text-indigo-600 text-[11px] font-bold uppercase tracking-wider">Where results came from</div>
            <p className="text-sm font-bold text-slate-800 mb-3">Share of spend vs share of {campaign.conversionLabel.toLowerCase()} by {campaign.mix.dimension}</p>
            <MixChart campaign={campaign} />
            {campaign.mixNote && <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">{campaign.mixNote}</p>}
          </div>
        )}
        {kinds.length > 0 && (
          <div className={`${campaign.mix ? "lg:col-span-2" : ""} space-y-3`}>
            {kinds.map((kind) => {
              const style = KIND_STYLES[kind];
              const Icon = style.icon;
              return (
                <div key={kind}>
                  <div className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider mb-1.5 ${style.text}`}>
                    <Icon className="w-3.5 h-3.5" /> {KIND_LABELS[kind]}
                  </div>
                  <div className="space-y-1.5">
                    {campaign.cards.filter((c) => c.kind === kind).map((card) => {
                      const key = findingKey(campaign.campaignId, card.findingId);
                      const isLinked = linked.includes(key);
                      const backs = recommendations.filter((r) => r.findings?.some((f) => findingKey(f.campaignId, f.findingId) === key)).length;
                      return (
                        <div
                          key={card.id}
                          onMouseEnter={() => onHover([key])}
                          onMouseLeave={() => onHover([])}
                          className={`group/card relative rounded-lg border ${style.border} ${style.bg} px-3 py-2 transition-shadow ${isLinked ? "ring-2 ring-indigo-400 shadow-sm" : ""}`}
                        >
                          <p className="text-sm font-semibold text-slate-800 leading-snug pr-5">{card.headline}</p>
                          <p className="text-xs text-slate-600 mt-0.5">{card.stat}</p>
                          {backs > 0 && <p className="text-[10px] font-semibold text-indigo-600 mt-1">Behind {backs} recommendation{backs === 1 ? "" : "s"}</p>}
                          {onRemove && <RemoveButton label="Remove this finding" onClick={() => onRemove(card.id)} className="group-hover/card:opacity-100" />}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function MixChart({ campaign }: { campaign: RecapCampaign }) {
  const rows = campaign.mix?.rows ?? [];
  const max = Math.max(0.01, ...rows.flatMap((r) => [r.spendShare, r.conversionShare]));
  return (
    <div>
      <div className="flex items-center gap-4 text-[11px] text-slate-500 mb-2">
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-slate-300" /> Spend</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-indigo-600" /> {campaign.conversionLabel}</span>
        <span className="ml-auto font-semibold">CPA</span>
      </div>
      <div className="space-y-2.5">
        {rows.map((row) => (
          <div key={row.name} className="grid grid-cols-[minmax(0,9rem)_1fr_4.5rem] gap-3 items-center">
            <div className="text-xs font-semibold text-slate-700 truncate" title={row.name}>{row.name}</div>
            <div className="space-y-1">
              <Bar share={row.spendShare} max={max} className="bg-slate-300" />
              <Bar share={row.conversionShare} max={max} className="bg-indigo-600" />
            </div>
            <div className="text-right">
              <div className="text-xs font-bold text-slate-800">{cpaText(row.cpa)}</div>
              {row.lowSample && <div className="text-[10px] text-amber-700">small sample</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Bar({ share, max, className }: { share: number; max: number; className: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full ${className}`} style={{ width: `${Math.max(1, (share / max) * 100)}%` }} />
      </div>
      <span className="w-9 text-right text-[11px] font-medium text-slate-500 tabular-nums">{shareText(share)}</span>
    </div>
  );
}

/**
 * A change line as the plan stands. Applied: the plan's current value for that channel (it may
 * have been edited since). Proposed: the value the dry run produced.
 */
export function lineValue(line: RecapChangeLine, applied: boolean, planChannels: PlanChannel[]): { percent: number; budget: number } | null {
  if (line.kind !== "allocation" && line.kind !== "channel_added") return null;
  const current = applied ? planChannels.find((c) => c.channelId === line.channelId) : undefined;
  return current ? { percent: current.allocationPercent, budget: current.allocationDollars } : { percent: line.percent, budget: line.budget };
}

/** The lines the recommendation chose; the automatic rebalance is summarised separately. */
export const decisionLines = (rec: RecapRecommendation) => (rec.changes ?? []).filter((l) => !(l.kind === "allocation" && l.role === "funding"));

/** What the recommendation's growing channels would buy at last campaign's costs. Not for a test. */
export function recommendationProjection(rec: RecapRecommendation, benchmarks: RecapBenchmarks | null | undefined, planChannels: PlanChannel[]) {
  if (rec.strength === "test" || rec.needsReview) return null;
  const applied = Boolean(rec.appliedAt);
  for (const line of decisionLines(rec)) {
    if (line.kind === "channel_added" || (line.kind === "allocation" && line.direction === "up")) {
      const value = lineValue(line, applied, planChannels);
      const projection = value ? projectChannel(benchmarks, line.channelId, value.budget) : null;
      if (projection) return { channelName: line.channelName, ...projection };
    }
  }
  return null;
}

function Recommendations({ recap, planChannels, controls, linked, onHover }: {
  recap: CampaignRecap;
  planChannels: PlanChannel[];
  controls?: RecapPlannerControls;
  linked: string[];
  onHover: (keys: string[]) => void;
}) {
  const label = recap.benchmarks?.conversionLabel ?? recap.campaigns[0]?.conversionLabel ?? "conversions";
  const projected = recap.recommendations.map((r) => recommendationProjection(r, recap.benchmarks, planChannels)).filter(Boolean) as Array<{ channelName: string }>;
  return (
    <div>
      <div className="flex items-center gap-1.5 text-indigo-600 text-[11px] font-bold uppercase tracking-wider mb-2">
        <Target className="w-3.5 h-3.5" /> Our recommendations
      </div>
      <div className="grid gap-3">
        {recap.recommendations.map((rec) => {
          const keys = (rec.findings ?? []).map((f) => findingKey(f.campaignId, f.findingId));
          return (
            <RecommendationCard
              key={rec.id}
              rec={rec}
              label={label}
              recap={recap}
              planChannels={planChannels}
              controls={controls}
              highlighted={keys.some((k) => linked.includes(k))}
              onHover={(on) => onHover(on ? keys : [])}
            />
          );
        })}
      </div>
      {projected.length > 0 && <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">{PROJECTION_FOOTNOTE(label, projectsCtv(projected.map((p) => p.channelName)))}</p>}
    </div>
  );
}

function RecommendationCard({ rec, label, recap, planChannels, controls, highlighted, onHover }: {
  rec: RecapRecommendation;
  label: string;
  recap: CampaignRecap;
  planChannels: PlanChannel[];
  controls?: RecapPlannerControls;
  highlighted: boolean;
  onHover: (on: boolean) => void;
}) {
  const Icon = AREA_ICONS[rec.area] ?? Gauge;
  const applied = Boolean(rec.appliedAt);
  const kind = rec.kind ?? "change";
  const projection = recommendationProjection(rec, recap.benchmarks, planChannels);
  const pending = controls?.pending?.recId === rec.id ? controls.pending : null;
  return (
    <div
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={`group/rec relative rounded-xl border bg-white p-4 transition-shadow ${applied ? "border-emerald-200" : "border-slate-200"} ${highlighted ? "ring-2 ring-indigo-400 shadow-sm" : ""}`}
    >
      <div className="flex items-start gap-3 pr-5">
        <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-800 leading-snug">{rec.title}</p>
          <p className="text-xs text-slate-600 leading-relaxed mt-0.5">{rec.detail}.</p>
        </div>
        {rec.strength && (
          <span title={STRENGTH_HINTS[rec.strength]} className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${STRENGTH_STYLES[rec.strength]}`}>
            {STRENGTH_LABELS[rec.strength]}
          </span>
        )}
      </div>

      <div className="grid gap-2.5 md:grid-cols-2 mt-3 md:pl-11">
        {rec.evidence && <EvidenceBox rec={rec} />}
        {!(rec.needsReview && !controls) && <ChangeBox rec={rec} kind={kind} applied={applied} planChannels={planChannels} />}
      </div>

      {(rec.measure || projection) && (
        <div className="mt-3 pt-2.5 border-t border-slate-100 space-y-1 md:ml-11">
          {projection && (
            <p className="flex items-start gap-1.5 text-xs text-slate-700">
              <BarChart3 className="w-3.5 h-3.5 shrink-0 mt-0.5 text-indigo-500" />
              <span><span className="font-bold">{approxRange(projection.low, projection.high)} {label.toLowerCase()}</span> from {projection.channelName} at last campaign's costs ({compactMoney(Math.min(projection.cpa, projection.averageCpa))}–{compactMoney(Math.max(projection.cpa, projection.averageCpa))} per {singular(label)})</span>
            </p>
          )}
          {rec.measure && (
            <p className="flex items-start gap-1.5 text-xs text-slate-500">
              <Target className="w-3.5 h-3.5 shrink-0 mt-0.5" /> <span>We'll measure: {rec.measure}</span>
            </p>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 md:ml-11">
        {applied && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
            <Check className="w-3 h-3" /> In this plan
          </span>
        )}
        {!applied && kind === "change" && (rec.changes?.length ?? 0) > 0 && (
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Proposed</span>
        )}
        {controls && <PlannerActions rec={rec} kind={kind} applied={applied} controls={controls} pending={pending} />}
      </div>

      {pending && <PendingPreview pending={pending} controls={controls!} />}
      {controls && <RemoveButton label="Remove this recommendation" onClick={() => controls.onRemove("recommendation", rec.id)} className="group-hover/rec:opacity-100" />}
    </div>
  );
}

function EvidenceBox({ rec }: { rec: RecapRecommendation }) {
  const evidence = rec.evidence!;
  const max = Math.max(...evidence.bars.map((b) => b.cpa), 0.01);
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2.5">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">The evidence{evidence.metricLabel ? ` · ${evidence.metricLabel.toLowerCase()}` : ""}</div>
      {evidence.bars.length > 0 && (
        <div className="space-y-1.5 mb-1.5">
          {evidence.bars.map((bar) => (
            <div key={bar.name} className="grid grid-cols-[minmax(0,6.5rem)_1fr_3.75rem] gap-2 items-center">
              <span className={`text-[11px] truncate ${bar.isAverage ? "text-slate-500" : "font-semibold text-slate-700"}`} title={bar.name}>{bar.name}</span>
              <div className="h-1.5 rounded-full bg-slate-200/70 overflow-hidden">
                <div className={`h-full rounded-full ${bar.isAverage ? "bg-slate-400" : "bg-indigo-600"}`} style={{ width: `${Math.max(2, (bar.cpa / max) * 100)}%` }} />
              </div>
              <span className="text-[11px] font-bold text-slate-800 text-right tabular-nums">{compactMoney(bar.cpa)}</span>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-slate-500 leading-snug">{evidence.note}</p>
    </div>
  );
}

function ChangeBox({ rec, kind, applied, planChannels }: { rec: RecapRecommendation; kind: string; applied: boolean; planChannels: PlanChannel[] }) {
  const lines = decisionLines(rec);
  const funding = fundingSummary(rec.changes);
  const title = applied ? "In this plan" : kind === "keep" ? "In this plan" : kind === "execution" ? "How we'll run it" : "The change";
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2.5">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{title}</div>
      {rec.needsReview ? (
        <p className="flex items-start gap-1.5 text-xs text-amber-800"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> Only you can see this: the plan has changed and this no longer fits. Work out a new change with ScoutAI.</p>
      ) : lines.length > 0 ? (
        <div className="space-y-1">
          {lines.map((line, i) => <ChangeLine key={i} line={line} applied={applied} planChannels={planChannels} />)}
          {funding && <p className="text-[11px] text-slate-500 pt-0.5">{fundingText(funding)}</p>}
        </div>
      ) : kind === "keep" ? (
        <p className="flex items-center gap-1.5 text-xs text-slate-700"><Equal className="w-3.5 h-3.5 text-slate-400" /> Kept as it is, on purpose</p>
      ) : kind === "execution" ? (
        <p className="flex items-center gap-1.5 text-xs text-slate-700"><ClipboardCheck className="w-3.5 h-3.5 text-slate-400" /> Part of how we run the campaign</p>
      ) : (
        <p className="text-xs text-slate-500">Worked into the plan with your team</p>
      )}
    </div>
  );
}

function ChangeLine({ line, applied, planChannels }: { line: RecapChangeLine; applied: boolean; planChannels: PlanChannel[] }) {
  const value = lineValue(line, applied, planChannels);
  const icon = line.kind === "allocation"
    ? line.direction === "up" ? <ArrowUpRight className="w-3.5 h-3.5 text-emerald-600" /> : <ArrowDownRight className="w-3.5 h-3.5 text-rose-500" />
    : line.kind === "channel_added" || line.kind === "publisher_added" ? <Plus className="w-3.5 h-3.5 text-emerald-600" /> : <Minus className="w-3.5 h-3.5 text-rose-500" />;
  const name = "channelName" in line ? line.channelName : line.name;
  const right = value
    ? `${percentText(value.percent)} · ${compactMoney(value.budget)}`
    : line.kind === "publisher_added" ? "Added" : line.kind === "publisher_removed" || line.kind === "channel_removed" ? "Removed" : "";
  return (
    <div className="flex items-center gap-1.5 text-xs">
      {icon}
      <span className="flex-1 min-w-0 truncate text-slate-700" title={name}>{name}</span>
      <span className="font-bold text-slate-800 tabular-nums whitespace-nowrap">{right}</span>
    </div>
  );
}

function PlannerActions({ rec, kind, applied, controls, pending }: { rec: RecapRecommendation; kind: string; applied: boolean; controls: RecapPlannerControls; pending: RecapPlannerControls["pending"] }) {
  const link = "inline-flex items-center gap-1 text-[11px] font-bold cursor-pointer disabled:opacity-60";
  if (applied) {
    return controls.undoableId === rec.id
      ? <button type="button" onClick={controls.onUndo} className={`${link} text-slate-500 hover:text-slate-800`}><Undo2 className="w-3 h-3" /> Undo</button>
      : null;
  }
  if (pending) return null;
  const hasChange = (rec.ops?.length ?? 0) > 0 && !rec.needsReview;
  return (
    <>
      {(hasChange || kind !== "change") && (
        <button type="button" onClick={() => controls.onPreview(rec)} className={`${link} text-white bg-indigo-600 hover:bg-indigo-700 rounded-md px-2 py-1`}>
          <Check className="w-3 h-3" /> {hasChange ? "Apply to plan" : "Mark as in this plan"}
        </button>
      )}
      {kind === "change" && (
        <button type="button" onClick={() => controls.onAskScout(rec)} className={`${link} text-indigo-700 hover:text-indigo-900`}>
          <Sparkles className="w-3 h-3" /> {hasChange ? "Adjust with ScoutAI" : "Work it out with ScoutAI"}
        </button>
      )}
    </>
  );
}

function PendingPreview({ pending, controls }: { pending: NonNullable<RecapPlannerControls["pending"]>; controls: RecapPlannerControls }) {
  return (
    <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50/50 p-3">
      {pending.loading ? (
        <p className="flex items-center gap-1.5 text-xs text-slate-600"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking the change against the plan…</p>
      ) : (
        <>
          <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 mb-1.5">Apply saves these changes</div>
          <ul className="space-y-1">
            {pending.changes.map((c, i) => (
              <li key={i} className="text-xs text-slate-700 flex flex-wrap gap-x-1.5">
                <span className="font-semibold">{c.label}:</span>
                <span className="text-slate-400 line-through">{c.before}</span>
                <span className="font-semibold text-slate-800">{c.after}</span>
              </li>
            ))}
          </ul>
          {pending.rejected.length > 0 && <p className="text-[11px] text-rose-700 mt-1.5">Can't apply: {pending.rejected.join("; ")}</p>}
          <div className="flex gap-2 mt-2.5">
            <button
              type="button"
              onClick={controls.onConfirm}
              disabled={pending.applying || pending.rejected.length > 0 || pending.changes.length === 0}
              className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-indigo-700 cursor-pointer disabled:opacity-60"
            >
              {pending.applying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Apply & save
            </button>
            <button type="button" onClick={controls.onCancel} className="rounded-md px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-white cursor-pointer">Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

/** The plan after the recap's applied recommendations, with what each moved and what it would buy. */
function PlanChangeStrip({ recap, planChannels }: { recap: CampaignRecap; planChannels: PlanChannel[] }) {
  const applied = recap.recommendations.filter((r) => r.appliedAt && (r.changes?.length ?? 0) > 0);
  if (!applied.length || !planChannels.length) return null;
  const moved = new Map<string, "up" | "down" | "added">();
  const publishers: Array<{ name: string; added: boolean }> = [];
  for (const rec of applied) {
    for (const line of decisionLines(rec)) {
      if (line.kind === "allocation") moved.set(line.channelId, line.direction);
      if (line.kind === "channel_added") moved.set(line.channelId, "added");
      if (line.kind === "publisher_added" || line.kind === "publisher_removed") publishers.push({ name: line.name, added: line.kind === "publisher_added" });
    }
  }
  const label = recap.benchmarks?.conversionLabel ?? recap.campaigns[0]?.conversionLabel ?? "conversions";
  const plan = projectPlan(recap.benchmarks, planChannels);
  const max = Math.max(...planChannels.map((c) => c.allocationPercent), 1);
  const channels = [...planChannels].sort((a, z) => z.allocationPercent - a.allocationPercent);
  return (
    <div className="rounded-xl border border-slate-100 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <div>
          <div className="text-indigo-600 text-[11px] font-bold uppercase tracking-wider">How the recap changed this plan</div>
          <p className="text-sm font-bold text-slate-800">Media mix after our recommendations</p>
        </div>
        {plan && (
          <div className="text-right">
            <div className="text-lg font-display font-bold text-slate-800 leading-tight">{approxRange(plan.low, plan.high)} {label.toLowerCase()}</div>
            <div className="text-[11px] text-slate-500">projected at last campaign's costs</div>
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        {channels.map((c) => {
          const direction = moved.get(c.channelId);
          const projection = projectChannel(recap.benchmarks, c.channelId, c.allocationDollars);
          return (
            <div key={c.channelId} className="grid grid-cols-[minmax(0,13rem)_1fr_7.5rem_5.5rem] gap-3 items-center">
              <span className={`text-xs truncate flex items-center gap-1 ${direction ? "font-bold text-slate-800" : "text-slate-600"}`} title={c.channelName}>
                {direction === "up" && <ArrowUpRight className="w-3.5 h-3.5 text-emerald-600 shrink-0" />}
                {direction === "down" && <ArrowDownRight className="w-3.5 h-3.5 text-rose-500 shrink-0" />}
                {direction === "added" && <Plus className="w-3.5 h-3.5 text-emerald-600 shrink-0" />}
                {c.channelName}
              </span>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className={`h-full rounded-full ${direction === "up" || direction === "added" ? "bg-emerald-500" : direction === "down" ? "bg-rose-300" : "bg-slate-300"}`} style={{ width: `${(c.allocationPercent / max) * 100}%` }} />
              </div>
              <span className="text-xs font-semibold text-slate-700 text-right tabular-nums">{percentText(c.allocationPercent)} · {compactMoney(c.allocationDollars)}</span>
              <span className="text-[11px] text-slate-500 text-right tabular-nums">{projection ? approxRange(projection.low, projection.high) : "–"}</span>
            </div>
          );
        })}
      </div>
      {publishers.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {publishers.map((p) => (
            <span key={p.name} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${p.added ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-rose-100 bg-rose-50 text-rose-700"}`}>
              {p.added ? <Plus className="w-3 h-3" /> : <Minus className="w-3 h-3" />} {p.name}
            </span>
          ))}
        </div>
      )}
      {plan && (
        <p className="text-[10px] text-slate-400 mt-3 leading-relaxed">
          Right-hand column: projected {label.toLowerCase()}. Covers {shareText(plan.coveredShare)} of the budget. {PROJECTION_FOOTNOTE(label, projectsCtv(planChannels.filter((c) => plan.channels.some((p) => p.channelId === c.channelId)).map((c) => c.channelName)))}
        </p>
      )}
    </div>
  );
}

function RemoveButton({ label, onClick, className }: { label: string; onClick: () => void; className: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`absolute top-2 right-2 w-5 h-5 rounded-md flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-white opacity-0 transition-opacity cursor-pointer ${className}`}
    >
      <X className="w-3.5 h-3.5" />
    </button>
  );
}
