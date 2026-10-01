// A live campaign against the plan it is running: how far through the flight it is, whether
// spend is keeping pace, each media type's delivery and cost per conversion against what the
// plan set, and which of the plan's CTV publishers are delivering. All of it is computed here,
// from the reconciled analysis, so ScoutAI reads settled figures and proposes mid-flight changes
// from them rather than doing the arithmetic itself.

import { matchChannel, matchPublisher } from "./matching";
import { isMediaTypeDimension, MIN_CONVERSIONS, money, count, pct, type CampaignAnalysis } from "./campaign";
import { ratio, type Metrics } from "./columns";
import { DAY_MS, formatDay, parseDate } from "./values";
import type { PerformanceSnapshot } from "../storage/types";

/** Below this share of planned spend to date a media type is under-delivering; above the other, over. */
const UNDER = 0.75;
const OVER = 1.25;
/** Too early in the flight to call a media type that has not started. */
const MIN_ELAPSED_FOR_NO_DELIVERY = 0.15;
/** Cost per conversion this far over target, on enough conversions, is worth acting on. */
const CPA_TOLERANCE = 1.15;
const TREND_DAYS = 7;

export interface KpiTarget {
  metric: "cpa" | "roas";
  value: number;
  /** The KPI as the planner wrote it. */
  text: string;
}

/** "Online sales at CPA under $30", "ROAS > 3.0". The first KPI that names a target wins. */
export function parseKpiTarget(kpis: string[]): KpiTarget | null {
  for (const text of kpis) {
    const cpa = /\b(?:cpa|cost per (?:acquisition|conversion|sale|order))\b[^$\d]{0,24}\$?\s?(\d+(?:\.\d+)?)/i.exec(text);
    if (cpa) return { metric: "cpa", value: Number(cpa[1]), text };
    const roas = /\broas\b[^\d]{0,16}(\d+(?:\.\d+)?)\s*(x|%)?/i.exec(text);
    if (roas) {
      const value = Number(roas[1]);
      // "ROAS 300%" is 3x; a bare ROAS above 20 is almost certainly a percentage too.
      return { metric: "roas", value: roas[2] === "%" || value > 20 ? value / 100 : value, text };
    }
  }
  return null;
}

export type ChannelStatus = "on-pace" | "under" | "over" | "not-delivering" | "not-started" | "off-plan";

export interface ChannelDelivery {
  channelId: string | null;
  name: string;
  /** Report media types counted toward it. */
  reportNames: string[];
  plannedPercent: number | null;
  plannedDollars: number | null;
  /** Planned dollars times the share of the flight elapsed. */
  expectedToDate: number | null;
  spend: number;
  conversions: number;
  revenue: number;
  /** Actual spend over expected spend to date. */
  delivery: number | null;
  cpa: number | null;
  roas: number | null;
  status: ChannelStatus;
  /** Under 30 conversions: its cost per conversion is not yet a basis for moving budget. */
  thinSample: boolean;
  aboveTarget: boolean;
}

export interface PublisherDelivery {
  name: string;
  spend: number;
  conversions: number;
  cpa: number | null;
  thinSample: boolean;
}

export interface PlanVsActual {
  asOf: string | null;
  flight: { start: string; end: string; days: number } | null;
  daysElapsed: number | null;
  elapsedShare: number | null;
  budget: number;
  spent: number;
  spendShare: number;
  /** Spend share over elapsed share: 1 is on pace. */
  pacing: number | null;
  /** Spent so far plus the last week's daily rate for the days left. A straight line, not a forecast. */
  projectedSpend: number | null;
  target: KpiTarget | null;
  actual: { cpa: number | null; roas: number | null; conversions: number; revenue: number };
  conversionLabel: string;
  channels: ChannelDelivery[];
  publishers: { inPlan: Array<PublisherDelivery & { planned: string }>; notDelivering: string[]; offPlan: PublisherDelivery[] } | null;
  weeks: CampaignAnalysis["series"][number]["weeks"];
  sinceLast: { from: string | null; spend: number; conversions: number; cpa: number | null } | null;
  notes: string[];
}

interface PlanInput {
  mediaPlan: any;
  kpis: string[];
  ctvPublishers: string[];
}

const sum = (rows: Metrics[], key: keyof Metrics) => rows.reduce((s, r) => s + (r[key] ?? 0), 0);

export function comparePlanToActual(analysis: CampaignAnalysis, plan: PlanInput, live: { flightStart: string | null; flightEnd: string | null; snapshots: PerformanceSnapshot[] }): PlanVsActual {
  const notes: string[] = [];
  const mediaPlan = plan.mediaPlan;
  const budget = Number(mediaPlan?.workingMediaBudget) || 0;
  const totals = analysis.totals;
  const spent = totals?.spend ?? 0;
  const target = parseKpiTarget(plan.kpis);
  if (!target) notes.push("No cost-per-conversion or ROAS target was found in the KPIs, so channels are not judged against one.");

  // As of the last day the in-flight reports cover.
  const windows = analysis.files.filter((f) => f.role !== "reference" && f.window && f.kind !== "summary").map((f) => f.window!);
  const asOfMs = windows.length ? Math.max(...windows.map((w) => w.end)) : null;
  const startMs = live.flightStart ? parseDate(live.flightStart) : windows.length ? Math.min(...windows.map((w) => w.start)) : null;
  const plannedDays = Number(mediaPlan?.flightDays) || null;
  const endMs = live.flightEnd ? parseDate(live.flightEnd) : startMs !== null && plannedDays ? startMs + (plannedDays - 1) * DAY_MS : null;
  const flightDays = startMs !== null && endMs !== null ? Math.round((endMs - startMs) / DAY_MS) + 1 : plannedDays;
  const daysElapsed = asOfMs !== null && startMs !== null ? Math.max(0, Math.min(flightDays ?? Infinity, Math.round((asOfMs - startMs) / DAY_MS) + 1)) : null;
  const elapsedShare = daysElapsed !== null && flightDays ? daysElapsed / flightDays : null;
  if (!live.flightStart) notes.push("The flight start was not set, so it is taken from the first day the reports cover.");
  const spendShare = budget > 0 ? spent / budget : 0;

  const series = analysis.series.find((s) => s.role !== "reference");
  let projectedSpend: number | null = null;
  const daily = seriesDays(analysis);
  if (daily.length && daysElapsed !== null && flightDays) {
    const recent = daily.slice(-TREND_DAYS);
    const rate = recent.reduce((s, d) => s + d, 0) / recent.length;
    projectedSpend = spent + rate * Math.max(0, flightDays - daysElapsed);
  }

  // Report media types onto the plan's channels.
  const catalog = (mediaPlan?.evaluatedCandidates || []).map((c: any) => ({ id: c.product.id, name: c.product.displayName, aliases: c.product.aliases || [] }));
  const planned: any[] = mediaPlan?.channels || [];
  const report = analysis.breakdowns.find((b) => b.role !== "reference" && isMediaTypeDimension(b.dimension));
  const byChannel = new Map<string, { names: string[]; rows: Metrics[] }>();
  const offPlan: ChannelDelivery[] = [];
  for (const row of report?.rows ?? []) {
    const match = matchChannel(row.name, catalog);
    if (match && planned.some((c) => c.channelId === match.id)) {
      const entry = byChannel.get(match.id) ?? { names: [], rows: [] };
      entry.names.push(row.name);
      entry.rows.push(row.metrics);
      byChannel.set(match.id, entry);
    } else if ((row.metrics.spend ?? 0) > 0) {
      offPlan.push(delivery(null, row.name, [row.name], null, null, null, [row.metrics], target, "off-plan"));
    }
  }
  if (!report) notes.push("There is no media type report, so delivery by media type cannot be compared with the plan.");

  const channels = planned.map((c) => {
    const entry = byChannel.get(c.channelId);
    const expected = elapsedShare !== null ? Number(c.allocationDollars) * elapsedShare : null;
    const rows = entry?.rows ?? [];
    const spend = sum(rows, "spend");
    let status: ChannelStatus = "on-pace";
    const ratioToDate = expected ? spend / expected : null;
    if (spend === 0) status = (elapsedShare ?? 0) >= MIN_ELAPSED_FOR_NO_DELIVERY ? "not-delivering" : "not-started";
    else if (ratioToDate !== null && ratioToDate < UNDER) status = "under";
    else if (ratioToDate !== null && ratioToDate > OVER) status = "over";
    return delivery(c.channelId, c.channelName, entry?.names ?? [], Number(c.allocationPercent), Number(c.allocationDollars), expected, rows, target, status);
  });

  // The plan's CTV publishers against the publisher report.
  let publishers: PlanVsActual["publishers"] = null;
  const pubReport = analysis.breakdowns.find((b) => b.role !== "reference" && /publisher/i.test(b.dimension));
  if (pubReport && plan.ctvPublishers.length) {
    const rows = pubReport.rows.filter((r) => !r.flags.includes("media-type-row"));
    // The platform can report one publisher under two names ("Pluto" and "Pluto TV"); both count
    // toward the plan's publisher.
    const grouped = new Map<string, { names: string[]; spend: number; conversions: number }>();
    for (const row of rows) {
      const p = matchPublisher(row.name, plan.ctvPublishers);
      if (!p) continue;
      const entry = grouped.get(p.name) ?? { names: [], spend: 0, conversions: 0 };
      entry.names.push(row.name);
      entry.spend += row.metrics.spend ?? 0;
      entry.conversions += row.metrics.conversions ?? 0;
      grouped.set(p.name, entry);
    }
    const matched = new Set(grouped.keys());
    const inPlan = [...grouped.entries()].map(([planned, e]) => ({
      planned,
      name: e.names.join(" + "),
      spend: e.spend,
      conversions: e.conversions,
      cpa: e.spend > 0 ? ratio(e.spend, e.conversions) : null,
      thinSample: e.conversions < MIN_CONVERSIONS,
    }));
    const offPlanPublishers = rows
      .filter((r) => !matchPublisher(r.name, plan.ctvPublishers) && (r.metrics.spend ?? 0) > 0)
      .map((r) => ({ name: r.name, spend: r.metrics.spend ?? 0, conversions: r.metrics.conversions ?? 0, cpa: r.cpa, thinSample: (r.metrics.conversions ?? 0) < MIN_CONVERSIONS }))
      .sort((a, b) => b.spend - a.spend);
    publishers = {
      inPlan: inPlan.sort((a, b) => b.spend - a.spend),
      notDelivering: plan.ctvPublishers.filter((p) => !matched.has(p)),
      offPlan: offPlanPublishers,
    };
  }

  const snapshots = live.snapshots;
  const previous = snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null;
  const sinceLast = previous && totals
    ? {
      from: previous.asOf,
      spend: (totals.spend ?? 0) - previous.spend,
      conversions: (totals.conversions ?? 0) - previous.conversions,
      cpa: ratio((totals.spend ?? 0) - previous.spend, (totals.conversions ?? 0) - previous.conversions),
    }
    : null;

  return {
    asOf: asOfMs !== null ? formatDay(asOfMs) : null,
    flight: startMs !== null && endMs !== null && flightDays ? { start: formatDay(startMs), end: formatDay(endMs), days: flightDays } : null,
    daysElapsed,
    elapsedShare,
    budget,
    spent,
    spendShare,
    pacing: elapsedShare ? spendShare / elapsedShare : null,
    projectedSpend,
    target,
    actual: { cpa: totals?.cpa ?? null, roas: totals?.roas ?? null, conversions: totals?.conversions ?? 0, revenue: totals?.revenue ?? 0 },
    conversionLabel: analysis.conversionLabel.label,
    channels: [...channels, ...offPlan],
    publishers,
    weeks: series?.weeks ?? [],
    sinceLast,
    notes,
  };
}

function seriesDays(analysis: CampaignAnalysis): number[] {
  // The digest keeps weekly buckets; the daily values are rebuilt from them only as an average,
  // which is all a straight-line projection needs.
  const series = analysis.series.find((s) => s.role !== "reference");
  if (!series) return [];
  return series.weeks.flatMap((w) => Array.from({ length: w.days }, () => w.spend / Math.max(1, w.days)));
}

function delivery(channelId: string | null, name: string, reportNames: string[], plannedPercent: number | null, plannedDollars: number | null, expected: number | null, rows: Metrics[], target: KpiTarget | null, status: ChannelStatus): ChannelDelivery {
  const spend = sum(rows, "spend");
  const conversions = sum(rows, "conversions");
  const revenue = sum(rows, "revenue");
  const cpa = spend > 0 ? ratio(spend, conversions) : null;
  const roas = ratio(revenue, spend);
  const thinSample = conversions < MIN_CONVERSIONS;
  const aboveTarget = Boolean(target && !thinSample && (target.metric === "cpa" ? cpa !== null && cpa > target.value * CPA_TOLERANCE : roas !== null && roas < target.value / CPA_TOLERANCE));
  return { channelId, name, reportNames, plannedPercent, plannedDollars, expectedToDate: expected, spend, conversions, revenue, delivery: expected ? spend / expected : null, cpa, roas, status, thinSample, aboveTarget };
}

const STATUS_TEXT: Record<ChannelStatus, string> = {
  "on-pace": "on pace",
  under: "under-delivering",
  over: "over-delivering",
  "not-delivering": "not delivering",
  "not-started": "not started yet",
  "off-plan": "not in the plan",
};

const dollars = (v: number | null) => (v === null ? "n/a" : money(v, v < 100 ? 2 : 0));

/** The comparison as ScoutAI reads it. */
export function renderPlanVsActual(p: PlanVsActual): string {
  const label = p.conversionLabel;
  const lines = [
    `LIVE CAMPAIGN vs PLAN (as of ${p.asOf ?? "the latest upload"}${p.flight ? `; flight ${p.flight.start} to ${p.flight.end}, ${p.flight.days} days` : ""}):`,
    p.daysElapsed !== null && p.flight ? `- Day ${p.daysElapsed} of ${p.flight.days} (${pct(p.elapsedShare)} of the flight).` : "",
    `- Spent ${money(p.spent)} of ${money(p.budget)} (${pct(p.spendShare)})${p.pacing !== null ? `: pacing ${pct(p.pacing)} of plan (100% is on pace)` : ""}.${p.projectedSpend !== null ? ` At the last week's daily rate it ends near ${money(p.projectedSpend)} (a straight line, not a forecast).` : ""}`,
    `- ${count(p.actual.conversions)} ${label} so far; CPA ${dollars(p.actual.cpa)}${p.actual.revenue > 0 && p.actual.roas !== null ? `; ROAS ${p.actual.roas.toFixed(2)}x` : ""}.${p.target ? ` Target: ${p.target.metric === "cpa" ? `CPA ${dollars(p.target.value)}` : `ROAS ${p.target.value.toFixed(2)}x`} ("${p.target.text}").` : ""}`,
    p.sinceLast ? `- Since the previous upload${p.sinceLast.from ? ` (data to ${p.sinceLast.from})` : ""}: ${money(p.sinceLast.spend)} spent, ${count(p.sinceLast.conversions)} ${label}, CPA ${dollars(p.sinceLast.cpa)}.` : "",
    "- By media type (planned share and dollars | expected to date | actual spend | delivery | conversions | CPA | status):",
    ...p.channels.map((c) => `  ${c.name}${c.channelId ? ` (channelId: ${c.channelId})` : ""}: ${c.plannedPercent !== null ? `${c.plannedPercent}% = ${money(c.plannedDollars)}` : "not planned"} | ${c.expectedToDate !== null ? money(c.expectedToDate) : "n/a"} | ${money(c.spend)} | ${c.delivery !== null ? pct(c.delivery) : "n/a"} | ${count(c.conversions)} | ${dollars(c.cpa)} | ${STATUS_TEXT[c.status]}${c.aboveTarget ? "; above target" : ""}${c.thinSample && c.spend > 0 ? "; under 30 conversions, too early to judge" : ""}${c.reportNames.length && c.reportNames.join() !== c.name ? ` [reported as ${c.reportNames.join(", ")}]` : ""}`),
  ];
  if (p.publishers) {
    const show = (d: PublisherDelivery) => `${d.name} ${money(d.spend)}, ${count(d.conversions)} ${label}, CPA ${dollars(d.cpa)}${d.thinSample ? " (thin)" : ""}`;
    lines.push(`- The plan's CTV publishers delivering: ${p.publishers.inPlan.map(show).join("; ") || "none"}`);
    if (p.publishers.notDelivering.length) lines.push(`- In the plan but not delivering: ${p.publishers.notDelivering.join(", ")}`);
    if (p.publishers.offPlan.length) lines.push(`- Delivering but not in the plan: ${p.publishers.offPlan.slice(0, 8).map(show).join("; ")}`);
  }
  if (p.weeks.length > 1) lines.push(`- By week: ${p.weeks.map((w) => `${formatDay(w.start)}${w.days < 7 ? ` (${w.days}d)` : ""} ${money(w.spend)}, CPA ${dollars(w.cpa)}`).join("; ")}`);
  lines.push(...p.notes.map((n) => `- NOTE: ${n}`));
  return lines.filter(Boolean).join("\n");
}
