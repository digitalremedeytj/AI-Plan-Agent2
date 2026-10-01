// A campaign's report set, read together. The files are not independent: the platform's
// Adgroup, Audience, Creative, Mediatype and Publisher reports are five cuts of the same spend,
// the daily report is a running total, the pacing report covers the whole IO rather than the
// report window, and touch-level files carry conversions but no spend. This module works out
// which file is which, checks them against each other, and computes every ratio from counts, so
// what ScoutAI reads is already reconciled and it never does arithmetic on raw rows.

import { normalizeHeader, ratio, type Metrics } from "./columns";
import type { BreakdownReport, RatioCheck, Report, SeriesReport, SummaryReport, TouchReport } from "./reports";
import type { TouchSummary } from "./touches";
import { DAY_MS, formatDay, formatWindow, sameWindow, withinWindow, type DateWindow } from "./values";

/** Below this many conversions a row's CPA and PM swing on a handful of events. */
export const MIN_CONVERSIONS = 30;
/** A row with no conversions matters only once it has spent a real share of the budget. */
const NO_CONVERSION_SPEND_SHARE = 0.02;
/** Totals this close are the same totals; the platform rounds spend to fractions of a cent. */
const SAME_TOTAL = 0.005;

const RETARGETING = /retarget|remarket|\bRT\b|sequential/i;
const FED_BY_CTV = /(off|from)\s+(ott|ctv)|sequential/i;
const EVENT = /super\s*bowl|march\s*madness|olympic|world\s*cup|playoff|holiday|black\s*friday|cyber\s*monday|election|\bpmp\b/i;

export type RowFlag = "low-sample" | "retargeting" | "fed-by-ctv" | "event" | "conversions-without-spend" | "no-conversions" | "media-type-row";
export type FileRole = "campaign" | "reference" | "undated";
export type Severity = "info" | "caution" | "problem";

export interface Warning {
  code: string;
  severity: Severity;
  message: string;
  fileName?: string;
}

export interface Derived {
  cpa: number | null;
  /** Revenue per dollar: 4.84 means $4.84 back for every $1. */
  roas: number | null;
  cpm: number | null;
  /** Fractions: 0.00025 is 0.025%. */
  ctr: number | null;
  vcr: number | null;
}

export interface DigestRow extends Derived {
  name: string;
  attributes: Record<string, string>;
  metrics: Metrics;
  spendShare: number | null;
  conversionShare: number | null;
  /** Performance Multiplier: the report's average CPA over this row's CPA. 1 is average. */
  pm: number | null;
  flags: RowFlag[];
}

export interface BreakdownDigest {
  fileName: string;
  dimension: string;
  role: FileRole;
  rows: DigestRow[];
  totals: Metrics;
  derived: Derived;
  /** Its totals match the other breakdowns': they are different cuts of the same campaign. */
  sharedTotals?: boolean;
  pmCheck: { status: "verified" | "mismatch" | "unchecked"; compared: number };
}

export interface SeriesDigest {
  fileName: string;
  role: FileRole;
  window?: DateWindow;
  cumulative: boolean;
  days: number;
  weeks: Array<{ start: number; days: number; spend: number; conversions: number; cpa: number | null }>;
}

export interface PacingDigest {
  fileName: string;
  window?: DateWindow;
  budget: number | null;
  spent: number | null;
  pacing: number | null;
  expected: number | null;
  difference: number | null;
}

export interface AttributionRow {
  mediaType: string;
  isCtv: boolean;
  spend: number;
  spendShare: number;
  lastTouch: number;
  anyTouch: number;
  linear: number;
  cpaLastTouch: number | null;
  cpaLinear: number | null;
  /** PM under each credit model: what the same spend looks like when credit moves. */
  pmLastTouch: number | null;
  pmLinear: number | null;
}

export interface AttributionDigest {
  fileName: string;
  spendFile: string;
  /** Touch-file conversions over the spend file's conversions; below 1 means a partial export. */
  coverage: number | null;
  rows: AttributionRow[];
}

export interface FileEntry {
  fileName: string;
  kind: Report["kind"];
  role: FileRole;
  platform: boolean;
  reportType?: string;
  window?: DateWindow;
  notes: string[];
  ratioChecks?: RatioCheck[];
  ignoredColumns?: string[];
}

export interface CampaignAnalysis {
  advertiser?: string;
  flight?: DateWindow;
  conversionLabel: { label: string; source: "planner" | "summary" | "column" | "default" };
  files: FileEntry[];
  totals: (Metrics & Derived) | null;
  totalsFrom?: string;
  reach: { reach: number; frequency: number | null } | null;
  breakdowns: BreakdownDigest[];
  series: SeriesDigest[];
  pacing: PacingDigest[];
  touches: Array<{ fileName: string; role: FileRole; summary: TouchSummary }>;
  attribution: AttributionDigest | null;
  warnings: Warning[];
}

export interface AnalyzeOptions {
  /** The flight the planner confirmed; otherwise the window most of the files share. */
  flight?: DateWindow;
  /** What the pixel conversion is (the exports never say); otherwise inferred or "conversions". */
  conversionLabel?: string;
  /**
   * A campaign still running: its reports cover the flight so far, not the whole flight, so a
   * file is in the campaign when its window falls inside the flight.
   */
  inFlight?: boolean;
}

export function derive(m: Metrics): Derived {
  return {
    // Conversions against no recorded spend have no cost per conversion, not a $0 one.
    cpa: (m.spend ?? 0) > 0 ? ratio(m.spend, m.conversions) : null,
    roas: ratio(m.revenue, m.spend),
    cpm: ratio(m.spend, m.impressions, 1000),
    ctr: ratio(m.clicks, m.impressions),
    vcr: ratio(m.videoCompletions, m.videoImpressions),
  };
}

/** Conversions per dollar against the whole report's, which is how the platform computes PM. */
export function performanceMultiplier(row: Metrics, totals: Metrics): number | null {
  const rowRate = ratio(row.conversions, row.spend);
  const totalRate = ratio(totals.conversions, totals.spend);
  return rowRate === null || totalRate === null || totalRate === 0 ? null : rowRate / totalRate;
}

const close = (a: number | undefined, b: number | undefined, tolerance = SAME_TOTAL) =>
  a !== undefined && b !== undefined && Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * tolerance + 1e-6;

export function analyzeCampaign(reports: Report[], options: AnalyzeOptions = {}): CampaignAnalysis {
  const warnings: Warning[] = [];
  const flight = options.flight ?? commonWindow(reports);
  const roleOf = (report: Report): FileRole => {
    if (!report.window) return "undated";
    if (!flight) return "campaign";
    if (report.kind === "touches" || options.inFlight) return withinWindow(report.window, flight) ? "campaign" : "reference";
    return sameWindow(report.window, flight) ? "campaign" : "reference";
  };
  const inCampaign = (report: Report) => roleOf(report) !== "reference";

  const files: FileEntry[] = reports.map((r) => ({
    fileName: r.fileName,
    kind: r.kind,
    role: roleOf(r),
    platform: r.platform,
    reportType: r.file.reportType,
    window: r.window,
    notes: r.kind === "unread" ? [r.reason, ...r.notes] : r.notes,
    ...(r.kind === "breakdown" ? { ratioChecks: r.ratioChecks, ignoredColumns: r.ignoredColumns } : {}),
  }));
  const pacingFiles = new Set(reports.filter((r) => r.kind === "summary" && r.pacing).map((r) => r.fileName));
  for (const f of files) {
    if (f.kind === "unread") warnings.push({ code: "unread-file", severity: "caution", fileName: f.fileName, message: `${f.fileName} could not be read: ${f.notes[0]}` });
    // Pacing always covers the whole insertion order; it gets its own note below.
    if (f.role === "reference" && f.window && flight && !pacingFiles.has(f.fileName)) {
      warnings.push({ code: "reference-window", severity: "info", fileName: f.fileName, message: `${label(f)} covers ${formatWindow(f.window)}, not the flight (${formatWindow(flight)}). It is reference only; its numbers are never combined with the campaign's.` });
    }
    if (f.role === "undated") warnings.push({ code: "undated", severity: "info", fileName: f.fileName, message: `${label(f)} has no dates; it is assumed to cover the flight.` });
  }

  // A live campaign is re-exported piecemeal; a report left from an earlier export disagrees with
  // the rest for no reason in the data, so it is named as out of date rather than left to look
  // like a reconciliation problem.
  if (options.inFlight) {
    const dated = files.filter((f) => f.role !== "reference" && f.window && f.kind !== "unread");
    const latest = dated.length ? Math.max(...dated.map((f) => f.window!.end)) : null;
    const stale = latest === null ? [] : dated.filter((f) => f.window!.end < latest - DAY_MS && !(f.kind === "summary" && reports.find((r) => r.fileName === f.fileName && r.kind === "summary" && r.pacing)));
    if (stale.length && latest !== null) {
      warnings.push({ code: "stale-export", severity: "caution", message: `${stale.map((f) => `${label(f)} (data to ${formatDay(f.window!.end)})`).join(", ")} ${stale.length === 1 ? "is" : "are"} from an earlier export than the rest (data to ${formatDay(latest)}). Re-export ${stale.length === 1 ? "it" : "them"} so every report covers the same days; until then, where ${stale.length === 1 ? "it disagrees" : "they disagree"} with the rest, the newer reports are right.` });
    }
  }

  const advertisers = [...new Set(reports.map((r) => r.file.advertiser).filter((a): a is string => !!a))];
  if (advertisers.length > 1) warnings.push({ code: "mixed-advertisers", severity: "problem", message: `The files name more than one advertiser (${advertisers.join(", ")}).` });

  const breakdownReports = reports.filter((r): r is BreakdownReport => r.kind === "breakdown");
  const campaignBreakdowns = breakdownReports.filter(inCampaign);
  const breakdowns = breakdownReports.map((r) => digestBreakdown(r, roleOf(r)));
  const anchor = breakdowns.find((b) => b.role !== "reference" && (b.totals.spend ?? 0) > 0);
  const cuts: string[] = [];
  for (const b of breakdowns) {
    if (!anchor || b === anchor || b.role === "reference") continue;
    const same = (["spend", "conversions", "impressions"] as const).every((k) => b.totals[k] === undefined || anchor.totals[k] === undefined || close(b.totals[k], anchor.totals[k]));
    if (same) {
      b.sharedTotals = true;
      anchor.sharedTotals = true;
      cuts.push(b.dimension);
    } else {
      warnings.push({ code: "totals-differ", severity: "caution", fileName: b.fileName, message: `${b.dimension} totals ${money(b.totals.spend)} spend and ${count(b.totals.conversions)} conversions, unlike ${anchor.dimension} (${money(anchor.totals.spend)}, ${count(anchor.totals.conversions)}). It may be filtered or partial; its shares are of its own total.` });
    }
  }
  if (anchor && cuts.length) {
    warnings.push({ code: "same-campaign-cuts", severity: "info", message: `${[anchor.dimension, ...cuts].join(", ")} each total ${money(anchor.totals.spend)} spend and ${count(anchor.totals.conversions)} conversions: they are different cuts of the same campaign and are never added together.` });
  }
  // The Publisher report lists non-CTV spend under its media type ("Display Retargeting"); those
  // rows are not publishers and must never be matched to the CTV publisher catalog.
  const mediaTypes = new Set(breakdowns.filter((b) => isMediaTypeDimension(b.dimension)).flatMap((b) => b.rows.map((r) => normalizeHeader(r.name))));
  for (const b of breakdowns.filter((b) => /publisher/i.test(b.dimension))) {
    for (const row of b.rows) if (mediaTypes.has(normalizeHeader(row.name))) row.flags.push("media-type-row");
  }
  ratioWarnings(campaignBreakdowns, breakdowns, warnings);
  rowWarnings(breakdowns, warnings);

  const series = reports.filter((r): r is SeriesReport => r.kind === "series").map((r) => digestSeries(r, roleOf(r)));
  const summaries = reports.filter((r): r is SummaryReport => r.kind === "summary");
  const pacing = summaries.filter((s) => s.pacing).map(digestPacing);

  let totals: Metrics | null = anchor?.totals ?? null;
  let totalsFrom = anchor?.fileName;
  const campaignSeries = reports.filter((r): r is SeriesReport => r.kind === "series" && inCampaign(r));
  if (!totals && campaignSeries.length) {
    totals = campaignSeries[0].finalTotals ?? sumPoints(campaignSeries[0]);
    totalsFrom = campaignSeries[0].fileName;
  }
  for (const s of campaignSeries) {
    const daily = sumPoints(s);
    if (totals && anchor && (["spend", "conversions"] as const).some((k) => daily[k] !== undefined && totals![k] !== undefined && !close(daily[k], totals![k]))) {
      warnings.push({ code: "series-differs", severity: "caution", fileName: s.fileName, message: `The daily report adds up to ${money(daily.spend)} and ${count(daily.conversions)} conversions, not the ${money(totals.spend)} and ${count(totals.conversions)} in ${anchor.dimension}.` });
    }
  }
  for (const s of series.filter((s) => s.cumulative)) {
    warnings.push({ code: "running-total", severity: "info", fileName: s.fileName, message: `The daily report is a running total (each row includes every day before it); it was converted to daily values.` });
  }

  const summaryResult = checkSummaries(summaries.filter((s) => !s.pacing && inCampaign(s)), totals, warnings);
  for (const p of pacing) {
    if (p.window && flight && !sameWindow(p.window, flight)) {
      warnings.push({ code: "pacing-window", severity: "info", fileName: p.fileName, message: `Pacing covers the insertion order, ${formatWindow(p.window)}, not the report window: ${money(p.spent)} spent of ${money(p.budget)}.` });
    }
    if (p.difference !== null && p.difference <= -5) {
      warnings.push({ code: "underpacing", severity: "caution", fileName: p.fileName, message: `The insertion order was pacing ${Math.abs(p.difference).toFixed(1)}% behind plan (${p.pacing?.toFixed(1)}% delivered against ${p.expected?.toFixed(1)}% expected).` });
    }
  }

  const touchReports = reports.filter((r): r is TouchReport => r.kind === "touches");
  const touches = touchReports.map((r) => ({ fileName: r.fileName, role: roleOf(r), summary: r.summary }));
  const attribution = joinAttribution(touchReports.filter(inCampaign), campaignBreakdowns, breakdowns, warnings);
  touchWarnings(touches, warnings);

  const conversionLabel = options.conversionLabel?.trim()
    ? { label: options.conversionLabel.trim(), source: "planner" as const }
    : summaryResult.conversionLabel
      ? { label: summaryResult.conversionLabel, source: "summary" as const }
      : anchor && campaignBreakdowns[0]?.conversionsHeader && normalizeHeader(campaignBreakdowns[0].conversionsHeader) !== "visits"
        ? { label: campaignBreakdowns[0].conversionsHeader, source: "column" as const }
        : { label: "conversions", source: "default" as const };

  return {
    ...(advertisers.length === 1 ? { advertiser: advertisers[0] } : {}),
    ...(flight ? { flight } : {}),
    conversionLabel,
    files,
    totals: totals ? { ...totals, ...derive(totals), ...(anchor ? { vcr: anchor.derived.vcr } : {}) } : null,
    ...(totalsFrom ? { totalsFrom } : {}),
    reach: summaryResult.reach,
    breakdowns,
    series,
    pacing,
    touches,
    attribution,
    warnings,
  };
}

/** The window most dated files share; the pacing report's IO window does not get a vote. */
function commonWindow(reports: Report[]): DateWindow | undefined {
  const votes: Array<{ window: DateWindow; count: number }> = [];
  for (const r of reports) {
    if (!r.window || (r.kind === "summary" && r.pacing) || r.kind === "touches") continue;
    const match = votes.find((v) => sameWindow(v.window, r.window!));
    if (match) match.count += r.kind === "breakdown" ? 2 : 1;
    else votes.push({ window: r.window, count: r.kind === "breakdown" ? 2 : 1 });
  }
  return votes.sort((a, b) => b.count - a.count)[0]?.window;
}

function digestBreakdown(report: BreakdownReport, role: FileRole): BreakdownDigest {
  const totals = report.totals;
  let compared = 0;
  let agreed = 0;
  const rows: DigestRow[] = report.rows.map((row) => {
    const m = row.metrics;
    const pm = performanceMultiplier(m, totals);
    if (row.exportedPm !== undefined && pm !== null) {
      compared++;
      if (Math.abs(row.exportedPm - pm) <= Math.max(0.001, pm * 0.005)) agreed++;
    }
    const spendShare = ratio(m.spend, totals.spend);
    const flags: RowFlag[] = [];
    if (m.conversions !== undefined && m.conversions < MIN_CONVERSIONS && (m.spend ?? 0) > 0) flags.push("low-sample");
    if (RETARGETING.test(row.name)) flags.push("retargeting");
    if (FED_BY_CTV.test(row.name)) flags.push("fed-by-ctv");
    if (EVENT.test(row.name)) flags.push("event");
    if ((m.conversions ?? 0) > 0 && !((m.spend ?? 0) > 0)) flags.push("conversions-without-spend");
    if (m.conversions === 0 && (spendShare ?? 0) >= NO_CONVERSION_SPEND_SHARE) flags.push("no-conversions");
    return { name: row.name, attributes: row.attributes, metrics: m, ...derive(m), spendShare, conversionShare: ratio(m.conversions, totals.conversions), pm, flags };
  });
  rows.sort((a, b) => (b.metrics.spend ?? 0) - (a.metrics.spend ?? 0));
  const pmCheck = { status: compared === 0 ? "unchecked" as const : agreed / compared >= 0.9 ? "verified" as const : "mismatch" as const, compared };
  // The platform fills VideoImpressions for display rows too, with no completions, which would
  // halve the completion rate; it is a rate over rows that ran video.
  const videoRows = report.rows.filter((r) => (r.metrics.videoCompletions ?? 0) > 0);
  const vcr = ratio(videoRows.reduce((s, r) => s + (r.metrics.videoCompletions ?? 0), 0), videoRows.reduce((s, r) => s + (r.metrics.videoImpressions ?? 0), 0));
  return { fileName: report.fileName, dimension: report.dimension, role, rows, totals, derived: { ...derive(totals), vcr }, pmCheck };
}

function ratioWarnings(reports: BreakdownReport[], digests: BreakdownDigest[], warnings: Warning[]) {
  const percent = new Set<string>();
  for (const r of reports) {
    for (const check of r.ratioChecks) {
      if (check.status === "verified" && check.scale === 100) percent.add(check.header);
      if (check.status === "mismatch") {
        warnings.push({ code: "ratio-mismatch", severity: "caution", fileName: r.fileName, message: `${r.dimension}: the ${check.header} column does not match ${check.header} recomputed from its own counts${check.scale ? ` at the expected scale` : ""}; the digest uses the recomputed value.` });
      }
    }
  }
  if (percent.size) warnings.push({ code: "percent-columns", severity: "info", message: `${[...percent].join(", ")} are written as percentages in the export (Roas 484 is 4.84x). The digest recomputes every ratio from counts.` });
  const ignored = new Set(reports.flatMap((r) => r.ignoredColumns));
  if (ignored.size) warnings.push({ code: "ignored-columns", severity: "info", message: `Not used: ${[...ignored].join(", ")}.` });
  for (const d of digests) {
    if (d.pmCheck.status === "mismatch") warnings.push({ code: "pm-mismatch", severity: "caution", fileName: d.fileName, message: `${d.dimension}: the export's PM does not match PM recomputed from spend and conversions; the digest uses the recomputed value.` });
  }
}

function rowWarnings(digests: BreakdownDigest[], warnings: Warning[]) {
  for (const d of digests.filter((d) => d.role !== "reference")) {
    const orphan = d.rows.filter((r) => r.flags.includes("conversions-without-spend"));
    if (orphan.length) {
      const n = orphan.reduce((sum, r) => sum + (r.metrics.conversions ?? 0), 0);
      warnings.push({ code: "conversions-without-spend", severity: "caution", fileName: d.fileName, message: `${d.dimension}: ${orphan.length} row(s) show ${count(n)} conversions with no recorded spend (${orphan.slice(0, 3).map((r) => r.name).join("; ")}). They have no CPA or PM.` });
    }
  }
  const byType = digests.find((d) => d.role !== "reference" && isMediaTypeDimension(d.dimension));
  const source = byType ?? digests.find((d) => d.role !== "reference" && d.rows.some((r) => r.flags.includes("retargeting")));
  if (!source) return;
  const retargeting = source.rows.filter((r) => r.flags.includes("retargeting"));
  if (retargeting.length === 0) return;
  const spend = retargeting.reduce((s, r) => s + (r.metrics.spend ?? 0), 0);
  const conversions = retargeting.reduce((s, r) => s + (r.metrics.conversions ?? 0), 0);
  warnings.push({
    code: "retargeting-credit",
    severity: "caution",
    fileName: source.fileName,
    message: `Retargeting (${source.dimension}: ${retargeting.slice(0, 3).map((r) => r.name).join("; ")}${retargeting.length > 3 ? "…" : ""}) took ${pct(ratio(spend, source.totals.spend))} of spend and ${pct(ratio(conversions, source.totals.conversions))} of conversions. Its audiences are built from earlier exposure, much of it CTV, and last-touch credit counts the conversion where it ended, so its efficiency is not a reason on its own to move budget into it.`,
  });
}

function digestSeries(report: SeriesReport, role: FileRole): SeriesDigest {
  const weeks: SeriesDigest["weeks"] = [];
  const first = report.points[0]?.day;
  for (const p of report.points) {
    const index = Math.floor((p.day - first) / (7 * DAY_MS));
    const week = (weeks[index] ??= { start: first + index * 7 * DAY_MS, days: 0, spend: 0, conversions: 0, cpa: null });
    week.days++;
    week.spend += p.metrics.spend ?? 0;
    week.conversions += p.metrics.conversions ?? 0;
  }
  for (const w of weeks.filter(Boolean)) w.cpa = ratio(w.spend, w.conversions);
  return { fileName: report.fileName, role, window: report.window, cumulative: report.cumulative, days: report.points.length, weeks: weeks.filter(Boolean) };
}

function sumPoints(report: SeriesReport): Metrics {
  const out: Metrics = {};
  for (const p of report.points) for (const [k, v] of Object.entries(p.metrics) as Array<[keyof Metrics, number]>) out[k] = (out[k] ?? 0) + v;
  return out;
}

const findValue = (s: SummaryReport, test: RegExp) => s.values.find((v) => test.test(v.metric))?.value ?? null;

function digestPacing(s: SummaryReport): PacingDigest {
  return {
    fileName: s.fileName,
    window: s.window,
    budget: findValue(s, /^budget$/i),
    spent: findValue(s, /spend|spent/i),
    pacing: findValue(s, /^current\s+pacing$/i),
    expected: findValue(s, /^expected\s+pacing$/i),
    difference: findValue(s, /pacing\s+difference/i),
  };
}

function checkSummaries(summaries: SummaryReport[], totals: Metrics | null, warnings: Warning[]) {
  let conversionLabel: string | undefined;
  let reach: CampaignAnalysis["reach"] = null;
  const campaignTotal = totals ? derive(totals) : null;
  for (const s of summaries) {
    for (const v of s.values) {
      if (v.value === null) continue;
      const name = v.metric.toLowerCase();
      const compare = (expected: number | null | undefined, what: string) => {
        if (expected === null || expected === undefined) return;
        if (!close(v.value!, expected, 0.01)) {
          warnings.push({ code: "summary-differs", severity: "caution", fileName: s.fileName, message: `${s.file.reportType ?? s.fileName} says ${v.metric} is ${v.raw}, but the breakdowns give ${what}.` });
        }
      };
      if (/^(spend|cost)$/.test(name)) compare(totals?.spend, money(totals?.spend));
      else if (/^impressions$/.test(name)) compare(totals?.impressions, count(totals?.impressions));
      else if (/^reach$/.test(name)) reach = { reach: v.value, frequency: reach?.frequency ?? null };
      else if (/^(avg\.?\s*)?frequency$/.test(name)) reach = { reach: reach?.reach ?? 0, frequency: v.value };
      else if (/^cpa$/.test(name)) compare(campaignTotal?.cpa, money(campaignTotal?.cpa, 2));
      else if (/^roas$/.test(name)) {
        if (v.value === 0 && (totals?.revenue ?? 0) > 0) {
          warnings.push({ code: "summary-roas-zero", severity: "caution", fileName: s.fileName, message: `${s.file.reportType ?? s.fileName} reports ROAS 0, but the rows carry ${money(totals?.revenue)} in revenue (${campaignTotal?.roas?.toFixed(2)}x). The digest uses revenue over spend.` });
        }
      } else if (/conversion/i.test(s.file.reportType ?? s.fileName) && totals?.conversions !== undefined) {
        // A conversions summary names the event ("Checkouts") even though the rows call it "Visits".
        if (close(v.value, totals.conversions, 0.001)) conversionLabel ??= v.metric;
        else compare(totals.conversions, `${count(totals.conversions)} conversions`);
      }
    }
  }
  if (reach && reach.reach > 0 && reach.frequency && totals?.impressions && !close(reach.reach * reach.frequency, totals.impressions, 0.01)) {
    warnings.push({ code: "reach-frequency", severity: "caution", message: `Reach × frequency (${count(reach.reach * reach.frequency)}) does not equal impressions (${count(totals.impressions)}).` });
  }
  return { conversionLabel, reach: reach && reach.reach > 0 ? reach : null };
}

function joinAttribution(touches: TouchReport[], campaignBreakdowns: BreakdownReport[], digests: BreakdownDigest[], warnings: Warning[]): AttributionDigest | null {
  if (touches.length === 0) return null;
  const touch = touches.find((t) => t.summary.attribution === "all-touch") ?? touches[0];
  const spendReport = campaignBreakdowns.find((b) => isMediaTypeDimension(b.dimension))
    ?? campaignBreakdowns.find((b) => b.rows.some((r) => touch.summary.byMediaType.some((m) => normalizeHeader(m.mediaType) === normalizeHeader(r.name))));
  if (!spendReport) {
    warnings.push({ code: "no-spend-for-touches", severity: "info", fileName: touch.fileName, message: `There is no media type report for the same window, so the touch-level conversions cannot be set against spend. Credit shares are still shown.` });
    return null;
  }
  const spendByType = new Map(spendReport.rows.map((r) => [normalizeHeader(r.name), r.metrics.spend ?? 0]));
  const matched = touch.summary.byMediaType.filter((m) => spendByType.has(normalizeHeader(m.mediaType)));
  const unmatched = touch.summary.byMediaType.filter((m) => !spendByType.has(normalizeHeader(m.mediaType)));
  if (unmatched.length) warnings.push({ code: "unmatched-media-types", severity: "info", fileName: touch.fileName, message: `No spend found for ${unmatched.map((m) => m.mediaType).join(", ")} in ${spendReport.dimension}.` });
  const spendTotal = matched.reduce((s, m) => s + (spendByType.get(normalizeHeader(m.mediaType)) ?? 0), 0);
  const lastTotal = matched.reduce((s, m) => s + m.lastTouch, 0);
  const linearTotal = matched.reduce((s, m) => s + m.linear, 0);
  const index = (credit: number, spend: number, total: number) => (spend > 0 && total > 0 && spendTotal > 0 ? credit / spend / (total / spendTotal) : null);
  const rows: AttributionRow[] = matched.map((m) => {
    const spend = spendByType.get(normalizeHeader(m.mediaType)) ?? 0;
    return {
      mediaType: m.mediaType,
      isCtv: m.isCtv,
      spend,
      spendShare: spendTotal ? spend / spendTotal : 0,
      lastTouch: m.lastTouch,
      anyTouch: m.anyTouch,
      linear: m.linear,
      cpaLastTouch: ratio(spend, m.lastTouch),
      cpaLinear: ratio(spend, m.linear),
      pmLastTouch: index(m.lastTouch, spend, lastTotal),
      pmLinear: index(m.linear, spend, linearTotal),
    };
  }).sort((a, b) => b.spend - a.spend);
  const reported = digests.find((d) => d.fileName === spendReport.fileName)?.totals.conversions;
  const coverage = reported ? touch.summary.conversions / reported : null;
  if (coverage !== null && Math.abs(coverage - 1) > 0.05) {
    warnings.push({ code: "touch-coverage", severity: "caution", fileName: touch.fileName, message: `The touch file has ${count(touch.summary.conversions)} conversions against ${count(reported)} in ${spendReport.dimension} (${pct(coverage)}). It may be a partial export or a different window; its CPAs use ${spendReport.dimension} spend and understate or overstate accordingly.` });
  }
  return { fileName: touch.fileName, spendFile: spendReport.fileName, coverage, rows };
}

function touchWarnings(touches: CampaignAnalysis["touches"], warnings: Warning[]) {
  // A reference file describes another campaign; its findings stay out of this one's notes.
  for (const t of touches.filter((t) => t.role !== "reference")) {
    const s = t.summary;
    for (const note of s.notes) warnings.push({ code: "touch-note", severity: "info", fileName: t.fileName, message: note });
    if (s.ctv && s.ctv.anyTouch > 0 && s.ctv.creditedElsewhere > 0) {
      warnings.push({ code: "ctv-credited-elsewhere", severity: "info", fileName: t.fileName, message: `${pct(s.ctv.anyTouch / s.conversions)} of conversions had a CTV exposure on the path; last-touch credit gave ${pct(s.ctv.creditedElsewhere / s.ctv.anyTouch)} of those to another media type.` });
    }
    if (s.bursts && s.bursts.conversions > 0) {
      warnings.push({ code: "frequency-bursts", severity: "caution", fileName: t.fileName, message: `${count(s.bursts.conversions)} converting household(s) received ${s.bursts.minTouches}+ impressions within ${s.bursts.windowMinutes} minutes (up to ${s.bursts.maxInWindow}), mostly ${s.bursts.byMediaType.map((b) => b.name).slice(0, 2).join(" and ")}. That points to a frequency cap or ad-stacking problem.` });
    }
  }
  const all = touches.find((t) => t.summary.attribution === "all-touch" && t.role !== "reference");
  const last = touches.find((t) => t.summary.attribution === "last-touch" && t.role !== "reference");
  if (all && last && Math.abs(all.summary.conversions - last.summary.conversions) > Math.max(1, last.summary.conversions * 0.02)) {
    warnings.push({ code: "touch-files-differ", severity: "caution", message: `The all-touch file has ${count(all.summary.conversions)} conversions and the last-touch file ${count(last.summary.conversions)}; one of them is partial.` });
  }
}

export const isMediaTypeDimension = (dimension: string) => /media\s*type|mediatype/i.test(dimension);

const label = (f: FileEntry) => f.reportType ?? f.fileName;

export const money = (value: number | null | undefined, decimals = 0) =>
  value === null || value === undefined ? "n/a" : `$${value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
export const count = (value: number | null | undefined) => (value === null || value === undefined ? "n/a" : Math.round(value).toLocaleString("en-US"));
export const pct = (value: number | null | undefined, decimals = 0) => (value === null || value === undefined ? "n/a" : `${(value * 100).toFixed(decimals)}%`);
