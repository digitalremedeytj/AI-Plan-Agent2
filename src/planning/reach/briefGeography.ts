/**
 * Reads the brief's geography picker into the GeoTargeting the reach universe expects.
 *
 * The brief stores its selection as display names from src/utils/geoReference.ts
 * ("Washington, DC (Hag, Wsh)", "Virginia (VA)"), not as household-data codes, so DMAs are
 * matched by name, with a checked table for the names the household file abbreviates
 * differently. briefGeography.test.ts asserts every name in the picker resolves to exactly
 * one market, and geoReference.test.ts holds the picker's own codes to those matches, so a
 * drift between the two lists fails loudly.
 */
import type { GeoEntry, GeoTargeting, GeographyTargetConfig } from "../../types";
import { dmaEntry, geoCoverage, geoSummaryForPrompt, parseGeoList, stateEntry } from "../geoTargeting";
import { NATIONAL_TV_HOUSEHOLDS } from "../knowledge/stateHouseholds";
import { resolveHouseholdUniverse } from "./universe";

/** Picker names the household file spells too differently to match, mapped to its codes. */
const PICKER_DMA_CODES: Record<string, string> = {
  "Phoenix (Prescott), AZ": "753",
  "Tampa-St. Petersburg (Sarasota), FL": "539",
  "Sacramento-Stktn-Modesto, CA": "862",
  "Greenville-Spart-Ashevll, SC": "567",
  "Austin, TX": "635",
  "Birmingham (Ann and Tusc), AL": "630",
  "Wilkes Barre-Scranton-Hztn, PA": "577",
  "El Paso (Las Cruces), TX": "765",
  "Quad Cities, IA-IL": "682",
  "Fort Smith-Fay-Sprngdl-Rgr, AR": "670",
  "Wichita-Hutchinson, KS": "678",
  "Santa Barbara-San Mar-San Lu Ob, CA": "855",
  "Cheyenne-Scottsbluff, WY": "759",
  "Rochester-Mason City-Austin, MN": "611",
  "Johnstown-Altoona-St Colge, PA": "574",
  "Paducah-Cape Girard-Harsbg, KY": "632",
  "Tyler-Longview (Lufkin & Nacogdoches), TX": "709",
  "Elmira (Corning), NY": "565",
  // No longer in the picker (merged into "Panama City, FL" and "Quincy-Hannibal-Keokuk, IL"),
  // but saved briefs still carry these names.
  "Panama City-Destin, FL": "656",
  "Quincy-Hannibal, IL-MO": "717",
};

function single(raw: string, scope: "state" | "dma"): GeoEntry | undefined {
  const { entries } = parseGeoList(raw, scope);
  return entries.length === 1 ? entries[0] : undefined;
}

export function resolvePickerDma(name: string): GeoEntry | undefined {
  const trimmed = name.trim();
  const mapped = PICKER_DMA_CODES[trimmed];
  if (mapped) return dmaEntry(mapped);
  return single(trimmed, "dma") || single(trimmed.replace(/,\s*[A-Z]{2}(-[A-Z]{2})*$/, ""), "dma");
}

export function resolvePickerState(name: string): GeoEntry | undefined {
  const code = name.match(/\(([A-Za-z]{2})\)\s*$/)?.[1];
  return (code && stateEntry(code)) || single(name.replace(/\s*\([^)]*\)\s*$/, ""), "state");
}

/** National, or nothing selected, is undefined: the universe resolver treats that as national. */
export function geoTargetingFromBrief(config: GeographyTargetConfig | null | undefined): GeoTargeting | undefined {
  if (!config || (config.type !== "State" && config.type !== "DMA")) return undefined;
  const targets = Array.isArray(config.targets) ? config.targets.filter((target) => target && target.trim()) : [];
  if (targets.length === 0) return undefined;
  const scope = config.type === "State" ? "state" : "dma";
  const resolve = scope === "state" ? resolvePickerState : resolvePickerDma;
  return {
    scope,
    // An unmatched name is kept under its own text so the universe reports it, rather than
    // quietly sizing the plan without it.
    entries: targets.map((target) => resolve(target) || { id: target, name: target }),
    unresolved: [],
    inputMethod: "select",
  };
}

/** The brief's geography notes ride in every research prompt, so they are kept to a paragraph. */
export const GEOGRAPHY_NOTES_MAX_CHARS = 1000;

function compactHouseholds(households: number): string {
  return households >= 1_000_000 ? `${(households / 1_000_000).toFixed(1)}M` : `${Math.round(households / 1000)}K`;
}

/**
 * The footprint under the brief's picker, from the same households the plan's reach is sized
 * to, so what the planner sees before generating is what the numbers will use. Null for national.
 */
export function footprintReadout(config: GeographyTargetConfig | null | undefined): { line: string; detail: string; unsized: string[] } | null {
  const targeting = geoTargetingFromBrief(config);
  if (!targeting) return null;
  const universe = resolveHouseholdUniverse(targeting);
  if (universe.scope === "national") return { line: "Not sized: none of these matched the household data", detail: "", unsized: universe.unresolved };
  const share = ((universe.households / NATIONAL_TV_HOUSEHOLDS) * 100).toFixed(1);
  const coverage = geoCoverage(targeting);
  const detail = coverage?.scope === "dma"
    ? `Delivers into ${coverage.states.join(", ")}`
    : coverage?.scope === "state"
      ? `Served by ${coverage.overlappingDmaCount} DMAs${coverage.spillMarketCount > 0 ? `; ${coverage.spillMarketCount} of them also deliver into ${coverage.spillStates.join(", ")}` : ""}`
      : "";
  return { line: `${universe.label} · ${compactHouseholds(universe.households)} TV households · ${share}% of US`, detail, unsized: universe.unresolved };
}

/**
 * The geography the research prompts see: the footprint as code computed it, and the planner's
 * notes for what the picker cannot hold. The engine is given the plain geography instead, since
 * it gates product eligibility on it.
 */
export function geographyForPrompt(geography: string | undefined, config: GeographyTargetConfig | null | undefined): string {
  const targeting = geoTargetingFromBrief(config);
  const footprint = targeting ? geoSummaryForPrompt(targeting) : geography && !/^(national|united states)$/i.test(geography.trim()) ? geography : "National (United States).";
  const notes = typeof config?.rawInput === "string" ? config.rawInput.trim().slice(0, GEOGRAPHY_NOTES_MAX_CHARS) : "";
  return notes ? `${footprint}\nPlanner's geography notes (instructions the targeting above cannot hold, e.g. a radius, ZIPs, exclusions): ${notes.replace(/\s*\n\s*/g, "; ")}` : footprint;
}
