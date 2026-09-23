// Charts may carry model estimates where the research has no figure. Two things keep those
// honest and believable:
//
//   * Labelling. A chart counts as sourced only when the research states every one of its
//     values (a share as a percentage). Otherwise every point is marked isModeled, so the UI
//     shows the chart as estimated. Checking points one at a time was too lax: small numbers
//     such as 12 or 27 appear somewhere in any long research text, so invented splits passed
//     as sourced. The check only ever adds the label; a point the model itself called modeled
//     stays modeled.
//   * Shape. Estimated series drift toward tidy patterns - a straight climb through the day,
//     evenly spaced affinity indices, every share a multiple of five. Real audience data is
//     lumpier. `findUnrealisticCharts` names those patterns so the server can ask for one
//     targeted revision.

import { PROFILE_CHARTS } from "./generationIntegrity";

export type ChartSpec = (typeof PROFILE_CHARTS)[number];

// Every number written in the research text. "1,250" is 1250; "34," is 34.
export function numbersInText(text: string): number[] {
  return (text.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g) || [])
    .map((token) => Number(token.replace(/,/g, "")))
    .filter((value) => Number.isFinite(value));
}

// Numbers written as percentages ("27%", "27 percent"), for share charts.
export function percentagesInText(text: string): number[] {
  return (text.match(/\d+(?:\.\d+)?(?=\s*(?:%|percent\b))/gi) || []).map(Number).filter((value) => Number.isFinite(value));
}

// Charts whose values are shares of 100; the rest are indices.
const SHARE_CHARTS = new Set(["age", "gender", "income", "device"]);

// Synthesis may round a reported 50.6% to 51; that still counts as the reported figure.
const SOURCED_TOLERANCE = 0.5;

const pointValue = (point: any) => Number(point?.value ?? point?.index);

const looksLabelledAsEstimate = (source: unknown) => /estimat|model|proxy|directional/i.test(String(source ?? ""));

/**
 * Marks as estimated every chart point whose value the research does not state. Returns the
 * number of points newly labelled. Must run on values as synthesis wrote them, before any
 * rescaling moves them away from the reported numbers.
 */
export function labelEstimatedPoints(profile: any, researchText: string, onlyChartIds?: Set<string>): number {
  const numbers = numbersInText(researchText);
  const percentages = percentagesInText(researchText);
  let labelled = 0;
  for (const chart of PROFILE_CHARTS) {
    if (onlyChartIds && !onlyChartIds.has(chart.id)) continue;
    const data = profile?.[chart.section]?.[chart.key];
    if (!Array.isArray(data)) continue;
    const reported = SHARE_CHARTS.has(chart.id) ? percentages : numbers;
    const isReported = (value: number) => Number.isFinite(value) && reported.some((n) => Math.abs(n - value) <= SOURCED_TOLERANCE);
    const chartIsSourced = data.length > 0 && data.every((point: any) => point?.isModeled !== true && isReported(pointValue(point)));
    if (chartIsSourced) continue;
    for (const point of data) {
      if (!point || point.isModeled === true) continue;
      point.isModeled = true;
      if (!looksLabelledAsEstimate(point.source)) {
        point.source = point.source ? `ScoutAI estimate (informed by ${point.source})` : "ScoutAI estimate";
      }
      labelled++;
    }
    const section = profile?.[chart.section];
    if (Array.isArray(data) && data.length > 0 && data.every((point: any) => point?.isModeled) && typeof section?.chartSource === "string" && !looksLabelledAsEstimate(section.chartSource)) {
      section.chartSource = `ScoutAI estimate${section.chartSource ? ` (informed by ${section.chartSource})` : ""}`;
    }
  }
  return labelled;
}

// Day and hour charts are ordered in time, so a straight run is a shape problem. Domain charts
// are listed in rank order and legitimately descend, so they are only checked for spacing.
const TIME_SERIES = new Set(["dayOfWeek", "hourOfDay"]);

function longestMonotonicRun(values: number[]): { length: number; direction: "rises" | "falls" } {
  let best = { length: 1, direction: "rises" as "rises" | "falls" };
  for (const direction of ["rises", "falls"] as const) {
    let run = 1;
    for (let i = 1; i < values.length; i++) {
      const step = values[i] - values[i - 1];
      run = (direction === "rises" ? step > 0 : step < 0) ? run + 1 : 1;
      if (run > best.length) best = { length: run, direction };
    }
  }
  return best;
}

/** Describes what makes a chart look generated rather than measured. Empty when it looks fine. */
export function chartRealismProblems(chart: ChartSpec, data: any[]): string[] {
  const values = (data || []).map(pointValue).filter((value) => Number.isFinite(value));
  if (values.length < 4) return [];
  const problems: string[] = [];

  if (TIME_SERIES.has(chart.id)) {
    const run = longestMonotonicRun(values);
    if (run.length >= Math.max(4, Math.ceil(values.length * 0.66))) {
      problems.push(`it ${run.direction} steadily across ${run.length} consecutive periods, like a straight line rather than real ${chart.id === "hourOfDay" ? "daypart" : "weekly"} behavior`);
    }
  }

  const sorted = [...values].sort((a, b) => a - b);
  const steps = sorted.slice(1).map((value, i) => value - sorted[i]);
  if (steps.length >= 3 && Math.max(...steps) > 0 && Math.max(...steps) - Math.min(...steps) <= 1) {
    problems.push("its values are evenly spaced");
  }

  if (values.every((value) => value % 5 === 0)) {
    problems.push("every value is a round multiple of 5");
  }

  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  if ([...counts.values()].some((count) => count >= 3)) {
    problems.push("three or more values are identical");
  }

  return problems;
}

export function findUnrealisticCharts(profile: any): Array<{ chart: ChartSpec; problems: string[] }> {
  return PROFILE_CHARTS
    .map((chart) => ({ chart, problems: chartRealismProblems(chart, profile?.[chart.section]?.[chart.key]) }))
    .filter((entry) => entry.problems.length > 0);
}

/**
 * The concrete change each problem calls for. Stated as an instruction because the revision
 * model, shown only a description of the problem plus the research, kept the round numbers it
 * was given in every live run; told what to change, it complied in isolated tests.
 */
export function realismFixes(problems: string[]): string[] {
  return problems.map((problem) => {
    if (/steadily across/.test(problem)) return "Break the straight run: the series must rise and fall the way real behavior does (see the shape guidance), not move in one direction.";
    if (/evenly spaced/.test(problem)) return "Make the gaps between neighbouring values clearly uneven.";
    if (/multiple of 5/.test(problem)) return "Replace every estimated value with a precise number whose last digit is not 0 or 5 (e.g. 372 rather than 375, 38 rather than 40), keeping the overall ranking.";
    if (/identical/.test(problem)) return "Make the repeated values differ from one another.";
    return `Fix this: ${problem}.`;
  });
}

/** What a realistic version of each chart looks like, for the revision prompt. */
export const CHART_SHAPE_GUIDANCE: Record<string, string> = {
  hourOfDay: "Real daily activity has an early-morning low, a smaller daytime or lunchtime bump, its main peak in the evening/prime-time block, and a late-night tail sized to this audience (larger for gamers and night-owl audiences). It is never a straight climb through the day.",
  dayOfWeek: "Day-to-day differences are uneven. Weekday and weekend behavior differ in ways specific to this audience (e.g. commuters dip midweek, streamers peak Friday-Sunday), and adjacent days do not rise or fall in a straight line.",
  domains: "Affinity indices differ by uneven amounts between domains: a few standouts well above the rest, then a tighter cluster, never evenly spaced steps. Use precise index values (e.g. 312, 287, 243, 219) - NOT multiples of 5 or 10 such as 375, 340, 275.",
  device: "Device shares are uneven and precise (e.g. 43, 27, 14, 9, 7), not rounded to multiples of 5.",
  age: "Age shares are uneven and precise, reflecting where this audience actually concentrates; not rounded to multiples of 5.",
  gender: "Gender shares are precise (e.g. 54/45/1), not rounded to multiples of 5.",
  income: "Income shares are uneven and precise, reflecting this audience's actual skew; not rounded to multiples of 5.",
};
