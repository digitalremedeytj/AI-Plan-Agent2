// The campaign KPI the recap is built around, and the detail figures drawn against it. All of it
// is computed here from the reconciled analysis; the model never picks the KPI or a figure.
// - The KPI comes from the plan's brief first ("ROAS > 120%", "Checkouts"), then the goal the
//   planner chose at upload, then the data itself (revenue means ROAS; enough conversions mean
//   cost per conversion). One read from the data is the planner's to confirm before the client
//   is told it was the campaign's KPI.
// - A target is only carried for a rate (cost per conversion, ROAS): a volume target from the new
//   brief says nothing about a past campaign with a different budget.
// - The detail blocks (flight trend, publishers, audiences, creative) rank rows on the KPI's own
//   measure, mark thin rows, and leave out anything the files do not support.

import { isMediaTypeDimension, MIN_CONVERSIONS, type BreakdownDigest, type CampaignAnalysis, type DigestRow } from "./campaign";
import { parseKpiTarget } from "./planVsActual";
import { formatDay } from "./values";

export const KPI_METRICS = ["roas", "cpa", "conversions", "reach", "vcr", "ctr"] as const;
export type KpiMetric = (typeof KPI_METRICS)[number];

export interface RecapKpiTarget {
  metric: "cpa" | "roas";
  value: number;
  /** The brief's own words. */
  text: string;
}

export interface RecapKpi {
  metric: KpiMetric;
  value: number;
  /** brief, goal: what the planner wrote. data: read from the files, shown as the KPI once confirmed. planner: chosen or confirmed by the planner. */
  source: "brief" | "goal" | "data" | "planner";
  /** The brief's KPI line it came from. */
  briefText: string | null;
  /** The brief's target, which applies only while the KPI is the same measure. */
  target: RecapKpiTarget | null;
  /** How ROAS reads: 373% or 3.73x, as the brief writes it. */
  roasStyle: "percent" | "multiple";
}

/** Every measure the campaign can be judged on, so the planner can switch the KPI without a rebuild. */
export type KpiValues = Partial<Record<KpiMetric, number>>;

const LOWER_IS_BETTER: ReadonlySet<KpiMetric> = new Set(["cpa"]);
export const kpiHigherIsBetter = (metric: KpiMetric) => !LOWER_IS_BETTER.has(metric);

/** The KPI's target when it applies to the current measure. */
export const activeTarget = (kpi: RecapKpi) => (kpi.target && kpi.target.metric === kpi.metric ? kpi.target : null);

/** How far the KPI beat its target, as a fraction (0.24 = 24% better). Negative when short of it. */
export function kpiVsTarget(kpi: RecapKpi): number | null {
  const target = activeTarget(kpi);
  if (!target || !(target.value > 0)) return null;
  return kpiHigherIsBetter(kpi.metric) ? kpi.value / target.value - 1 : (target.value - kpi.value) / target.value;
}

/** Completion rate on the media that ran video, so display impressions do not dilute it. */
export function videoCompletionRate(analysis: CampaignAnalysis): { value: number; ctv: boolean } | null {
  const b = analysis.breakdowns.find((x) => x.role !== "reference" && isMediaTypeDimension(x.dimension));
  const video = (b?.rows ?? []).filter((r) => (r.metrics.videoCompletions ?? 0) > 0 && (r.metrics.videoImpressions ?? 0) > 0);
  if (!video.length) return null;
  const ctvRows = video.filter((r) => CTV.test(r.name));
  const rows = ctvRows.length ? ctvRows : video;
  const done = rows.reduce((s, r) => s + (r.metrics.videoCompletions ?? 0), 0);
  const started = rows.reduce((s, r) => s + (r.metrics.videoImpressions ?? 0), 0);
  return started > 0 ? { value: Math.min(1, done / started), ctv: ctvRows.length > 0 } : null;
}

export function kpiValues(analysis: CampaignAnalysis): KpiValues {
  const t = analysis.totals;
  const out: KpiValues = {};
  const put = (metric: KpiMetric, value: number | null | undefined) => {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) out[metric] = value;
  };
  if ((t?.revenue ?? 0) > 0) put("roas", t?.roas);
  put("cpa", t?.cpa);
  put("conversions", t?.conversions);
  put("reach", analysis.reach?.reach);
  put("vcr", videoCompletionRate(analysis)?.value);
  put("ctr", t?.ctr);
  return out;
}

const KEYWORDS: Array<[KpiMetric, RegExp]> = [
  ["roas", /\broas\b|return on (ad )?spend|revenue/i],
  ["cpa", /\bcpa\b|cost per (acquisition|conversion|sale|order|checkout|purchase|lead|visit|install)|\bcpl\b/i],
  ["vcr", /\bvcr\b|completion|completed views|view.?through rate/i],
  ["ctr", /\bctr\b|click.?through|clicks?\b/i],
  ["reach", /\breach\b|awareness|households|unique/i],
  ["conversions", /checkout|purchase|sales?\b|orders?\b|conversion|leads?\b|visits?\b|install|sign.?ups?|transaction|booking|acquisition|tickets?\b|registration|enrol/i],
];

/** "ROAS > 120%" reads as a percentage; "3x ROAS" or "ROAS of $4" as a multiple. */
function roasStyle(text: string | null): "percent" | "multiple" {
  if (!text) return "percent";
  if (/\broas\b[^.]{0,24}\d\s*%|\d\s*%[^.]{0,12}\broas\b/i.test(text)) return "percent";
  return /\d\s*x\b|\$\s?\d/i.test(text) ? "multiple" : "percent";
}

/**
 * The brief's KPI that this campaign can be judged on. A KPI with a target ("ROAS > 120%") is the
 * most specific thing the brief says, so it wins over a generic one listed before it ("Drive
 * online sales"); otherwise the first the files can measure.
 */
export function kpiFromBrief(kpis: string[], available: KpiValues): { metric: KpiMetric; text: string; target: RecapKpiTarget | null } | null {
  const lines = kpis.map((k) => String(k ?? "").trim()).filter(Boolean);
  for (const text of lines) {
    const parsed = parseKpiTarget([text]);
    if (parsed && available[parsed.metric] !== undefined) return { metric: parsed.metric, text, target: { metric: parsed.metric, value: parsed.value, text } };
  }
  for (const text of lines) {
    const match = KEYWORDS.find(([metric, re]) => re.test(text) && available[metric] !== undefined);
    if (match) return { metric: match[0], text, target: null };
  }
  return null;
}

const GOAL_METRICS: Record<string, KpiMetric[]> = {
  cpa: ["cpa"],
  roas: ["roas"],
  reach: ["reach", "vcr"],
  engagement: ["conversions", "ctr"],
};

/** What the data says the campaign was bought on, when nobody wrote it down. */
function kpiFromData(values: KpiValues, analysis: CampaignAnalysis): KpiMetric | null {
  if (values.roas !== undefined) return "roas";
  if (values.cpa !== undefined && (analysis.totals?.conversions ?? 0) >= MIN_CONVERSIONS) return "cpa";
  return (["reach", "vcr", "ctr"] as KpiMetric[]).find((m) => values[m] !== undefined) ?? null;
}

export function resolveRecapKpi(analysis: CampaignAnalysis, context: { briefKpis?: string[]; campaignGoal?: string | null }): { kpi: RecapKpi | null; values: KpiValues } {
  const values = kpiValues(analysis);
  const brief = kpiFromBrief(context.briefKpis ?? [], values);
  // A target in the brief is kept even when the KPI comes from elsewhere: the planner may switch to it.
  const briefTarget = brief?.target ?? (() => {
    const parsed = parseKpiTarget(context.briefKpis ?? []);
    return parsed ? { metric: parsed.metric, value: parsed.value, text: parsed.text } : null;
  })();
  const style = roasStyle(briefTarget?.text ?? brief?.text ?? (context.briefKpis ?? []).find((k) => /roas/i.test(k)) ?? null);
  const make = (metric: KpiMetric, source: RecapKpi["source"], briefText: string | null): RecapKpi => ({ metric, value: values[metric] as number, source, briefText, target: briefTarget, roasStyle: style });
  if (brief) return { kpi: make(brief.metric, "brief", brief.text), values };
  const goal = (GOAL_METRICS[context.campaignGoal ?? ""] ?? []).find((m) => values[m] !== undefined);
  if (goal) return { kpi: make(goal, "goal", null), values };
  const inferred = kpiFromData(values, analysis);
  return { kpi: inferred ? make(inferred, "data", null) : null, values };
}

/** The planner's choice of KPI, from the values frozen with the recap. Null when the campaign has no such figure. */
export function withKpiMetric(kpi: RecapKpi | null | undefined, values: KpiValues | undefined, metric: KpiMetric): RecapKpi | null {
  const value = values?.[metric];
  if (value === undefined) return null;
  return { metric, value, source: "planner", briefText: kpi?.briefText ?? null, target: kpi?.target ?? null, roasStyle: kpi?.roasStyle ?? "percent" };
}

// ---- Detail blocks ----

export const CTV = /\b(ott|ctv|connected\s*tv|streaming\s*tv)\b/i;

export interface RecapTrendWeek {
  /** ISO day the week starts. */
  start: string;
  days: number;
  spend: number;
  conversions: number;
  cpa: number | null;
}

export interface RecapTrend {
  weeks: RecapTrendWeek[];
  averageCpa: number;
}

export function recapTrend(analysis: CampaignAnalysis): RecapTrend | null {
  const series = analysis.series.find((s) => s.role !== "reference" && s.weeks.length >= 2);
  const average = analysis.totals?.cpa ?? null;
  if (!series || !average) return null;
  const weeks = series.weeks.filter((w) => w.spend > 0).map((w) => ({ start: formatDay(w.start), days: w.days, spend: w.spend, conversions: w.conversions, cpa: w.cpa }));
  return weeks.length >= 2 && weeks.some((w) => w.cpa !== null) ? { weeks, averageCpa: average } : null;
}

/** The best full week and how many full weeks ran below the campaign's cost per conversion. */
export function trendHighlights(trend: RecapTrend) {
  const full = trend.weeks.map((w, i) => ({ ...w, index: i })).filter((w) => w.days >= 7 && w.cpa !== null && w.conversions >= MIN_CONVERSIONS);
  if (!full.length) return null;
  const best = full.reduce((a, z) => ((z.cpa as number) < (a.cpa as number) ? z : a));
  const below = full.filter((w) => (w.cpa as number) < trend.averageCpa).length;
  return { best: best.index, bestCpa: best.cpa as number, bestGap: 1 - (best.cpa as number) / trend.averageCpa, below, full: full.length };
}

export type RankingKey = "publisher" | "audience" | "creative";

export interface RecapRankRow {
  name: string;
  /** The ranking's measure: ROAS as a multiple, or cost per conversion. */
  value: number;
  conversions: number;
  spendShare: number;
  /** Under 30 conversions: shown, never called a winner. */
  thin: boolean;
  /** Creative only: whether the concept ran as video or display. */
  format?: "Video" | "Display";
}

export interface RecapRanking {
  key: RankingKey;
  metric: "roas" | "cpa";
  /** The shown rows' own average, the line every bar is read against. */
  average: number;
  rows: RecapRankRow[];
  /** Rows past the top by spend, or without the measure; said under the chart. */
  omitted?: number;
  /** Recaps built while creative sizes were combined: how many report rows went into the concepts. */
  combinedFrom?: number;
}

const RANKING_DIMENSIONS: Array<[RankingKey, RegExp]> = [
  ["publisher", /publisher|network|app|site/i],
  ["audience", /audience|segment/i],
  ["creative", /creative|ad\s*name|asset/i],
];
/** The top rows by spend; the plan view scrolls them, the slides show fewer. */
const MAX_RANK_ROWS = 30;

const EXTENSION = /\.(mp4|mov|webm|m4v|jpe?g|png|gif|html?|zip)$/i;
const SIZE = /\b\d{2,4}\s?x\s?\d{2,4}\b/gi;
/** Trafficking codes, versions, edit marks and pure numbers: "24RTK23663", "D06", "H264", "15". */
const CODE = /^[A-Z0-9]*\d[A-Z0-9]*$/;
const TRAFFICKING = new Set(["webmix", "url", "final", "hd", "4k", "eng", "en", "mp4", "jpg", "png", "gif", "html5", "static", "animated", "mix", "edit"]);
const ACRONYMS = new Set(["usa", "us", "tv", "ctv", "ott", "suv", "diy", "uk", "4x4"]);
const SMALL = new Set(["a", "an", "and", "for", "in", "of", "on", "the", "to", "with", "at", "by"]);

/**
 * A creative in plain words: its concept without the file type, trafficking codes or the
 * advertiser's own name, then its size, so each size stays its own row:
 * "husky-cleans-faster-320x50.jpg" -> "Cleans Faster · 320x50";
 * "24RTK23663-15-Husky-Challenger-200-CleansFaster-WebMix-URL-D06-R03-3840x2160-H264.mp4" -> "Challenger Cleans Faster · 3840x2160".
 */
export function creativeName(name: string, advertiser?: string): string {
  const size = (name.match(SIZE) ?? [])[0]?.replace(/\s/g, "");
  const concept = creativeConcept(name, advertiser);
  return size ? `${concept} · ${size}` : concept;
}

function creativeConcept(name: string, advertiser?: string): string {
  const base = name.replace(EXTENSION, "").replace(SIZE, " ");
  const own = new Set((advertiser ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1));
  const words = base
    .split(/[\s\-_|·.]+/)
    .filter(Boolean)
    .filter((w) => !CODE.test(w) && !TRAFFICKING.has(w.toLowerCase()) && !own.has(w.toLowerCase()))
    .flatMap((w) => w.replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/([0-9])([A-Z])/g, "$1 $2").split(" "));
  if (!words.length) return base.replace(/[\s\-_]+/g, " ").trim() || name;
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      // "for", "in", "of" read lower case however the file wrote them; a lone "A" is a label ("Theme A").
      if (i > 0 && SMALL.has(lower) && (w === lower || w.length > 1)) return lower;
      return w === lower ? lower.charAt(0).toUpperCase() + lower.slice(1) : w;
    })
    .join(" ");
}

interface RankCandidate {
  name: string;
  metrics: DigestRow["metrics"];
  spendShare: number;
  format?: "Video" | "Display";
}

function rankingFor(key: RankingKey, b: BreakdownDigest, metric: "roas" | "cpa", advertiser?: string): RecapRanking | null {
  const candidates: RankCandidate[] = b.rows
    .filter((r) => !r.flags.includes("media-type-row"))
    .map((r) => ({
      name: key === "creative" ? creativeName(r.name, advertiser) : r.name,
      metrics: r.metrics,
      spendShare: r.spendShare ?? 0,
      ...(key === "creative" ? { format: (r.metrics.videoCompletions ?? 0) > 0 || /\.(mp4|mov|webm|m4v)$/i.test(r.name) ? "Video" as const : "Display" as const } : {}),
    }));
  const valueOf = (c: RankCandidate) => {
    const spend = c.metrics.spend ?? 0;
    if (!(spend > 0)) return null;
    if (metric === "roas") return (c.metrics.revenue ?? 0) > 0 ? (c.metrics.revenue as number) / spend : null;
    return (c.metrics.conversions ?? 0) > 0 ? spend / (c.metrics.conversions as number) : null;
  };
  const top = candidates
    .filter((c) => (c.metrics.spend ?? 0) > 0 && valueOf(c) !== null)
    .sort((a, z) => (z.metrics.spend ?? 0) - (a.metrics.spend ?? 0))
    .slice(0, MAX_RANK_ROWS);
  const thin = (c: RankCandidate) => (c.metrics.conversions ?? 0) < MIN_CONVERSIONS;
  if (top.filter((c) => !thin(c)).length < 2) return null;
  const spend = top.reduce((s, c) => s + (c.metrics.spend ?? 0), 0);
  const conversions = top.reduce((s, c) => s + (c.metrics.conversions ?? 0), 0);
  const revenue = top.reduce((s, c) => s + (c.metrics.revenue ?? 0), 0);
  const average = metric === "roas" ? (spend > 0 ? revenue / spend : 0) : conversions > 0 ? spend / conversions : 0;
  if (!(average > 0)) return null;
  const better = (a: number, z: number) => (metric === "roas" ? z - a : a - z);
  return {
    key,
    metric,
    average,
    rows: top
      .map((c) => ({ name: c.name, value: valueOf(c) as number, conversions: c.metrics.conversions ?? 0, spendShare: c.spendShare, thin: thin(c), ...(c.format ? { format: c.format } : {}) }))
      .sort((a, z) => Number(a.thin) - Number(z.thin) || better(a.value, z.value)),
    omitted: candidates.length - top.length,
  };
}

/** Publishers, audiences and creative, each ranked on the KPI's measure. Ad groups stay internal. */
export function recapRankings(analysis: CampaignAnalysis, kpi: RecapKpi | null): RecapRanking[] {
  const out: RecapRanking[] = [];
  const usable = analysis.breakdowns.filter((b) => b.role !== "reference" && !isMediaTypeDimension(b.dimension) && !/ad\s*group/i.test(b.dimension));
  for (const [key, re] of RANKING_DIMENSIONS) {
    const b = usable.find((x) => re.test(x.dimension));
    if (!b || out.some((r) => r.key === key)) continue;
    const metric = kpi?.metric === "roas" && (b.totals.revenue ?? 0) > 0 ? "roas" : "cpa";
    const ranking = rankingFor(key, b, metric, analysis.advertiser);
    if (ranking) out.push(ranking);
  }
  return out;
}

/**
 * Conversions from audiences retargeted after a CTV exposure ("Sequential Retargeting Off OTT"),
 * the part of CTV's contribution last-touch reporting hands to display. The cut with the most
 * such conversions is used, so the same conversions are never counted twice.
 */
export function ctvAssist(analysis: CampaignAnalysis): { conversions: number; share: number } | null {
  const total = analysis.totals?.conversions ?? 0;
  let best = 0;
  for (const b of analysis.breakdowns.filter((x) => x.role !== "reference" && !isMediaTypeDimension(x.dimension))) {
    const fed = b.rows.filter((r) => r.flags.includes("fed-by-ctv")).reduce((s, r) => s + (r.metrics.conversions ?? 0), 0);
    best = Math.max(best, fed);
  }
  return best >= MIN_CONVERSIONS && total > 0 ? { conversions: best, share: best / total } : null;
}
