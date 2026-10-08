// The Campaign Recap: the client-facing overview of their past campaign, frozen into the plan so
// the share link and slides can show it without the campaign library. Figures come from the
// deterministic analysis (src/performance/campaign) and nothing else; the model writes only short
// headlines, a summary and recommendations, and each is checked before it is kept:
// - every figure it quotes must be in that campaign's data (figureCheck);
// - no internal measures or trafficking terms (PM, ad group) and no cause the data cannot show;
// - a recommendation's own text carries no figures; its evidence bars, its exact plan change and
//   any projection are computed in code, from the campaign data and a dry run of the change.
// Which blocks appear depends on what was uploaded: a campaign with only a media type report gets
// a scoreboard and the mix chart; one with a full export set gets everything. Everything is read
// against the campaign KPI (src/performance/recapKpi), and shortfalls are worded as opportunities.

import type { LinkedCampaign } from "../assistant/performanceContext";
import type { AssistantOp } from "../assistant/operations";
import { matchChannel, type Channel } from "./matching";
import { isMediaTypeDimension, MIN_CONVERSIONS, type BreakdownDigest, type CampaignAnalysis, type DigestRow } from "./campaign";
import { renderDigest } from "./digest";
import { extractPerformanceFigures, figureReference, unverifiedFigures, type FigureReference } from "./figureCheck";
import { findCausalClaim, type Confidence, type FindingKind } from "./review";
import { formatDay } from "./values";
import { ctvAssist, recapRankings, recapTrend, resolveRecapKpi, videoCompletionRate, withKpiMetric, type KpiValues, type RecapKpi, type RecapRanking, type RecapTrend } from "./recapKpi";

export const RECAP_SECTION = "campaignRecap";

export type RecapMetric = "spend" | "impressions" | "reach" | "conversions" | "cpa" | "roas" | "vcr";

export interface RecapTile {
  metric: RecapMetric;
  value: number;
}

export interface RecapMixRow {
  name: string;
  spend: number;
  spendShare: number;
  conversions: number;
  conversionShare: number;
  cpa: number | null;
  revenue?: number;
  roas?: number | null;
  /** Under 30 conversions: shown, but marked as a small sample. */
  lowSample: boolean;
  isCtv: boolean;
}

export interface RecapMix {
  /** The report it came from, in the client's words ("media type", "audience"). */
  dimension: string;
  rows: RecapMixRow[];
}

export interface RecapCard {
  id: string;
  findingId: string;
  kind: FindingKind;
  headline: string;
  /** One short, checked figure that backs the headline ("42% of checkouts from 9% of spend"). */
  stat: string;
  /** The finding's area ("media type", "audience"), for its icon. */
  area?: string;
}

/** The detail blocks a planner can leave out of the client's view. */
export const RECAP_BLOCKS = ["mix", "trend", "publisher", "audience", "creative"] as const;
export type RecapBlock = (typeof RECAP_BLOCKS)[number];

export interface RecapCampaign {
  campaignId: string;
  name: string;
  /** ISO days, inclusive. */
  flight: { start: string; end: string } | null;
  /** What a conversion was ("checkouts"). */
  conversionLabel: string;
  /** The review the copy was written from; a different one later means the recap is out of date. */
  reviewFingerprint: string | null;
  summary: string;
  tiles: RecapTile[];
  /** Average frequency, shown with the reach tile. */
  frequency: number | null;
  /** The KPI the recap is read against; absent on recaps built before it existed. */
  kpi?: RecapKpi | null;
  /** Every measure the KPI could be, so the planner can switch it without a rebuild. */
  kpiValues?: KpiValues;
  revenue?: number | null;
  /** The completion rate tile is CTV's own, not every video placement's. */
  vcrIsCtv?: boolean;
  trend?: RecapTrend | null;
  rankings?: RecapRanking[];
  /** Conversions from audiences retargeted after a CTV exposure. */
  ctvAssist?: { conversions: number; share: number } | null;
  /** Detail blocks the planner took out of the client's view. */
  hiddenBlocks?: RecapBlock[];
  mix: RecapMix | null;
  /** Set when the mix includes CTV and only last-touch data exists. */
  mixNote: string | null;
  cards: RecapCard[];
}

export const RECOMMENDATION_AREAS = ["channel", "publisher", "audience", "creative", "budget", "timing", "measurement"] as const;
export type RecommendationArea = (typeof RECOMMENDATION_AREAS)[number];

/** change: the plan's buy changes. keep: deliberately unchanged. execution: how it is run, not what is bought. */
export type RecommendationKind = "change" | "keep" | "execution";
/** From the review's confidence, which code already caps for thin or one-off data. */
export type EvidenceStrength = "strong" | "directional" | "test";

export interface RecapEvidenceBar {
  name: string;
  /** Cost per conversion; the ROAS multiple when the evidence's metric is "roas". */
  cpa: number;
  isAverage: boolean;
  /** Under 30 conversions or a one-off event. */
  thin: boolean;
}

export interface RecapEvidence {
  campaignId: string;
  /** What the bars measure; cost per conversion when absent. */
  metric?: "cpa" | "roas";
  /** "Cost per checkout". */
  metricLabel: string;
  /** The cited rows' cost per conversion against the campaign's average. Empty when no row was cited. */
  bars: RecapEvidenceBar[];
  /** Computed: "1,669 checkouts · 17% of checkouts from 14% of spend", or the finding's card stat. */
  note: string;
}

/**
 * A line of the exact plan change: where the media type ends up, and where it was (fromPercent,
 * fromBudget), so the client reads it as a move rather than a final figure. "decision" lines are what the recommendation chose; "funding" lines are the engine's
 * automatic rebalance of everything else, shown to the client as one summary line.
 */
export type RecapChangeLine =
  | { kind: "allocation"; channelId: string; channelName: string; percent: number; budget: number; direction: "up" | "down"; role?: "decision" | "funding"; delta?: number; fromPercent?: number; fromBudget?: number }
  | { kind: "channel_added"; channelId: string; channelName: string; percent: number; budget: number }
  | { kind: "channel_removed"; channelId: string; channelName: string }
  | { kind: "publisher_added" | "publisher_removed"; name: string };

export interface RecapRecommendation {
  id: string;
  title: string;
  detail: string;
  area: RecommendationArea;
  /** Set when the planner applied it to this plan; the client sees "In this plan". */
  appliedAt: string | null;
  kind?: RecommendationKind;
  /** The review findings it answers, so the plan can link them to their cards. */
  findings?: Array<{ campaignId: string; findingId: string }>;
  strength?: EvidenceStrength;
  evidence?: RecapEvidence | null;
  /** How the client will know it worked. */
  measure?: string;
  /** What the model chose to change; `ops` adds the holds that keep protected media types still. */
  baseOps?: AssistantOp[];
  /** The plan operations that carry it out, re-checked by a dry run on every save. */
  ops?: AssistantOp[];
  changes?: RecapChangeLine[];
  /** The media types the recommendation itself moves, as opposed to the automatic rebalance. */
  decisionChannelIds?: string[];
  /** For "keep": the media types it keeps as they are. Other recommendations may not move them. */
  keepChannelIds?: string[];
  /** Its change no longer applies to the plan as it stands; the planner works out a new one. */
  needsReview?: boolean;
}

/** Last campaign's cost per conversion on each plan channel it maps to, for projections. */
export interface ChannelBenchmark {
  channelId: string;
  channelName: string;
  /** The report rows behind it ("Pre-Roll/Mid-Roll"). */
  reportRows: string[];
  spend: number;
  conversions: number;
  impressions: number;
  cpa: number;
  /** Fewer than 30 conversions, or retargeting, whose results do not scale with budget. */
  excluded: "low-sample" | "retargeting" | null;
}

export interface RecapBenchmarks {
  campaignId: string;
  campaignName: string;
  conversionLabel: string;
  /** The campaign's overall cost per conversion: the other end of every projection range. */
  averageCpa?: number | null;
  channels: ChannelBenchmark[];
}

export interface CampaignRecap {
  builtAt: string;
  builtBy: string;
  campaigns: RecapCampaign[];
  recommendations: RecapRecommendation[];
  benchmarks?: RecapBenchmarks | null;
}

const MAX_MIX_ROWS = 6;
const MAX_CARDS = 4;
const MAX_RECOMMENDATIONS = 5;
const MAX_OPS = 6;
/** Digital Remedy's own measures and trafficking terms, which mean nothing to a client. */
/** Words that read as a verdict on the campaign rather than a way forward. */
const BLUNT = /\b(miss(ed|es)?|fail(ed|s|ure)?|underperform\w*|poor(ly)?|disappoint\w*|wasted?|bad|worst)\b/i;
const INTERNAL_TERMS = /\bPMs?\b|performance multiplier|\bad ?groups?\b|\bIreach\b|\bfingerprint\b|\bchannelId\b/i;
const CTV = /\b(ott|ctv|connected\s*tv|streaming\s*tv)\b/i;
/** What a recommendation may change. Text, personas and sections stay the planner's. */
export const RECOMMENDATION_OP_TYPES = ["set_allocation", "add_channel", "remove_channel", "add_ctv_publisher", "remove_ctv_publisher"] as const;

// ---- Figures: code only ----

function mixBreakdown(analysis: CampaignAnalysis): BreakdownDigest | null {
  const usable = analysis.breakdowns.filter((b) => b.role !== "reference" && b.rows.length >= 2 && (b.totals.spend ?? 0) > 0 && (b.totals.conversions ?? 0) > 0);
  return usable.find((b) => isMediaTypeDimension(b.dimension))
    // Without a media type report, the shortest cut reads best as a chart (audience before creative).
    ?? [...usable].sort((a, z) => a.rows.length - z.rows.length)[0]
    ?? null;
}

const mixRow = (name: string, rows: DigestRow[], b: BreakdownDigest): RecapMixRow => {
  const spend = rows.reduce((s, r) => s + (r.metrics.spend ?? 0), 0);
  const conversions = rows.reduce((s, r) => s + (r.metrics.conversions ?? 0), 0);
  const revenue = rows.reduce((s, r) => s + (r.metrics.revenue ?? 0), 0);
  return {
    name,
    spend,
    spendShare: b.totals.spend ? spend / b.totals.spend : 0,
    conversions,
    conversionShare: b.totals.conversions ? conversions / b.totals.conversions : 0,
    cpa: spend > 0 && conversions > 0 ? spend / conversions : null,
    revenue,
    roas: spend > 0 && revenue > 0 ? revenue / spend : null,
    lowSample: rows.length === 1 && rows[0].flags.includes("low-sample"),
    isCtv: rows.length === 1 && CTV.test(name),
  };
};

export function recapMix(analysis: CampaignAnalysis): RecapMix | null {
  const b = mixBreakdown(analysis);
  if (!b) return null;
  const bySpend = [...b.rows].sort((a, z) => (z.metrics.spend ?? 0) - (a.metrics.spend ?? 0));
  const shown = bySpend.length > MAX_MIX_ROWS ? bySpend.slice(0, MAX_MIX_ROWS - 1) : bySpend;
  const rest = bySpend.slice(shown.length);
  const rows = shown.map((r) => mixRow(r.name, [r], b));
  if (rest.length) rows.push(mixRow(`${rest.length} others`, rest, b));
  return { dimension: b.dimension.replace(/mediatype/i, "media type").toLowerCase(), rows };
}

export function recapTiles(analysis: CampaignAnalysis): { tiles: RecapTile[]; frequency: number | null } {
  const t = analysis.totals;
  const tiles: RecapTile[] = [];
  const add = (metric: RecapMetric, value: number | null | undefined) => {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) tiles.push({ metric, value });
  };
  add("spend", t?.spend);
  add("impressions", t?.impressions);
  add("reach", analysis.reach?.reach);
  add("conversions", t?.conversions);
  add("cpa", t?.cpa);
  if ((t?.revenue ?? 0) > 0) add("roas", t?.roas);
  add("vcr", videoCompletionRate(analysis)?.value);
  return { tiles, frequency: analysis.reach?.frequency ?? null };
}

function mixNote(analysis: CampaignAnalysis, mix: RecapMix | null): string | null {
  if (!mix?.rows.some((r) => r.isCtv)) return null;
  const allTouch = analysis.touches.some((t) => t.role !== "reference" && t.summary.attribution === "all-touch");
  return allTouch ? null : `CTV builds the audience that other media later convert, so last-touch reporting understates its share of ${analysis.conversionLabel.label}.`;
}

/** What the plan's brief says the campaign is judged on, for the recap's KPI. */
export interface RecapBriefContext {
  briefKpis?: string[];
}

export const recapKpiFor = (linked: LinkedCampaign, context: RecapBriefContext = {}) =>
  resolveRecapKpi(linked.analysis, { briefKpis: context.briefKpis, campaignGoal: linked.campaign.campaignGoal });

export function recapFigures(linked: LinkedCampaign, context: RecapBriefContext = {}): Omit<RecapCampaign, "summary" | "cards"> {
  const { analysis, campaign } = linked;
  const mix = recapMix(analysis);
  const flight = analysis.flight ?? null;
  const { kpi, values } = recapKpiFor(linked, context);
  return {
    campaignId: campaign.id,
    name: campaign.name,
    flight: flight ? { start: formatDay(flight.start), end: formatDay(flight.end) } : null,
    conversionLabel: analysis.conversionLabel.label,
    reviewFingerprint: linked.review?.fingerprint ?? null,
    ...recapTiles(analysis),
    mix,
    mixNote: mixNote(analysis, mix),
    kpi,
    kpiValues: values,
    revenue: (analysis.totals?.revenue ?? 0) > 0 ? analysis.totals!.revenue! : null,
    vcrIsCtv: videoCompletionRate(analysis)?.ctv ?? false,
    trend: recapTrend(analysis),
    rankings: recapRankings(analysis, kpi),
    ctvAssist: mix?.rows.some((r) => r.isCtv) ? ctvAssist(analysis) : null,
    hiddenBlocks: [],
  };
}

/**
 * Last campaign's media types mapped onto the plan's channels. Several report rows can be one
 * channel ("Display" and "Display Retargeting" may both be display); their counts are added.
 */
export function channelBenchmarks(linked: LinkedCampaign, channels: Channel[]): RecapBenchmarks | null {
  const b = linked.analysis.breakdowns.find((x) => x.role !== "reference" && isMediaTypeDimension(x.dimension));
  if (!b || channels.length === 0) return null;
  const byChannel = new Map<string, { channel: Channel; rows: DigestRow[] }>();
  for (const row of b.rows) {
    const channel = matchChannel(row.name, channels);
    if (!channel) continue;
    const entry = byChannel.get(channel.id) ?? { channel, rows: [] };
    entry.rows.push(row);
    byChannel.set(channel.id, entry);
  }
  const out: ChannelBenchmark[] = [];
  for (const { channel, rows } of byChannel.values()) {
    const spend = rows.reduce((s, r) => s + (r.metrics.spend ?? 0), 0);
    const conversions = rows.reduce((s, r) => s + (r.metrics.conversions ?? 0), 0);
    if (spend <= 0 || conversions <= 0) continue;
    // Retargeting converts an audience other media built; its cost does not hold as budget grows.
    const retargeting = rows.some((r) => r.flags.includes("retargeting") || r.flags.includes("fed-by-ctv"));
    out.push({
      channelId: channel.id,
      channelName: channel.name,
      reportRows: rows.map((r) => r.name),
      spend,
      conversions,
      impressions: rows.reduce((s, r) => s + (r.metrics.impressions ?? 0), 0),
      cpa: spend / conversions,
      excluded: conversions < MIN_CONVERSIONS ? "low-sample" : retargeting ? "retargeting" : null,
    });
  }
  return out.length ? { campaignId: linked.campaign.id, campaignName: linked.campaign.name, conversionLabel: linked.analysis.conversionLabel.label, averageCpa: linked.analysis.totals?.cpa ?? null, channels: out } : null;
}

export interface ChannelProjection {
  channelId: string;
  budget: number;
  /** The range runs between the channel's own past cost and the campaign's average cost. */
  low: number;
  high: number;
  cpa: number;
  averageCpa: number;
}

/**
 * A channel this far from the campaign average is not projected: its past figure says more about
 * how last-touch credit fell (cheap view-through display, upper-funnel CTV) than about what the
 * same budget will buy again.
 */
export const PROJECTION_OUTLIER_RATIO = 3;

/**
 * What a channel's budget would buy at last campaign's costs: a range from the channel's own cost
 * per conversion to the campaign average. A projection from the past, not a forecast, and callers
 * label it that way. Thin, retargeting and outlier channels project nothing.
 */
export function projectChannel(benchmarks: RecapBenchmarks | null | undefined, channelId: string, budget: number): ChannelProjection | null {
  const b = benchmarks?.channels.find((c) => c.channelId === channelId);
  const average = benchmarks?.averageCpa ?? null;
  if (!b || b.excluded || !(budget > 0) || !average || average <= 0) return null;
  const ratio = b.cpa / average;
  if (ratio > PROJECTION_OUTLIER_RATIO || ratio < 1 / PROJECTION_OUTLIER_RATIO) return null;
  const atChannel = budget / b.cpa;
  const atAverage = budget / average;
  return { channelId, budget, low: Math.min(atChannel, atAverage), high: Math.max(atChannel, atAverage), cpa: b.cpa, averageCpa: average };
}

/** The plan as a whole at last campaign's costs, over the channels that can be projected. */
export function projectPlan(benchmarks: RecapBenchmarks | null | undefined, channels: Array<{ channelId: string; allocationDollars: number }>) {
  const projected = channels.map((c) => projectChannel(benchmarks, c.channelId, c.allocationDollars)).filter((p): p is ChannelProjection => Boolean(p));
  const total = channels.reduce((s, c) => s + (c.allocationDollars || 0), 0);
  const covered = projected.reduce((s, p) => s + p.budget, 0);
  const low = projected.reduce((s, p) => s + p.low, 0);
  const high = projected.reduce((s, p) => s + p.high, 0);
  if (!projected.length || high <= 0) return null;
  return { low, high, coveredBudget: covered, coveredShare: total > 0 ? covered / total : 0, channels: projected };
}

/** The exact change a recommendation makes, read from the plan before and after its dry run. */
export function changeLines(beforeProfile: any, afterProfile: any, decisionChannelIds: string[] = []): RecapChangeLine[] {
  const before: any[] = beforeProfile?.channelStrategy?.mediaPlan?.channels || [];
  const after: any[] = afterProfile?.channelStrategy?.mediaPlan?.channels || [];
  const lines: RecapChangeLine[] = [];
  for (const c of after) {
    const old = before.find((b) => b.channelId === c.channelId);
    if (!old) lines.push({ kind: "channel_added", channelId: c.channelId, channelName: c.channelName, percent: c.allocationPercent, budget: c.allocationDollars });
    else if (Math.abs(old.allocationPercent - c.allocationPercent) >= 0.05) {
      lines.push({
        kind: "allocation", channelId: c.channelId, channelName: c.channelName, percent: c.allocationPercent, budget: c.allocationDollars,
        direction: c.allocationPercent > old.allocationPercent ? "up" : "down",
        role: decisionChannelIds.length === 0 || decisionChannelIds.includes(c.channelId) ? "decision" : "funding",
        delta: c.allocationDollars - old.allocationDollars,
        fromPercent: old.allocationPercent,
        fromBudget: old.allocationDollars,
      });
    }
  }
  for (const b of before) if (!after.some((c) => c.channelId === b.channelId)) lines.push({ kind: "channel_removed", channelId: b.channelId, channelName: b.channelName });
  const names = (p: any) => (p?.ctvPublishers || []).map((x: any) => String(x?.publisher ?? "")).filter(Boolean);
  const pubsBefore = names(beforeProfile);
  const pubsAfter = names(afterProfile);
  for (const n of pubsAfter) if (!pubsBefore.includes(n)) lines.push({ kind: "publisher_added", name: n });
  for (const n of pubsBefore) if (!pubsAfter.includes(n)) lines.push({ kind: "publisher_removed", name: n });
  // Rises first, so the line the recommendation is about leads.
  const order = { channel_added: 0, publisher_added: 1, allocation: 2, channel_removed: 3, publisher_removed: 4 } as const;
  return lines.sort((a, z) => order[a.kind] - order[z.kind] || (a.kind === "allocation" && z.kind === "allocation" ? (a.direction === z.direction ? 0 : a.direction === "up" ? -1 : 1) : 0));
}

/** The automatic rebalance in one line: "about $1K from each of 6 other media types". */
export function fundingSummary(lines: RecapChangeLine[] | undefined): { count: number; each: number | null; total: number; from: boolean } | null {
  const funding = (lines ?? []).filter((l): l is Extract<RecapChangeLine, { kind: "allocation" }> => l.kind === "allocation" && l.role === "funding" && typeof l.delta === "number");
  if (!funding.length) return null;
  const amounts = funding.map((l) => Math.abs(l.delta as number));
  const total = amounts.reduce((s, a) => s + a, 0);
  const even = Math.max(...amounts) <= Math.min(...amounts) * 1.5;
  return { count: funding.length, each: even ? total / funding.length : null, total, from: funding.every((l) => l.direction === "down") };
}

const channelIdsOf = (ops: AssistantOp[]) => [...new Set(ops.flatMap((op) => ("channelId" in op && (op.type === "set_allocation" || op.type === "add_channel" || op.type === "remove_channel") ? [op.channelId] : [])))];

export interface DryRunResult {
  payload: any;
  changes: unknown[];
  rejected: Array<{ reason: string }>;
}

/**
 * Re-checks every recommendation's change against the plan as it stands, so the card, the slides
 * and the share link always show its real result. Run on every save and every applied change.
 * - Media types a "keep" recommendation protects are held where they are while other changes run.
 * - A change that no longer applies is marked for the planner; the client sees no change box.
 * - A change the plan already contains (the planner made it by hand) becomes "In this plan".
 * Returns whether anything changed.
 */
export function refreshRecapProposals(payload: any, dryRun: (ops: AssistantOp[]) => DryRunResult, now = new Date().toISOString()): boolean {
  const profile = payload?.profile;
  const recap: CampaignRecap | undefined = profile?.campaignRecap;
  if (!recap?.recommendations?.length) return false;
  const before = JSON.stringify(recap.recommendations);
  const channels: any[] = profile.channelStrategy?.mediaPlan?.channels || [];
  const kept = [...new Set(recap.recommendations.flatMap((r) => (r.kind === "keep" ? r.keepChannelIds ?? [] : [])))];
  for (const rec of recap.recommendations) {
    const base = rec.baseOps ?? rec.ops ?? [];
    if (rec.appliedAt || !base.length) continue;
    const decisions = rec.decisionChannelIds ?? channelIdsOf(base);
    const holds: AssistantOp[] = kept
      .filter((id) => !decisions.includes(id))
      .map((id) => channels.find((c) => c.channelId === id))
      .filter((c) => c && Number.isInteger(c.allocationPercent))
      .map((c) => ({ type: "set_allocation", channelId: c.channelId, percent: c.allocationPercent }));
    const ops = [...base, ...holds];
    const result = dryRun(ops);
    rec.baseOps = base;
    rec.decisionChannelIds = decisions;
    if (result.rejected.length) {
      rec.needsReview = true;
      rec.ops = [];
      rec.changes = [];
    } else if (result.changes.length === 0) {
      rec.needsReview = false;
      rec.appliedAt = now;
      rec.ops = ops;
    } else {
      rec.needsReview = false;
      rec.ops = ops;
      rec.changes = changeLines(profile, result.payload?.profile, decisions);
    }
  }
  return JSON.stringify(recap.recommendations) !== before;
}

// ---- Words: the model, checked ----

export const RECAP_SYSTEM_INSTRUCTION = `You are a senior media strategist at Digital Remedy preparing the "Campaign Recap" the client will see in their new media plan and in a presentation. It shows the client we understand their last campaign: what worked, what didn't, and exactly what we recommend. The figures, charts, evidence bars and projections are built in code; you write the words and choose what each recommendation rests on and changes.

Rules:
- Use only findings from the review you are given, by their id. Do not invent findings. Every recommendation must rest on at least one finding.
- Figures: a headline, stat, summary or measure may quote a figure only if it appears in that campaign's review or data, written as it appears there (rounding to fewer decimals is fine). A recommendation's title and detail contain no figures: its evidence and change are shown beside it.
- Evidence rows: name the report rows the recommendation rests on exactly as they appear in the data (for example "Pre-Roll/Mid-Roll"), at most two.
- Plan changes: for a "change" recommendation, give the operations that carry it out on THE NEW PLAN, using its channelIds and publishers exactly as listed: set_allocation {channelId, percent (whole number)}, add_channel {channelId}, remove_channel {channelId}, add_ctv_publisher {publisher, why}, remove_ctv_publisher {publisher}. Keep changes proportionate to the evidence. When you raise a media type, also lower the ones that should fund it (set_allocation), chosen from what the evidence says worked least well; whatever you do not set rebalances evenly. Never move a media type a "keep" recommendation protects. Each media type's range is the catalog's recommended range, a guide rather than a limit: prefer changes inside it, and step outside only when the evidence is strong. A locked one cannot move. A "keep" recommendation changes nothing on purpose; an "execution" recommendation is about how the campaign is run (pacing, frequency, creative rotation), not what is bought. Neither has operations.
- The campaign KPI is given for each campaign. Write the summary against it, put the findings that moved it first, and frame every recommendation as how the next campaign does better on it.
- Tone: this is presented to the client. Lead with what worked. Write what did not work as an opportunity ("Focus CTV on its strongest publishers", "To drive stronger ROAS, ..."), never as a failure: no "missed", "failed", "underperformed", "poor", "disappointing" or "wasted".
- The client's language: CPA or "cost per <conversion>", share of spend, reach. Never "PM", "performance multiplier" or "ad group".
- Report what happened, not why: no "because", "due to", "led to", "as a result".
- Confident and plain. No hedging stacks, no markdown.`;

const opSchema = {
  type: "object",
  properties: {
    type: { type: "string", description: RECOMMENDATION_OP_TYPES.join(" | ") },
    channelId: { type: "string" },
    percent: { type: "number" },
    publisher: { type: "string" },
    why: { type: "string", description: "For add_ctv_publisher: one sentence on why it fits this audience." },
  },
  required: ["type"],
};

export const recapSchema = {
  type: "object",
  properties: {
    campaigns: {
      type: "array",
      items: {
        type: "object",
        properties: {
          campaignId: { type: "string" },
          summary: { type: "string", description: "At most 35 words: how the campaign did against what it optimised for." },
          cards: {
            type: "array",
            description: "3 or 4 key takeaways, the findings that moved the KPI most first: mostly what worked, with at least one opportunity when the review has one.",
            items: {
              type: "object",
              properties: {
                findingId: { type: "string" },
                headline: { type: "string", description: "At most 7 words, sentence case, no figures (e.g. 'Retargeting CTV viewers drove checkouts'). For an opportunity, the action ('Focus CTV on its strongest publishers')." },
                stat: { type: "string", description: "At most 10 words, starting with the one figure that backs it, then what it counts (e.g. '42% of checkouts from 9% of spend')." },
              },
              required: ["findingId", "headline", "stat"],
            },
          },
        },
        required: ["campaignId", "summary", "cards"],
      },
    },
    recommendations: {
      type: "array",
      description: "3 to 5 recommendations for the next campaign, the biggest lift to the KPI first.",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", description: "change | keep | execution" },
          title: { type: "string", description: "At most 8 words, an action (e.g. 'Expand pre-roll and online video')." },
          detail: { type: "string", description: "One sentence of at most 22 words: what the evidence showed and what we will do. No figures." },
          area: { type: "string", description: `One of: ${RECOMMENDATION_AREAS.join(", ")}.` },
          findings: {
            type: "array",
            description: "The findings it rests on.",
            items: { type: "object", properties: { campaignId: { type: "string" }, findingId: { type: "string" } }, required: ["campaignId", "findingId"] },
          },
          evidenceRows: { type: "array", items: { type: "string" }, description: "At most 2 report row names exactly as in the data." },
          measure: { type: "string", description: "At most 14 words: how we will know it worked, e.g. 'Cost per checkout on online video against $27.45'." },
          keepChannels: { type: "array", items: { type: "string" }, description: "Only for kind 'keep': the channelIds it keeps as they are." },
          ops: { type: "array", items: opSchema, description: "Only for kind 'change'." },
        },
        required: ["kind", "title", "detail", "area", "findings", "measure"],
      },
    },
  },
  required: ["campaigns", "recommendations"],
};

/** A finding the client may see: from a current review, with every figure checked and no cause claimed. */
export function usableFindings(linked: LinkedCampaign) {
  if (!linked.review || linked.reviewStale) return [];
  return linked.review.findings.filter((f) => f.unverified.length === 0 && !f.causalClaim);
}

export interface RecapPlanContext extends RecapBriefContext {
  channels: Array<{ channelId: string; channelName: string; allocationPercent: number; minPercent: number; maxPercent: number; locked: boolean }>;
  /** Media types the plan could add (channelId and name). */
  addable: Array<{ channelId: string; channelName: string }>;
  publishers: string[];
  /** Catalog publishers that can be added. */
  addablePublishers: string[];
}

/** The KPI as the model reads it: "ROAS (3.73x; the brief's target: ROAS > 120%)". */
function kpiLine(kpi: RecapKpi | null, label: string): string {
  if (!kpi) return "Campaign KPI: not stated; judge it on cost per conversion.";
  const names: Record<RecapKpi["metric"], string> = { roas: "ROAS", cpa: `cost per ${label.toLowerCase().replace(/s$/, "")}`, conversions: label.toLowerCase(), reach: "reach", vcr: "video completion rate", ctr: "click-through rate" };
  const value = kpi.metric === "roas" ? (kpi.roasStyle === "percent" ? `${Math.round(kpi.value * 100)}%; write ROAS as a percentage, as the brief does: ${kpi.value.toFixed(2)}x is ${Math.round(kpi.value * 100)}%` : `${kpi.value.toFixed(2)}x`) : kpi.metric === "cpa" ? `$${kpi.value.toFixed(2)}` : kpi.metric === "vcr" || kpi.metric === "ctr" ? `${(kpi.value * 100).toFixed(2)}%` : Math.round(kpi.value).toLocaleString("en-US");
  const target = kpi.target && kpi.target.metric === kpi.metric ? `; the brief's target: ${kpi.target.text}` : "";
  return `Campaign KPI: ${names[kpi.metric]} (${value}${target}).`;
}

export function buildRecapInput(linked: LinkedCampaign[], plan: RecapPlanContext, keep: RecapRecommendation[]): string {
  const sections = linked.map((l) => {
    const findings = usableFindings(l);
    return [
      `CAMPAIGN ${l.campaign.id}: ${l.campaign.name} (${l.analysis.conversionLabel.label} is the conversion).`,
      kpiLine(recapKpiFor(l, plan).kpi, l.analysis.conversionLabel.label),
      l.review?.summary ? `Review summary: ${l.review.summary}` : "",
      "Findings you may use:",
      ...findings.map((f) => `[${f.id}] (${f.kind === "didnt" ? "did not work" : f.kind === "watch" ? "caveat" : "worked"}, ${f.confidence} confidence) ${f.headline}. ${f.detail} Evidence: ${f.evidence}`),
      renderDigest(l.analysis, { maxChars: 8000 }),
    ].filter(Boolean).join("\n");
  });
  return [
    ...sections,
    ["THE NEW PLAN'S MEDIA TYPES (channelId: name, current share, the catalog's recommended range):", ...plan.channels.map((c) => `- ${c.channelId}: ${c.channelName}, ${c.allocationPercent}% (recommended ${c.minPercent}-${c.maxPercent}%${c.locked ? ", locked" : ""})`)].join("\n"),
    plan.addable.length ? `MEDIA TYPES IT COULD ADD: ${plan.addable.map((c) => `${c.channelId} (${c.channelName})`).join(", ")}.` : "",
    plan.publishers.length ? `ITS CTV PUBLISHERS: ${plan.publishers.join(", ")}.` : "",
    plan.addablePublishers.length ? `CTV PUBLISHERS IT COULD ADD: ${plan.addablePublishers.slice(0, 60).join(", ")}.` : "",
    keep.length ? `ALREADY APPLIED TO THE PLAN (they stay as they are; do not repeat them): ${keep.map((r) => r.title).join("; ")}.` : "",
    "Write the recap.",
  ].filter(Boolean).join("\n\n");
}

const clean = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\*\*|__|`|^#+\s*/gm, "").replace(/\s+/g, " ").trim().replace(/\.$/, "").slice(0, max) : "");
const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Why a piece of client text cannot be shown, or null when it can. */
function problem(text: string, reference: FigureReference | null, maxWords: number): string | null {
  if (!text) return "empty";
  if (words(text) > maxWords + 3) return "too long";
  if (INTERNAL_TERMS.test(text)) return "internal term";
  if (BLUNT.test(text)) return "blunt wording";
  if (findCausalClaim(text)) return "states a cause";
  if (reference ? unverifiedFigures(text, reference).length > 0 : extractPerformanceFigures(text).length > 0) return "figure not in the data";
  return null;
}

const STRENGTH: Record<Confidence, EvidenceStrength> = { high: "strong", medium: "directional", low: "test" };
const RANK: Record<EvidenceStrength, number> = { test: 0, directional: 1, strong: 2 };
const count = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (n: number | null) => `${Math.round((n ?? 0) * 100)}%`;

/** The cited rows from the campaign's own breakdowns, the media type report first. */
function findRows(analysis: CampaignAnalysis, names: string[]): DigestRow[] {
  const breakdowns = analysis.breakdowns.filter((b) => b.role !== "reference")
    .sort((a, z) => Number(isMediaTypeDimension(z.dimension)) - Number(isMediaTypeDimension(a.dimension)));
  const found: DigestRow[] = [];
  for (const name of names) {
    const key = name.trim().toLowerCase();
    const row = breakdowns.flatMap((b) => b.rows).find((r) => r.name.trim().toLowerCase() === key);
    if (row && !found.includes(row) && row.cpa !== null) found.push(row);
  }
  return found.slice(0, 2);
}

/** The cited rows on the KPI's measure: ROAS when the KPI is ROAS, otherwise cost per conversion. */
export function recommendationEvidence(linked: LinkedCampaign, rowNames: string[], fallback: string, kpiMetric: RecapKpi["metric"] | null = null): RecapEvidence | null {
  const { analysis } = linked;
  const label = analysis.conversionLabel.label;
  const useRoas = kpiMetric === "roas" && (analysis.totals?.roas ?? 0) > 0;
  const rows = findRows(analysis, rowNames).filter((r) => !useRoas || r.roas !== null);
  const average = useRoas ? analysis.totals?.roas ?? null : analysis.totals?.cpa ?? null;
  const unit = label.toLowerCase();
  const singularLabel = unit.endsWith("s") ? unit.slice(0, -1) : unit;
  if (rows.length && average) {
    const first = rows[0];
    return {
      campaignId: linked.campaign.id,
      ...(useRoas ? { metric: "roas" as const } : {}),
      metricLabel: useRoas ? "Return on ad spend" : `Cost per ${singularLabel}`,
      bars: [
        ...rows.map((r) => ({ name: r.name, cpa: (useRoas ? r.roas : r.cpa) as number, isAverage: false, thin: r.flags.includes("low-sample") || r.flags.includes("event") })),
        { name: "Campaign average", cpa: average, isAverage: true, thin: false },
      ],
      note: `${count(first.metrics.conversions ?? 0)} ${unit} · ${pct(first.conversionShare)} of ${unit} from ${pct(first.spendShare)} of spend`,
    };
  }
  return fallback ? { campaignId: linked.campaign.id, metricLabel: "", bars: [], note: fallback } : null;
}

function readOps(raw: unknown): AssistantOp[] {
  const ops: AssistantOp[] = [];
  for (const o of Array.isArray(raw) ? raw.slice(0, MAX_OPS) : []) {
    const type = o?.type;
    const channelId = typeof o?.channelId === "string" ? o.channelId.trim() : "";
    const publisher = typeof o?.publisher === "string" ? o.publisher.trim() : "";
    if (type === "set_allocation" && channelId && Number.isFinite(Number(o.percent))) ops.push({ type, channelId, percent: Math.round(Number(o.percent)) });
    else if ((type === "add_channel" || type === "remove_channel") && channelId) ops.push({ type, channelId });
    else if (type === "add_ctv_publisher" && publisher) ops.push({ type, publisher, why: clean(o?.why, 300) || "Fits this audience, as the last campaign showed." });
    else if (type === "remove_ctv_publisher" && publisher) ops.push({ type, publisher });
  }
  return ops;
}

export interface RecapCopyResult {
  campaigns: Map<string, { summary: string; cards: RecapCard[] }>;
  recommendations: RecapRecommendation[];
  /** What was left out, for the planner. */
  dropped: string[];
}

export function normalizeRecapCopy(raw: any, linked: LinkedCampaign[], newId: () => string, context: RecapBriefContext = {}): RecapCopyResult {
  const dropped: string[] = [];
  const campaigns = new Map<string, { summary: string; cards: RecapCard[] }>();
  const references = new Map(linked.map((l) => [l.campaign.id, figureReference(renderDigest(l.analysis, { maxChars: 1_000_000 }), l.review?.summary ?? "")]));
  for (const l of linked) {
    const out = (Array.isArray(raw?.campaigns) ? raw.campaigns : []).find((c: any) => c?.campaignId === l.campaign.id);
    const reference = references.get(l.campaign.id)!;
    const findings = usableFindings(l);
    const summary = clean(out?.summary, 300);
    const summaryProblem = problem(summary, reference, 35);
    if (summary && summaryProblem) dropped.push(`${l.campaign.name} summary (${summaryProblem})`);
    const cards: RecapCard[] = [];
    for (const c of Array.isArray(out?.cards) ? out.cards : []) {
      const finding = findings.find((f) => f.id === c?.findingId);
      const headline = clean(c?.headline, 80);
      const stat = clean(c?.stat, 100);
      if (!finding) { dropped.push(`card "${headline}" (not a usable finding)`); continue; }
      if (cards.some((x) => x.findingId === finding.id)) continue;
      const why = problem(headline, reference, 7) || problem(stat, reference, 10);
      if (why) { dropped.push(`card "${headline}" (${why})`); continue; }
      // The kind is the review's, not the model's: a caveat cannot be relabelled a win.
      cards.push({ id: newId(), findingId: finding.id, kind: finding.kind, headline, stat, area: finding.area });
      if (cards.length === MAX_CARDS) break;
    }
    campaigns.set(l.campaign.id, { summary: summaryProblem ? "" : summary, cards });
  }

  const recommendations: RecapRecommendation[] = [];
  for (const r of Array.isArray(raw?.recommendations) ? raw.recommendations : []) {
    const title = clean(r?.title, 80);
    const detail = clean(r?.detail, 200);
    const why = problem(title, null, 8) || problem(detail, null, 22);
    if (why) { dropped.push(`recommendation "${title}" (${why})`); continue; }
    // Justified or not shown: every recommendation rests on a finding the client may see.
    const cited = (Array.isArray(r?.findings) ? r.findings : [])
      .map((f: any) => {
        const l = linked.find((x) => x.campaign.id === f?.campaignId) ?? (linked.length === 1 ? linked[0] : undefined);
        const finding = l ? usableFindings(l).find((x) => x.id === f?.findingId) : undefined;
        return l && finding ? { linked: l, finding } : null;
      })
      .filter(Boolean) as Array<{ linked: LinkedCampaign; finding: ReturnType<typeof usableFindings>[number] }>;
    if (!cited.length) { dropped.push(`recommendation "${title}" (no finding behind it)`); continue; }
    const primary = cited[0];
    const card = campaigns.get(primary.linked.campaign.id)?.cards.find((c) => c.findingId === primary.finding.id);
    const evidence = recommendationEvidence(primary.linked, Array.isArray(r?.evidenceRows) ? r.evidenceRows.map(String) : [], card?.stat ?? "", recapKpiFor(primary.linked, context).kpi?.metric ?? null);
    let strength = cited.map((c) => STRENGTH[c.finding.confidence]).reduce((a, z) => (RANK[z] < RANK[a] ? z : a), "strong" as EvidenceStrength);
    if (evidence?.bars.some((b) => b.thin)) strength = "test";
    const measure = clean(r?.measure, 140);
    const measureProblem = problem(measure, references.get(primary.linked.campaign.id)!, 14);
    const ops = readOps(r?.ops);
    const kind: RecommendationKind = r?.kind === "keep" || r?.kind === "execution" ? r.kind : "change";
    recommendations.push({
      id: newId(),
      title,
      detail,
      area: RECOMMENDATION_AREAS.includes(r?.area) ? (r.area as RecommendationArea) : "channel",
      appliedAt: null,
      kind,
      findings: cited.map((c) => ({ campaignId: c.linked.campaign.id, findingId: c.finding.id })),
      strength,
      evidence,
      measure: measureProblem ? "" : measure,
      baseOps: kind === "change" ? ops : [],
      ops: kind === "change" ? ops : [],
      changes: [],
      decisionChannelIds: kind === "change" ? channelIdsOf(ops) : [],
      keepChannelIds: kind === "keep" && Array.isArray(r?.keepChannels) ? r.keepChannels.map(String).filter(Boolean).slice(0, 4) : [],
    });
    if (recommendations.length === MAX_RECOMMENDATIONS) break;
  }
  return { campaigns, recommendations, dropped };
}

/**
 * The recap as it is saved: figures from code, words from the checked copy. Recommendations the
 * planner already applied are carried over unchanged, so rebuilding never loses "In this plan".
 */
export function assembleRecap(linked: LinkedCampaign[], copy: RecapCopyResult, previous: CampaignRecap | null | undefined, meta: { actor: string; now?: string; benchmarks?: RecapBenchmarks | null; briefKpis?: string[] }): CampaignRecap {
  const kept = (previous?.recommendations || []).filter((r) => r.appliedAt);
  const fresh = copy.recommendations.filter((r) => !kept.some((k) => k.title.toLowerCase() === r.title.toLowerCase()));
  const campaign = (l: LinkedCampaign): RecapCampaign => {
    const figures = recapFigures(l, { briefKpis: meta.briefKpis });
    // The planner's KPI choice and hidden blocks survive a rebuild, while the data still supports them.
    const before = previous?.campaigns?.find((c) => c.campaignId === l.campaign.id);
    const chosen = before?.kpi?.source === "planner" ? withKpiMetric(figures.kpi, figures.kpiValues, before.kpi.metric) : null;
    return {
      ...figures,
      kpi: chosen ?? figures.kpi,
      hiddenBlocks: before?.hiddenBlocks ?? [],
      summary: copy.campaigns.get(l.campaign.id)?.summary ?? "",
      cards: copy.campaigns.get(l.campaign.id)?.cards ?? [],
    };
  };
  return {
    builtAt: meta.now ?? new Date().toISOString(),
    builtBy: meta.actor,
    campaigns: linked.map(campaign),
    recommendations: [...kept, ...fresh].slice(0, MAX_RECOMMENDATIONS + kept.length),
    benchmarks: meta.benchmarks ?? null,
  };
}

/**
 * The recap as a share link carries it: a detail block the planner hid is removed, not just not
 * drawn, so its figures never reach the client. The mix stays for the projections' sake only when
 * shown.
 */
export function clientRecap(recap: CampaignRecap): CampaignRecap {
  if (!recap.campaigns.some((c) => c.hiddenBlocks?.length)) return recap;
  return {
    ...recap,
    campaigns: recap.campaigns.map((c) => {
      const hidden = new Set(c.hiddenBlocks ?? []);
      if (!hidden.size) return c;
      return {
        ...c,
        ...(hidden.has("mix") ? { mix: null, mixNote: null, ctvAssist: null } : {}),
        ...(hidden.has("trend") ? { trend: null } : {}),
        rankings: (c.rankings ?? []).filter((r) => !hidden.has(r.key)),
      };
    }),
  };
}

/** True when a plan has a recap with anything to show. */
export function hasCampaignRecap(profile: any): profile is { campaignRecap: CampaignRecap } {
  const r = profile?.campaignRecap;
  return Boolean(r && Array.isArray(r.campaigns) && r.campaigns.length > 0);
}
