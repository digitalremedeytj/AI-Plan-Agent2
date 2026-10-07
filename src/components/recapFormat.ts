// Display helpers shared by the Campaign Recap section and its slides, so the plan and the deck
// always word and round the same figure the same way.

import type { RecapCampaign, RecapMetric, RecapRecommendation, RecapTile } from "../performance/recap";
import { activeTarget, kpiVsTarget, type KpiMetric, type RecapKpi } from "../performance/recapKpi";

/** "Checkouts" -> "checkout": the export's own name for a conversion, made singular for "cost per". */
export function singular(label: string): string {
  const lower = label.trim().toLowerCase();
  if (lower.endsWith("ies")) return `${lower.slice(0, -3)}y`;
  if (lower.endsWith("ses")) return lower.slice(0, -2);
  return lower.endsWith("s") ? lower.slice(0, -1) : lower;
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function compactNumber(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e4) return `${Math.round(value / 1e3)}K`;
  return Math.round(value).toLocaleString("en-US");
}

export function compactMoney(value: number): string {
  if (value >= 1e4) return `$${compactNumber(value)}`;
  // Cents only where they carry meaning: a $27.45 cost per checkout, not a $7,000 budget.
  if (value >= 100) return `$${Math.round(value).toLocaleString("en-US")}`;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const cpaText = (value: number | null) => (value === null ? "–" : compactMoney(value));
export const shareText = (value: number) => `${Math.round(value * 100)}%`;

export function tileText(tile: RecapTile, campaign: Pick<RecapCampaign, "conversionLabel" | "frequency" | "vcrIsCtv">): { value: string; label: string } {
  const label = campaign.conversionLabel || "conversions";
  const labels: Record<RecapMetric, string> = {
    spend: "Spend",
    impressions: "Impressions",
    reach: campaign.frequency ? `Reach · ${campaign.frequency.toFixed(1)}x frequency` : "Reach",
    conversions: capitalise(label),
    cpa: `Cost per ${singular(label)}`,
    roas: "Return on ad spend",
    vcr: campaign.vcrIsCtv ? "CTV video completion rate" : "Video completion rate",
  };
  const value = tile.metric === "spend" || tile.metric === "cpa"
    ? compactMoney(tile.value)
    : tile.metric === "roas" ? `${tile.value.toFixed(2)}x` : tile.metric === "vcr" ? `${Math.round(tile.value * 100)}%` : compactNumber(tile.value);
  return { value, label: labels[tile.metric] };
}

export function flightText(flight: RecapCampaign["flight"]): string {
  if (!flight) return "";
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return `${day(flight.start)} – ${day(flight.end)}`;
}

/** "Q1 Always On · Feb 9, 2026 – Mar 10, 2026", without the dates when the name already is them. */
export function campaignSubtitle(campaign: Pick<RecapCampaign, "name" | "flight">): string {
  const flight = flightText(campaign.flight);
  const start = flight.split(" – ")[0];
  return start && campaign.name.includes(start) ? campaign.name : [campaign.name, flight].filter(Boolean).join(" · ");
}

export const KIND_LABELS = { worked: "What worked", didnt: "What didn't", watch: "Worth knowing" } as const;

export const STRENGTH_LABELS = { strong: "Strong evidence", directional: "Directional", test: "Test and learn" } as const;
export const STRENGTH_HINTS = {
  strong: "A large sample, consistent across reports",
  directional: "Clear in the data, from one report or last-touch credit",
  test: "A small sample or one-off buy: worth testing, not betting on",
} as const;

export const percentText = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(1)}%`;

/** "≈ 583" for counts that come from a projection. */
export const approxCount = (value: number) => `≈ ${compactNumber(value)}`;

export const PROJECTION_FOOTNOTE = (label: string, includesCtv = false) =>
  `Projections apply last campaign's costs to this plan's budget: each range runs from the media type's own cost per ${singular(label)} to the campaign average. Not shown for retargeting, for media types with under 30 ${label.toLowerCase()}, or where the past cost was far from the average.${includesCtv ? " CTV uses last-touch credit, which understates what it contributes." : ""} Actual results will vary.`;

/** Whether any channel in a projection is CTV, whose last-touch figure needs saying so. */
export const projectsCtv = (names: string[]) => names.some((n) => /\b(ott|ctv|connected\s*tv)\b/i.test(n));

/** "≈ 554–656", or "≈ 600" when both ends round the same. */
export function approxRange(low: number, high: number): string {
  const a = compactNumber(low);
  const b = compactNumber(high);
  return a === b ? `≈ ${a}` : `≈ ${a}–${b}`;
}

/** A rough dollar amount for the funding line: "$1K", "$1.5K", "$600". */
export function roughMoney(value: number): string {
  if (value >= 1000) {
    const k = Math.round(value / 100) / 10;
    return `$${Number.isInteger(k) ? k : k.toFixed(1)}K`;
  }
  return `$${Math.max(50, Math.round(value / 50) * 50)}`;
}

/** The automatic rebalance as one line, e.g. "Funded by about $1K from each of 6 other media types". */
export function fundingText(summary: { count: number; each: number | null; total: number; from: boolean }): string {
  const others = `${summary.count} other media type${summary.count === 1 ? "" : "s"}`;
  if (summary.from) {
    return summary.each !== null && summary.count > 1
      ? `Funded by about ${roughMoney(summary.each)} from each of ${others}`
      : `Funded by about ${roughMoney(summary.total)} from ${others}`;
  }
  return summary.each !== null && summary.count > 1
    ? `About ${roughMoney(summary.each)} moved to each of ${others}`
    : `About ${roughMoney(summary.total)} moved to ${others}`;
}

// ---- The KPI ----

/** "373%" or "3.73x", as the brief writes ROAS. */
export function roasText(value: number, style: RecapKpi["roasStyle"] = "percent"): string {
  return style === "multiple" ? `${value.toFixed(2)}x` : `${Math.round(value * 100).toLocaleString("en-US")}%`;
}

/** The KPI's name in the client's words: "ROAS", "Cost per checkout", "Checkouts". */
export function kpiName(metric: KpiMetric, conversionLabel: string): string {
  const names: Record<KpiMetric, string> = {
    roas: "ROAS",
    cpa: `Cost per ${singular(conversionLabel || "conversions")}`,
    conversions: capitalise((conversionLabel || "conversions").toLowerCase()),
    reach: "Reach",
    vcr: "Video completion rate",
    ctr: "Click-through rate",
  };
  return names[metric];
}

/** What the big number is: "return on ad spend", "per checkout". */
export function kpiCaption(metric: KpiMetric, conversionLabel: string): string {
  const captions: Record<KpiMetric, string> = {
    roas: "return on ad spend",
    cpa: `cost per ${singular(conversionLabel || "conversions")}`,
    conversions: (conversionLabel || "conversions").toLowerCase(),
    reach: "households reached",
    vcr: "of video ads watched to the end",
    ctr: "click-through rate",
  };
  return captions[metric];
}

export function kpiValueText(metric: KpiMetric, value: number, style: RecapKpi["roasStyle"] = "percent"): string {
  if (metric === "roas") return roasText(value, style);
  if (metric === "cpa") return compactMoney(value);
  if (metric === "vcr") return `${Math.round(value * 100)}%`;
  if (metric === "ctr") return `${(value * 100).toFixed(2)}%`;
  return compactNumber(value);
}

/** "24% above target" when the KPI beat its target; nothing otherwise, the target line says enough. */
export function kpiBeatText(kpi: RecapKpi): string | null {
  const gap = kpiVsTarget(kpi);
  if (gap === null || gap < 0.005) return null;
  const pct = Math.round(gap * 100);
  if (pct < 1) return "On target";
  return kpi.metric === "cpa" ? `${pct}% below target cost` : `${pct}% above target`;
}

/** The target as the client reads it: "ROAS > 300%" becomes "300%". */
export function kpiTargetText(kpi: RecapKpi): string | null {
  const target = activeTarget(kpi);
  return target ? kpiValueText(kpi.metric, target.value, kpi.roasStyle) : null;
}

/** One plain sentence on what the KPI means in money or people, all figures from the recap. */
export function kpiSentence(campaign: Pick<RecapCampaign, "kpi" | "tiles" | "revenue" | "conversionLabel" | "frequency">): string | null {
  const kpi = campaign.kpi;
  const tile = (m: RecapMetric) => campaign.tiles.find((t) => t.metric === m)?.value ?? null;
  const spend = tile("spend");
  const conversions = tile("conversions");
  const cpa = tile("cpa");
  const label = (campaign.conversionLabel || "conversions").toLowerCase();
  if (!kpi) return null;
  if (kpi.metric === "roas" && campaign.revenue && spend) {
    return `Every $1 invested returned $${kpi.value.toFixed(2)} in tracked revenue: ${compactMoney(campaign.revenue)} from ${compactMoney(spend)}.`;
  }
  if ((kpi.metric === "cpa" || kpi.metric === "conversions") && conversions && cpa && spend) {
    return `${compactNumber(conversions)} ${label} at ${compactMoney(cpa)} each, from ${compactMoney(spend)} invested.`;
  }
  if (kpi.metric === "reach" && campaign.frequency) return `${compactNumber(kpi.value)} households reached, each about ${campaign.frequency.toFixed(1)} times on average.`;
  return null;
}

/** The recommendations' lead-in, worded toward the KPI and never as a verdict. */
export function recommendationsIntro(kpi: RecapKpi | null | undefined, conversionLabel: string): string {
  if (!kpi) return "To drive even stronger results in the next campaign, we recommend:";
  const name = kpi.metric === "roas" ? "ROAS" : kpiName(kpi.metric, conversionLabel).toLowerCase();
  const gap = kpiVsTarget(kpi);
  return gap !== null && gap < 0
    ? `To drive better performance towards the campaign's ${name} goal, we recommend:`
    : `To drive even stronger ${name} in the next campaign, we recommend:`;
}

/** What a recommendation does for the KPI, from its kind and evidence; never the model's words. */
export function kpiEffect(rec: RecapRecommendation, kpi: RecapKpi | null | undefined, conversionLabel: string): string | null {
  const kind = rec.kind ?? "change";
  if (rec.strength === "test") return "Finds the next lift";
  if (kind === "keep") return "Protects what works";
  if (kind === "execution") return "Sharpens delivery";
  if (!kpi) return null;
  if (kpi.metric === "roas") return "Lifts ROAS";
  if (kpi.metric === "cpa") return `Lowers cost per ${singular(conversionLabel || "conversions")}`;
  if (kpi.metric === "conversions") return `More ${(conversionLabel || "conversions").toLowerCase()}`;
  if (kpi.metric === "reach") return "Grows reach";
  return "Lifts results";
}

/**
 * A takeaway's stat split into a headline figure and the words around it:
 * "42% of checkouts from 9% of spend" -> "42%", "of checkouts", "from 9% of spend".
 * A stat that does not open with its figure is left whole.
 */
export function splitStat(stat: string): { figure: string; label: string; rest: string } | null {
  const m = /^(\$?\d[\d,]*(?:\.\d+)?\s?(?:%|x|×|[KMB]\b)?)\s*(.*)$/.exec(stat.trim());
  if (!m || !m[2]) return m ? { figure: m[1].trim(), label: "", rest: "" } : null;
  const tail = m[2];
  const cut = /\s(?=(?:from|at|vs\.?|versus|on|with|across|in|for|over|against)\s)|\s*[·,;(]\s*/i.exec(tail);
  const label = (cut ? tail.slice(0, cut.index) : tail).trim();
  const rest = (cut ? tail.slice(cut.index) : "").replace(/^\s*[·,;]\s*/, "").trim();
  // A long label reads better under the figure than beside it.
  return label.split(/\s+/).length > 4 ? { figure: m[1].trim(), label: "", rest: tail.trim() } : { figure: m[1].trim(), label, rest };
}
