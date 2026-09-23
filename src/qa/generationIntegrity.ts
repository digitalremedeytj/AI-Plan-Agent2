// A plan either shows what the research and the models actually produced, or it says plainly
// what failed. It never fills a gap with something that merely looks like an answer: no
// placeholder personas, no modeled or "industry baseline" numbers, no canned publisher lists.
// A plan that shows a gap is honest; a plan that fills one quietly is one a planner may
// present to a client without knowing half of it was invented.
//
// These helpers enforce that on the generated profile after synthesis and again after
// auto-remediation (which can reintroduce what the first pass removed). Each one mutates the
// profile in place and returns the alerts the plan must carry, so the UI can show them.

import type { GenerationAlert } from "../types";

export type { GenerationAlert };

export const RESEARCH_DOSSIERS = ["Demographics", "Digital Touchpoints", "CTV & Devices", "Temporal & Purchase"] as const;
export type ResearchDossier = (typeof RESEARCH_DOSSIERS)[number];

interface ChartSpec {
  section: "demographics" | "browserAndReach" | "deviceTypeIndex" | "temporalPatterns";
  key: string;
  label: string;
  dossier: ResearchDossier;
}

export const PROFILE_CHARTS: ChartSpec[] = [
  { section: "demographics", key: "ageChartData", label: "Age distribution", dossier: "Demographics" },
  { section: "demographics", key: "genderChartData", label: "Gender split", dossier: "Demographics" },
  { section: "demographics", key: "incomeChartData", label: "Household income", dossier: "Demographics" },
  { section: "browserAndReach", key: "chartData", label: "Top domain affinity", dossier: "Digital Touchpoints" },
  { section: "deviceTypeIndex", key: "chartData", label: "Device split", dossier: "CTV & Devices" },
  { section: "temporalPatterns", key: "dayOfWeekChartData", label: "Day-of-week activity", dossier: "Temporal & Purchase" },
  { section: "temporalPatterns", key: "hourOfDayChartData", label: "Hour-of-day activity", dossier: "Temporal & Purchase" },
];

// The source labels the model used for invented values before modeled data was banned.
// Matched as phrases so a real publisher that happens to sell "benchmarks" is not caught.
const MODELED_SOURCE = /\bmodel(?:l)?ed\b|\bplanning proxy\b|\bdirectional estimate\b|\bindustry baseline\b|\bplanning assumption\b/i;

export function isModeledPoint(point: any): boolean {
  return point?.isModeled === true || MODELED_SOURCE.test(String(point?.source ?? ""));
}

/** Adds an alert unless an identical one is already present. */
export function pushAlert(alerts: GenerationAlert[], alert: GenerationAlert): void {
  if (!alerts.some((a) => a.section === alert.section && a.message === alert.message)) alerts.push(alert);
}

/**
 * A failed research dossier means nothing downstream is grounded for its topic, so every chart
 * and paragraph that topic feeds is cleared rather than left to whatever synthesis guessed.
 */
export function clearSectionsForFailedDossiers(profile: any, failed: readonly string[]): GenerationAlert[] {
  const alerts: GenerationAlert[] = [];
  for (const dossier of failed) {
    const charts = PROFILE_CHARTS.filter((chart) => chart.dossier === dossier);
    for (const chart of charts) {
      const section = profile?.[chart.section];
      if (!section || typeof section !== "object") continue;
      section[chart.key] = [];
      for (const [field, value] of Object.entries(section)) {
        if (typeof value === "string") section[field] = "";
      }
    }
    const sections = [...new Set(charts.map((chart) => chart.section))];
    pushAlert(alerts, {
      section: sections[0] ?? "research",
      severity: "failed",
      message: `${dossier} research failed, so ${charts.map((chart) => chart.label.toLowerCase()).join(", ")} ${charts.length === 1 ? "is" : "are"} not shown.`,
    });
  }
  return alerts;
}

/**
 * Removes any chart carrying a modeled or estimated value. The whole chart goes, not just the
 * point: a composition missing one slice no longer sums to anything meaningful, and an index
 * chart with a hole invites the reader to assume the gap is average.
 */
export function removeModeledCharts(profile: any): GenerationAlert[] {
  const alerts: GenerationAlert[] = [];
  for (const chart of PROFILE_CHARTS) {
    const data = profile?.[chart.section]?.[chart.key];
    if (!Array.isArray(data) || data.length === 0) continue;
    if (data.some(isModeledPoint)) {
      profile[chart.section][chart.key] = [];
      pushAlert(alerts, {
        section: chart.section,
        severity: "not_found",
        message: `${chart.label}: removed because it contained modeled or estimated values rather than figures from the research.`,
      });
    }
  }
  return alerts;
}

// Normalizes a source label so trivial differences ("Pew Research 2025" vs "pew research 2025.")
// do not read as two sources.
const normalizeSource = (source: unknown) => String(source ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Removes any chart whose items cite more than one source. A composition assembled from
 * several studies has no common denominator, so it is not a real split however carefully each
 * number was copied; synthesis is told to use one source per chart, and this enforces it.
 */
export function removeMixedSourceCharts(profile: any): GenerationAlert[] {
  const alerts: GenerationAlert[] = [];
  for (const chart of PROFILE_CHARTS) {
    const data = profile?.[chart.section]?.[chart.key];
    if (!Array.isArray(data) || data.length === 0) continue;
    const sources = new Set(data.map((point: any) => normalizeSource(point?.source)));
    if (sources.size > 1 || sources.has("")) {
      profile[chart.section][chart.key] = [];
      pushAlert(alerts, {
        section: chart.section,
        severity: "not_found",
        message: sources.has("")
          ? `${chart.label}: removed because some values did not name their source.`
          : `${chart.label}: removed because it combined figures from ${sources.size} different sources instead of one study's breakdown.`,
      });
    }
  }
  return alerts;
}

/**
 * Charts the synthesis built from research but auto-remediation then removed, because the QA
 * review found them unsupported (typically a split stitched together from studies with
 * different denominators). Reported as removed, not as "not found": the research had figures,
 * they just did not hold up.
 */
export function reportChartsRemovedByRemediation(before: any, after: any): GenerationAlert[] {
  const alerts: GenerationAlert[] = [];
  if (!before || before === after) return alerts;
  for (const chart of PROFILE_CHARTS) {
    const had = before?.[chart.section]?.[chart.key];
    const has = after?.[chart.section]?.[chart.key];
    if (Array.isArray(had) && had.length > 0 && (!Array.isArray(has) || has.length === 0)) {
      pushAlert(alerts, {
        section: chart.section,
        severity: "flagged",
        message: `${chart.label}: removed during QA auto-remediation after the QA review questioned it. See the QA red flags for the reason.`,
      });
    }
  }
  return alerts;
}

/** One alert per chart the research did not cover, so an empty chart is never mistaken for a rendering bug. */
export function reportChartsNotFound(profile: any, existing: GenerationAlert[] = []): GenerationAlert[] {
  const alerts: GenerationAlert[] = [];
  for (const chart of PROFILE_CHARTS) {
    const data = profile?.[chart.section]?.[chart.key];
    if (Array.isArray(data) && data.length > 0) continue;
    const alreadyExplained = existing.some((a) => a.section === chart.section && a.message.toLowerCase().includes(chart.label.toLowerCase()));
    if (alreadyExplained) continue;
    pushAlert(alerts, { section: chart.section, severity: "not_found", message: `${chart.label}: not found in research.` });
  }
  return alerts;
}

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

/**
 * Merges the remediation agent's rewrite over the synthesized profile. The agent may improve
 * what it returns; it may not delete. Any top-level section it omitted or emptied keeps the
 * synthesized (real) version, and sources always stay the researched registry.
 */
export function mergeRemediatedProfile(original: any, corrected: any): { profile: any; restored: string[] } {
  const profile = { ...corrected };
  const restored: string[] = [];
  for (const [key, value] of Object.entries(original ?? {})) {
    // Always taken from the original below, so their absence from the rewrite is not a loss.
    if (key === "sources" || key === "channelStrategy") continue;
    if (isEmptyValue(value)) continue;
    if (isEmptyValue(profile[key])) {
      profile[key] = value;
      restored.push(key);
    }
  }
  if (Array.isArray(original?.sources)) profile.sources = original.sources;
  if (original?.channelStrategy) profile.channelStrategy = original.channelStrategy;
  return { profile, restored };
}

const PERSONA_SOURCE_TYPES = new Set(["User", "RFP", "ScoutAI"]);

/**
 * Keeps the personas the model produced and labels them only from what is known. Nothing is
 * padded: fewer than four personas is reported, not topped up with stand-ins.
 */
export function checkPersonas(profile: any, options: { mediaPlanUploaded: boolean }): GenerationAlert[] {
  const alerts: GenerationAlert[] = [];
  if (!Array.isArray(profile.personas)) profile.personas = [];
  if (profile.personas.length > 4) profile.personas = profile.personas.slice(0, 4);

  for (const persona of profile.personas) {
    if (!options.mediaPlanUploaded && persona.sourceType !== "User") {
      // Without an uploaded plan nothing can be RFP-derived; every non-user persona is ScoutAI's.
      persona.sourceType = "ScoutAI";
    } else if (!PERSONA_SOURCE_TYPES.has(persona.sourceType)) {
      delete persona.sourceType;
    }
    persona.isExpansion = options.mediaPlanUploaded && persona.sourceType === "ScoutAI";
  }

  if (profile.personas.length < 4) {
    pushAlert(alerts, {
      section: "personas",
      severity: "failed",
      message: profile.personas.length === 0
        ? "No personas were generated."
        : `Only ${profile.personas.length} of 4 personas were generated.`,
    });
  }
  if (options.mediaPlanUploaded && profile.personas.some((persona: any) => !persona.sourceType)) {
    pushAlert(alerts, {
      section: "personas",
      severity: "flagged",
      message: "Some personas did not say whether they came from the uploaded plan or are ScoutAI expansions, so they carry no source label.",
    });
  }
  return alerts;
}
