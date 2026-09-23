// Builds audience estimates from national baselines. The model says how this audience differs
// from the nation - a relative index per bracket, 100 = same as national - and this module does
// the arithmetic, so an estimate keeps the real shape of its baseline (TV viewing peaking at
// 8-9 PM, a two-thirds adult majority over 35) and bends it only where the research gives a
// reason to.

import { NATIONAL_BASELINES, type NationalBaseline } from "../planning/knowledge/nationalBaselines";
import { PROFILE_CHARTS } from "./generationIntegrity";

export interface AudienceSkew {
  label: string;
  /** Relative likelihood versus the national baseline; 100 = same as national. */
  index: number;
  reason?: string;
}

// A skew outside this range is a claim that, say, an audience is 20x as likely to be 25-34 as
// the nation. That is not an estimate any research here supports, so it is clamped.
const MIN_SKEW = 10;
const MAX_SKEW = 600;

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * The chart points for one baseline adjusted by the audience skews, or null when the skews do
 * not cover exactly the baseline's brackets - a partial answer is not applied piecemeal.
 */
export function applyAudienceSkews(baseline: NationalBaseline, skews: AudienceSkew[] | undefined, sourceLabel: string): any[] | null {
  const labels = baseline.kind === "share" ? baseline.brackets.map((b) => b.label) : baseline.periods.map((p) => p.label);
  if (!Array.isArray(skews)) return null;
  const byLabel = new Map(skews.map((skew) => [String(skew?.label ?? "").trim().toLowerCase(), Number(skew?.index)]));
  const factors = labels.map((label) => byLabel.get(label.toLowerCase()));
  if (factors.some((factor) => factor === undefined || !Number.isFinite(factor) || factor <= 0)) return null;
  const clamped = (factors as number[]).map((factor) => Math.min(MAX_SKEW, Math.max(MIN_SKEW, factor)) / 100);

  const point = (label: string, key: "value" | "index", value: number) => ({
    [baseline.labelKey]: label,
    [key]: value,
    isModeled: true,
    source: sourceLabel,
  });

  if (baseline.kind === "share") {
    const raw = baseline.brackets.map((bracket, i) => bracket.share * clamped[i]);
    const total = raw.reduce((sum, value) => sum + value, 0);
    return baseline.brackets.map((bracket, i) => point(bracket.label, "value", round1((raw[i] / total) * 100)));
  }
  const raw = baseline.periods.map((period, i) => period.index * clamped[i]);
  const mean = raw.reduce((sum, value) => sum + value, 0) / raw.length;
  return baseline.periods.map((period, i) => point(period.label, "index", Math.round((raw[i] / mean) * 100)));
}

/**
 * Charts to rebuild from a baseline: ones with a baseline whose research did not fail and that
 * carry no research-sourced point (empty, or every point already labelled an estimate). A chart
 * with even one sourced figure keeps what the research reported.
 */
export function chartsNeedingBaselineEstimates(profile: any, failedDossiers: readonly string[]): string[] {
  return PROFILE_CHARTS
    .filter((chart) => NATIONAL_BASELINES[chart.id] && !failedDossiers.includes(chart.dossier))
    .filter((chart) => {
      const data = profile?.[chart.section]?.[chart.key];
      return !Array.isArray(data) || data.length === 0 || data.every((point: any) => point?.isModeled === true);
    })
    .map((chart) => chart.id);
}

/** Structured-output schema asking for one skew per bracket of each requested chart. */
export function audienceSkewSchema(chartIds: string[]): Record<string, unknown> {
  const skewArray = {
    type: "array",
    items: {
      type: "object",
      properties: {
        label: { type: "string", description: "The bracket or period label, exactly as given" },
        index: { type: "number", description: "This audience's likelihood relative to the national baseline; 100 = same as national, 150 = 1.5x, 60 = 0.6x" },
        reason: { type: "string", description: "One short clause citing the research that justifies the skew, or 'no audience-specific evidence' for 100" },
      },
      required: ["label", "index", "reason"],
    },
  };
  return {
    type: "object",
    properties: Object.fromEntries(chartIds.map((id) => [id, skewArray])),
    required: chartIds,
  };
}

/** The baseline brackets as prompt text, so the model skews the real national figures. */
export function describeBaselines(chartIds: string[]): string {
  return chartIds.map((id) => {
    const baseline = NATIONAL_BASELINES[id];
    const rows = baseline.kind === "share"
      ? baseline.brackets.map((b) => `${b.label}: ${b.share}% of U.S. adults`)
      : baseline.periods.map((p) => `${p.label}: index ${p.index}`);
    return `${id} (${baseline.source}):\n  ${rows.join("\n  ")}`;
  }).join("\n\n");
}
