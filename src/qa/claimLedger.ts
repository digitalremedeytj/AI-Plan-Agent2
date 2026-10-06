// The number check. Every figure written in the plan's prose is traced to where it came from:
// the research dossiers, a chart, or the plan's own inputs (budget, flight, allocations). What
// traces nowhere is listed as not found.
//
// The auditor used to judge "unsupported" from memory, without the research in front of it.
// Live runs deleted figures that were in the dossiers ("66% view pets as family", "12+ million
// households keep fish, birds or reptiles") and kept ones that were not. This gives the auditor,
// and the narrative writer, the facts instead.
//
// A match means the same number, in the same kind of unit, appears in the research. It does not
// prove the prose uses it for the same claim, so each research match carries the sentence it was
// found in for the auditor to judge. Units are matched strictly for that reason: a bare 36 turns
// up in any long research text, a "36%" much more rarely.

import { PROFILE_CHARTS } from "./generationIntegrity";
import { hasPublisherHighlights, publisherHighlightFields } from "../planning/publisherHighlights";

export type ClaimOwner = "narrative" | "personas" | "publisherRationale" | "channelStrategy";
export type ClaimUnit = "percent" | "money" | "count" | "multiplier" | "plain";
export type ClaimStatus = "research" | "chart" | "plan" | "not_found";

export interface ClaimEntry {
  path: string;
  owner: ClaimOwner;
  /** The figure as written, e.g. "36%", "$2,351", "71 million". */
  raw: string;
  value: number;
  unit: ClaimUnit;
  status: ClaimStatus;
  /** The prose around the figure. */
  context: string;
  /** For research matches: which dossier, and the sentence it appears in. */
  dossier?: string;
  researchContext?: string;
}

export interface ProseField {
  path: string;
  owner: ClaimOwner;
  text: string;
}

export interface ResearchDossierText {
  label: string;
  text: string;
}

const str = (value: unknown) => (typeof value === "string" ? value : "");

// Workbook and rule evidence is catalog text, not a claim about the audience.
const CATALOG_EVIDENCE = new Set(["digital_remedy_workbook", "digital_remedy_rule", "brief"]);

/** Every piece of free text in the plan that can carry a claim, with who is allowed to fix it. */
export function collectProse(profile: any): ProseField[] {
  const fields: ProseField[] = [];
  const add = (path: string, owner: ClaimOwner, value: unknown) => {
    const text = str(value).trim();
    if (text) fields.push({ path, owner, text });
  };
  for (const key of ["intro", "executiveSummary", "audienceAnalysis"]) add(key, "narrative", profile?.[key]);
  // The panel shows the highlights when a plan has them; the paragraph only for older plans.
  if (hasPublisherHighlights(profile)) publisherHighlightFields(profile).forEach((f) => add(f.path, "narrative", f.text));
  else add("publisherInsights", "narrative", profile?.publisherInsights);
  (profile?.takeaways || []).forEach((t: unknown, i: number) => add(`takeaways[${i}]`, "narrative", t));
  (profile?.recommendations || []).forEach((r: any, i: number) => {
    for (const key of ["title", "action", "why"]) add(`recommendations[${i}].${key}`, "narrative", r?.[key]);
  });
  add("demographics.overview", "narrative", profile?.demographics?.overview);
  add("demographics.geographyNotes", "narrative", profile?.demographics?.geographyNotes);
  add("browserAndReach.overview", "narrative", profile?.browserAndReach?.overview);
  add("deviceTypeIndex.overview", "narrative", profile?.deviceTypeIndex?.overview);
  add("temporalPatterns.overview", "narrative", profile?.temporalPatterns?.overview);
  add("temporalPatterns.activationNotes", "narrative", profile?.temporalPatterns?.activationNotes);
  // Age and income are the persona's defining brackets, not claims about the research.
  (profile?.personas || []).forEach((p: any, i: number) => {
    for (const key of ["gender", "watch", "browse", "buy", "narrative"]) add(`personas[${i}].${key}`, "personas", p?.[key]);
  });
  (profile?.ctvPublishers || []).forEach((p: any, i: number) => add(`ctvPublishers[${i}].why`, "publisherRationale", p?.why));
  (profile?.channelStrategy?.mediaPlan?.channels || []).forEach((c: any, i: number) => {
    const base = `channelStrategy.mediaPlan.channels[${i}]`;
    // Decision rules are thresholds the plan sets ("pause below 75% completion"), not claims.
    for (const key of ["gapAddressed", "allocationRationale"]) add(`${base}.${key}`, "channelStrategy", c?.[key]);
    (c?.tradeoffs || []).forEach((t: unknown, j: number) => add(`${base}.tradeoffs[${j}]`, "channelStrategy", t));
    (c?.evidence || []).forEach((e: any, j: number) => {
      if (!CATALOG_EVIDENCE.has(e?.sourceType)) add(`${base}.evidence[${j}].detail`, "channelStrategy", e?.detail);
    });
  });
  return fields;
}

interface FoundNumber {
  raw: string;
  value: number;
  unit: ClaimUnit;
  index: number;
}

const NUMBER = /(\$\s?)?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(\s*(?:%|percent\b|(?:million|billion|trillion)\b|[MBK]\b|x\b))?/gi;

/** The figures in a piece of text that are worth tracing. Years, times, ages and small counts are not. */
export function extractFigures(text: string): FoundNumber[] {
  const found: FoundNumber[] = [];
  NUMBER.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = NUMBER.exec(text))) {
    const [raw, dollar, digits, suffix = ""] = match;
    const value = Number(digits.replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    const before = text.slice(Math.max(0, match.index - 3), match.index);
    const after = text.slice(match.index + raw.length, match.index + raw.length + 8);
    const s = suffix.trim().toLowerCase();
    let unit: ClaimUnit = dollar ? "money" : s === "%" || s === "percent" ? "percent" : ["million", "billion", "trillion", "m", "b", "k"].includes(s) ? (dollar ? "money" : "count") : s === "x" ? "multiplier" : "plain";
    // "84–91%": the first end of a percentage range is a percentage too.
    if (unit === "plain" && /^\s*[-–]\s*\d+(?:\.\d+)?\s*(?:%|percent)/i.test(after)) unit = "percent";
    if (unit === "plain") {
      if (value < 10) continue;
      if (Number.isInteger(value) && value >= 1900 && value <= 2100) continue; // a year
      if (/^\s*(?::\d{2}|(?:a\.?m|p\.?m)\b)/i.test(after) || /:\s?$/.test(before)) continue; // a time
      if (/^(?:-|\s)?(?:day|days|hour|hours|week|weeks|month|months|minute|minutes|second|seconds|sec\b|s\b|th\b|st\b|nd\b|rd\b|\+)/i.test(after)) continue; // "30-day", "1990s", "55+"
      if (/^\s*[-–]\s*\d/.test(after) || /\d\s*[-–]\s*$/.test(before)) continue; // an age or hour range, "25–34"
    }
    found.push({ raw: raw.trim(), value, unit, index: match.index });
  }
  return found;
}

const snippet = (text: string, index: number, radius: number) => {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return `${start > 0 ? "..." : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "..." : ""}`;
};

// A claim matches to the precision it is written at: "66.5%" needs 66.46-66.54, not a nearby
// "66%"; a whole "36%" accepts a reported 36.4. Money and counts allow a sliver for rounding.
const decimalsOf = (raw: string) => (raw.match(/\.(\d+)/)?.[1].length ?? 0);
const close = (claim: number, other: number, unit: ClaimUnit, raw = "") => {
  if (unit === "percent" || unit === "plain" || unit === "multiplier") {
    const decimals = decimalsOf(raw);
    return Math.abs(claim - other) <= (decimals > 0 ? 0.51 * 10 ** -decimals : 0.5);
  }
  return Math.abs(claim - other) <= Math.max(0.05, Math.abs(other) * 0.005);
};

const WORD = /[a-z]{4,}/g;
const wordsNear = (text: string, index: number) => new Set((text.slice(Math.max(0, index - 80), index + 80).toLowerCase().match(WORD) || []));
const overlap = (a: Set<string>, b: Set<string>) => [...a].filter((word) => b.has(word)).length;

function planFigures(profile: any, planInputs: { workingMediaBudget?: number; flightDays?: number | null }): Array<{ value: number; unit: ClaimUnit }> {
  const figures: Array<{ value: number; unit: ClaimUnit }> = [];
  const budget = Number(planInputs.workingMediaBudget);
  if (budget > 0) figures.push({ value: budget, unit: "money" }, { value: budget / 1000, unit: "money" });
  if (Number(planInputs.flightDays) > 0) figures.push({ value: Number(planInputs.flightDays), unit: "plain" });
  for (const channel of profile?.channelStrategy?.mediaPlan?.channels || []) {
    if (Number.isFinite(channel?.allocationPercent)) figures.push({ value: channel.allocationPercent, unit: "percent" });
    if (Number.isFinite(channel?.allocationDollars)) figures.push({ value: channel.allocationDollars, unit: "money" }, { value: channel.allocationDollars / 1000, unit: "money" });
  }
  return figures;
}

function chartFigures(profile: any): number[] {
  const values: number[] = [];
  for (const chart of PROFILE_CHARTS) {
    for (const point of profile?.[chart.section]?.[chart.key] || []) {
      const value = Number(point?.value ?? point?.index);
      if (Number.isFinite(value)) values.push(value);
    }
  }
  return values;
}

/** Traces every figure in the plan's prose. */
export function buildClaimLedger(
  profile: any,
  dossiers: ResearchDossierText[],
  planInputs: { workingMediaBudget?: number; flightDays?: number | null } = {},
): ClaimEntry[] {
  const researchFigures = dossiers.flatMap((dossier) => extractFigures(dossier.text).map((figure) => ({ ...figure, dossier })));
  const charts = chartFigures(profile);
  const plan = planFigures(profile, planInputs);
  const entries: ClaimEntry[] = [];

  for (const field of collectProse(profile)) {
    for (const figure of extractFigures(field.text)) {
      const base = { path: field.path, owner: field.owner, raw: figure.raw, value: figure.value, unit: figure.unit, context: snippet(field.text, figure.index, 90) };
      // "100%" is nearly always "sums to 100%", not a claim.
      if (figure.unit === "percent" && figure.value === 100) continue;
      if (plan.some((p) => (p.unit === figure.unit || figure.unit === "plain") && close(figure.value, p.value, figure.unit, figure.raw))) {
        entries.push({ ...base, status: "plan" });
        continue;
      }
      // Of the research occurrences of this figure, the one whose surrounding words best match the
      // claim's; a bare number must share at least two words with it, or it is chance.
      const claimWords = wordsNear(field.text, figure.index);
      const inResearch = researchFigures
        .filter((r) => r.unit === figure.unit && close(figure.value, r.value, figure.unit, figure.raw))
        .map((r) => ({ r, score: overlap(claimWords, wordsNear(r.dossier.text, r.index)) }))
        .filter(({ score }) => figure.unit !== "plain" || score >= 2)
        .sort((a, b) => b.score - a.score || Math.abs(a.r.value - figure.value) - Math.abs(b.r.value - figure.value))[0]?.r;
      if (inResearch) {
        entries.push({ ...base, status: "research", dossier: inResearch.dossier.label, researchContext: snippet(inResearch.dossier.text, inResearch.index, 140) });
        continue;
      }
      if ((figure.unit === "percent" || figure.unit === "plain") && charts.some((value) => close(figure.value, value, figure.unit, figure.raw))) {
        entries.push({ ...base, status: "chart" });
        continue;
      }
      entries.push({ ...base, status: "not_found" });
    }
  }
  return entries;
}

/** The ledger as the auditor and narrative writer read it: what traced, and what did not. */
export function formatClaimLedger(entries: ClaimEntry[], { maxResearch = 40 } = {}): string {
  if (entries.length === 0) return "NUMBER CHECK: the prose contains no figures to trace.";
  const notFound = entries.filter((e) => e.status === "not_found");
  const research = entries.filter((e) => e.status === "research");
  const counts = (["research", "chart", "plan", "not_found"] as const).map((s) => `${entries.filter((e) => e.status === s).length} ${s.replace("_", " ")}`).join(", ");
  const lines = [`NUMBER CHECK (${entries.length} figures: ${counts}). Computed by code against the research dossiers, the charts and the plan's own figures.`];
  if (notFound.length > 0) {
    lines.push("", "NOT FOUND in the research, the charts or the plan inputs:");
    for (const e of notFound) lines.push(`- [${e.path}] ${e.raw}: "${e.context}"`);
  }
  if (research.length > 0) {
    lines.push("", "FOUND IN RESEARCH (check the prose uses it for the same claim as the research does):");
    for (const e of research.slice(0, maxResearch)) lines.push(`- [${e.path}] ${e.raw} -> ${e.dossier}: "${e.researchContext}"`);
    if (research.length > maxResearch) lines.push(`- ...and ${research.length - maxResearch} more research matches.`);
  }
  return lines.join("\n");
}
