// Plain-text views of the settled parts of a plan, shared by every model that reads the plan
// after they are built: the narrative writer, the auditor, the fixer and the verifier. One
// description, so no step reads the charts or the channel plan differently from another.
//
// Charts carry where their numbers came from and what they measure. That was the root of
// several live-run contradictions: the day and hour charts are TV-viewing baselines, and prose
// written before they existed used them to time shopping and search.

import { PROFILE_CHARTS } from "./generationIntegrity";

export type ChartProvenance = "research" | "national-baseline" | "estimate" | "empty";

const WHAT_IT_MEASURES: Record<string, string> = {
  age: "share of this audience by age bracket (sums to 100)",
  gender: "share of this audience by gender (sums to 100)",
  income: "share of this audience by household income (sums to 100)",
  domains: "affinity index against the average internet user (100 = average)",
  device: "share of this audience's device usage occasions (sums to 100)",
  dayOfWeek: "relative activity index by day (100 = average)",
  hourOfDay: "relative activity index by time of day (100 = average)",
};

const BASELINE_SOURCE = /census bureau|bureau of labor statistics|american time use survey/i;

export function chartProvenance(points: any[]): ChartProvenance {
  if (!Array.isArray(points) || points.length === 0) return "empty";
  if (points.some((p) => BASELINE_SOURCE.test(String(p?.source ?? "")))) return "national-baseline";
  return points.every((p) => p?.isModeled !== true) ? "research" : "estimate";
}

const labelOf = (point: any) => point?.range ?? point?.gender ?? point?.bracket ?? point?.domain ?? point?.device ?? point?.day ?? point?.hour ?? "?";

/** Every chart: what it measures, where its numbers came from, and the values as shown. */
export function describeCharts(profile: any): string {
  const lines = ["CHARTS (settled before this step; quote their values exactly and describe them for what they measure):"];
  for (const chart of PROFILE_CHARTS) {
    const points = profile?.[chart.section]?.[chart.key];
    const provenance = chartProvenance(points);
    if (provenance === "empty") {
      lines.push(`- ${chart.label} [${chart.id}]: no data - the research did not report it. Do not describe numbers for it.`);
      continue;
    }
    const isTime = chart.id === "dayOfWeek" || chart.id === "hourOfDay";
    const measures = provenance === "national-baseline" && isTime
      ? "relative TV-viewing index (100 = average) - national TV-viewing time adjusted for this audience; it describes when they watch TV, not when they shop, search or browse"
      : WHAT_IT_MEASURES[chart.id];
    const source = String(points[0]?.source ?? profile?.[chart.section]?.chartSource ?? "").slice(0, 160);
    const origin = provenance === "research"
      ? `research figures (${source})`
      : provenance === "national-baseline"
        ? `ScoutAI estimate: U.S. national baseline adjusted for this audience (${source})`
        : `ScoutAI estimate, labelled as estimated in the plan (${source})`;
    const values = points.map((p: any) => `${labelOf(p)} ${p?.value ?? p?.index}`).join(", ");
    lines.push(`- ${chart.label} [${chart.id}]: ${measures}. Source: ${origin}. Values: ${values}.`);
  }
  return lines.join("\n");
}

const names = (records: any[] | undefined) => (records || []).map((r) => r?.displayName).filter(Boolean).join(", ");

/** The engine's channel plan, compactly: what each channel is for and what it carries. */
export function describeChannelPlan(profile: any): string {
  const plan = profile?.channelStrategy?.mediaPlan;
  const channels: any[] = plan?.channels || [];
  if (channels.length === 0) {
    return "CHANNEL PLAN: none. This plan was generated without a working-media budget, so it has no channel allocation.";
  }
  const lines = [
    `CHANNEL PLAN (built by Digital Remedy's planning engine from its product catalog; it owns budget, channel selection, tactics and measurement. $${Number(plan.workingMediaBudget || 0).toLocaleString()} over ${plan.flightDays ?? "?"} days):`,
  ];
  for (const c of channels) {
    const parts = [
      `${c.allocationPercent}% ($${Number(c.allocationDollars || 0).toLocaleString()})`,
      c.role ? `role: ${c.role}` : "",
      c.status ? `status: ${c.status}` : "",
      names(c.targetingTactics) ? `targeting: ${names(c.targetingTactics)}` : "",
      names(c.measurementCapabilities) ? `measurement: ${names(c.measurementCapabilities)}` : "",
      names(c.publishers) ? `publishers: ${names(c.publishers)}` : "",
    ].filter(Boolean);
    lines.push(`- ${c.channelName}: ${parts.join("; ")}.`);
    if (c.gapAddressed) lines.push(`  Why: ${c.gapAddressed}`);
    if (c.allocationRationale) lines.push(`  Allocation rationale: ${c.allocationRationale}`);
  }
  return lines.join("\n");
}

/** The personas as the later steps need them: who each one is, briefly. */
export function describePersonas(profile: any): string {
  const personas: any[] = profile?.personas || [];
  if (personas.length === 0) return "PERSONAS: none.";
  return ["PERSONAS (settled; refer to them by name):", ...personas.map((p, i) =>
    `- [${i}] ${p?.name} (${[p?.age, p?.gender, p?.income].filter(Boolean).join("; ")}). Watches: ${p?.watch || "-"}. Buys: ${p?.buy || "-"}.`,
  )].join("\n");
}

/** Research text for a prompt, each dossier capped so the whole stays a predictable size. */
export function researchForPrompt(dossiers: Array<{ label: string; text: string; failed?: boolean }>, maxPerDossier: number): string {
  return dossiers.map((d) =>
    `=== RESEARCH DOSSIER: ${d.label} ===\n${d.failed || !d.text ? "(this research did not complete)" : d.text.slice(0, maxPerDossier)}`,
  ).join("\n\n");
}
