// Display helpers shared by the Campaign Recap section and its slides, so the plan and the deck
// always word and round the same figure the same way.

import type { RecapCampaign, RecapMetric, RecapTile } from "../performance/recap";

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

export function tileText(tile: RecapTile, campaign: Pick<RecapCampaign, "conversionLabel" | "frequency">): { value: string; label: string } {
  const label = campaign.conversionLabel || "conversions";
  const labels: Record<RecapMetric, string> = {
    spend: "Spend",
    impressions: "Impressions",
    reach: campaign.frequency ? `Reach · ${campaign.frequency.toFixed(1)}x frequency` : "Reach",
    conversions: capitalise(label),
    cpa: `Cost per ${singular(label)}`,
    roas: "Return on ad spend",
  };
  const value = tile.metric === "spend" || tile.metric === "cpa"
    ? compactMoney(tile.value)
    : tile.metric === "roas" ? `${tile.value.toFixed(2)}x` : compactNumber(tile.value);
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
