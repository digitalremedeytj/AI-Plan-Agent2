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
import { dmaEntry, parseGeoList, stateEntry } from "../geoTargeting";

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
