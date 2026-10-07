// The number check for past performance. Every figure ScoutAI writes about a past campaign
// (a CPA, a PM, a share of spend, a count of checkouts) must appear in what it was given: the
// campaign digest, or the plan itself. What appears in neither is listed as unverified.
//
// src/qa/claimLedger does this for research, but it skips plain numbers under 10, which is
// exactly where PMs live (0.44, 6.41), so performance text gets its own extraction.

import { MIN_CONVERSIONS } from "./campaign";

export type FigureUnit = "money" | "percent" | "multiplier" | "pm" | "count";

export interface Figure {
  raw: string;
  value: number;
  unit: FigureUnit;
}

const NUMBER = /(\$\s?)?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(\s*(?:%|percent\b|x\b|[KMB]\b|thousand\b|million\b))?/gi;
const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9 };

export function extractPerformanceFigures(text: string): Figure[] {
  const out: Figure[] = [];
  NUMBER.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = NUMBER.exec(text))) {
    const [raw, dollar, digits, rawSuffix = ""] = match;
    const suffix = rawSuffix.trim().toLowerCase();
    let value = Number(digits.replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    const before = text.slice(Math.max(0, match.index - 14), match.index);
    const after = text.slice(match.index + raw.length, match.index + raw.length + 6);
    if (SCALE[suffix]) value *= SCALE[suffix];
    let unit: FigureUnit;
    if (dollar) unit = "money";
    else if (suffix === "%" || suffix === "percent") unit = "percent";
    else if (suffix === "x") unit = "multiplier";
    else if (/\bPM(?:\s+of)?\s*$|multiplier(?:\s+of)?\s*$/i.test(before)) unit = "pm";
    else {
      // Dates, years, ordinals and small counts carry no claim worth checking.
      if (/^[-/]\d/.test(after) || /\d[-/]$/.test(before)) continue;
      if (Number.isInteger(value) && value >= 1900 && value <= 2100) continue;
      if (value < 10) continue;
      if (/^(?:st|nd|rd|th|\+|-?day|\s*days?\b|\s*hours?\b|\s*weeks?\b|\s*minutes?\b)/i.test(after)) continue;
      unit = "count";
    }
    out.push({ raw: raw.trim(), value, unit });
  }
  return out;
}

const decimals = (raw: string) => raw.replace(/[^\d.]/g, "").split(".")[1]?.length ?? 0;

// A figure matches to the precision it is written at: "$53.85" needs 53.845-53.855, "$54" allows
// anything that rounds to it, and "$174K" allows the rounding its suffix implies.
function matches(figure: Figure, reference: Figure): boolean {
  // ROAS is stated as a multiple ("17.63x") and may be quoted as the percentage the brief uses ("1,763%").
  if (figure.unit === "percent" && reference.unit === "multiplier" && !/[KMB]\s*$/i.test(figure.raw)) {
    return Math.abs(figure.value - reference.value * 100) <= 0.5 * 10 ** -decimals(figure.raw) + 1e-9;
  }
  const compatible = figure.unit === reference.unit
    || (figure.unit === "pm" && reference.unit === "count")
    || (figure.unit === "count" && reference.unit === "money");
  if (!compatible) return false;
  if (/[KMB]\s*$|thousand|million/i.test(figure.raw)) {
    return Math.abs(figure.value - reference.value) <= Math.abs(reference.value) * 0.05;
  }
  const places = decimals(figure.raw);
  const tolerance = 0.5 * 10 ** -places + 1e-9;
  return Math.abs(figure.value - reference.value) <= tolerance;
}

export interface FigureReference {
  figures: Figure[];
}

/** What a checked text may quote: every figure in the given texts, and the digest's own sample threshold. */
export function figureReference(...texts: string[]): FigureReference {
  // The digest writes the threshold as "30+ conversions", which extraction skips as a range.
  return { figures: [{ raw: String(MIN_CONVERSIONS), value: MIN_CONVERSIONS, unit: "count" }, ...texts.flatMap((t) => extractPerformanceFigures(t))] };
}

/** The figures in `text` that appear nowhere in the reference, as written. */
export function unverifiedFigures(text: string, reference: FigureReference): string[] {
  const missing: string[] = [];
  for (const figure of extractPerformanceFigures(text)) {
    // "100%" is nearly always "all of it", and a PM of 1 is the definition of average.
    if (figure.unit === "percent" && figure.value === 100) continue;
    if (figure.unit === "pm" && figure.value === 1) continue;
    if (!reference.figures.some((r) => matches(figure, r)) && !missing.includes(figure.raw)) missing.push(figure.raw);
  }
  return missing;
}
