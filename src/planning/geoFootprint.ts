/**
 * The plan's Geo Footprint section: the footprint frozen when the plan is saved, and the view the
 * section renders from it.
 *
 * Everything here is computed, never written by the model, because a prospect reads these
 * numbers as commitments: households, shares and the per-market budget come from the household
 * data and the plan's own allocation, and the coverage note is assembled from the market-to-state
 * mapping. The model's only contribution to the section is demographics.geographyNotes.
 */
import type { GeoEntry, GeoTargeting, GeographyTargetConfig } from "../types";
import { dmasForState } from "./knowledge/dmaMarkets";
import { findStateHouseholds, NATIONAL_TV_HOUSEHOLDS } from "./knowledge/stateHouseholds";
import { US_STATES } from "./knowledge/usStates";
import { geoCoverage, rehydrateGeoTargeting } from "./geoTargeting";
import type { MediaRecommendationPlan } from "./types";
import { GEOGRAPHY_NOTES_MAX_CHARS, resolvePickerDma, resolvePickerState } from "./reach/briefGeography";

/**
 * The brief's geography resolved once, with the household figures it was sized to. Saved on the
 * plan so a later change to the reference data cannot move a saved plan's footprint. DMA entries
 * keep the planner's picker name ("Boston (Manchester), MA"), which reads better than the household
 * file's truncated spelling and is what they chose. Undefined for national.
 */
export function geoSnapshotFromBrief(config: GeographyTargetConfig | null | undefined): GeoTargeting | undefined {
  if (!config || (config.type !== "State" && config.type !== "DMA")) return undefined;
  const targets = Array.isArray(config.targets)
    ? config.targets.filter((target): target is string => typeof target === "string" && target.trim().length > 0)
    : [];
  if (targets.length === 0) return undefined;

  const scope = config.type === "State" ? "state" : "dma";
  const entries: GeoEntry[] = [];
  const unresolved: GeoTargeting["unresolved"] = [];
  const seen = new Set<string>();
  for (const target of targets) {
    const entry = scope === "state" ? stateSnapshotEntry(target) : dmaSnapshotEntry(target);
    if (!entry) {
      unresolved.push({ token: target.slice(0, 120), reason: "unknown" });
      continue;
    }
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
  }
  if (entries.length === 0) return undefined;
  const notes = typeof config.rawInput === "string" ? config.rawInput.trim().slice(0, GEOGRAPHY_NOTES_MAX_CHARS) : "";
  return { scope, entries, unresolved, inputMethod: "select", ...(notes ? { notes } : {}) };
}

function dmaSnapshotEntry(target: string): GeoEntry | undefined {
  const market = resolvePickerDma(target);
  if (!market?.tvHouseholds) return undefined;
  return { ...market, name: target.trim() };
}

function stateSnapshotEntry(target: string): GeoEntry | undefined {
  const state = resolvePickerState(target);
  const households = state ? findStateHouseholds(state.id) : undefined;
  if (!state || !households) return undefined;
  return {
    id: state.id,
    name: state.name,
    rank: households.rank,
    tvHouseholds: households.tvHouseholds,
    usSharePct: households.usSharePct,
    states: [state.id],
  };
}

export interface GeoFootprintRow {
  id: string;
  name: string;
  /** "#9" for a market's rank, "8 DMAs" for the markets serving a state. */
  detail: string;
  households: number;
  /** Share of the footprint's households, 0-100, rounded to a whole percent. */
  sharePct: number;
  /** Whole dollars; absent when the plan has no allocated budget to split. */
  budget?: number;
}

export type PrecisionKind = "radius" | "zip" | "exclusion";

export interface PrecisionTarget {
  kind: PrecisionKind;
  label: string;
  /** What the plan does with it. Names a media type only when the plan actually buys it. */
  action: string;
}

export interface GeoFootprintView {
  scope: "state" | "dma";
  title: string;
  rows: GeoFootprintRow[];
  households: number;
  usSharePct: number;
  /** States the footprint targets (state scope) or delivers into (DMA scope). */
  coveredStates: string[];
  coverageNote: string;
  precision: PrecisionTarget[];
  /** Picks that could not be sized and are not in the numbers. */
  unsized: string[];
}

export interface GeoFootprintInput {
  targeting: GeoTargeting | undefined | null;
  /** The plan's allocated total, as Channel Allocation shows it. 0 hides the budget column. */
  plannedBudget: number;
  /** The brief's Locations & Notes text. */
  notes?: string;
  /** Names of the plan's funded geofence media types. */
  geofenceChannels?: string[];
}

const stateName = (code: string) => US_STATES.find((state) => state.code === code)?.name || code;

/** "A", "A and B", "A, B and C". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] || "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Splits a budget across rows by households, in whole dollars that add back up to the total:
 * each row is floored and the leftover dollars go to the largest remainders.
 */
export function splitByHouseholds(total: number, households: number[]): number[] {
  const whole = Math.round(total);
  const sum = households.reduce((acc, value) => acc + value, 0);
  if (whole <= 0 || sum <= 0) return households.map(() => 0);
  const exact = households.map((value) => (whole * value) / sum);
  const floored = exact.map(Math.floor);
  let leftover = whole - floored.reduce((acc, value) => acc + value, 0);
  const order = exact.map((value, index) => ({ index, remainder: value - floored[index] })).sort((a, b) => b.remainder - a.remainder);
  for (const { index } of order) {
    if (leftover <= 0) break;
    floored[index] += 1;
    leftover -= 1;
  }
  return floored;
}

/** Whole percents that add up to 100, by the same largest-remainder rule. */
function sharesOf(households: number[]): number[] {
  return splitByHouseholds(100, households);
}

const RADIUS = /\d+(?:\.\d+)?\s*(?:mi|mile|miles|km|kilometers?)\b|\bradius\b/i;
const ZIP = /\bzips?\b|\bzip codes?\b|\bpostal\b|\b\d{5}\b/i;
const EXCLUSION = /\bexclud\w*|\bexcept\b|\bomit\w*|\bnot in\b|\bavoid\b/i;
const MAX_PRECISION = 6;

/**
 * The notes lines the picker cannot hold, read as chips. A plain place in the notes moved to the
 * target list on Add, so lines that are none of these kinds are left to the notes themselves.
 */
export function precisionTargets(notes: string | undefined, geofenceChannels: string[] = []): PrecisionTarget[] {
  if (!notes) return [];
  const lines = notes.split(/\r?\n|;|•/).map((line) => line.trim().replace(/^[-*]\s*/, "")).filter(Boolean);
  const out: PrecisionTarget[] = [];
  for (const line of lines) {
    const label = line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line;
    if (EXCLUSION.test(line)) out.push({ kind: "exclusion", label, action: "Excluded at activation" });
    else if (RADIUS.test(line)) out.push({ kind: "radius", label, action: geofenceChannels.length > 0 ? joinNames(geofenceChannels) : "Radius applied at activation" });
    else if (ZIP.test(line)) out.push({ kind: "zip", label, action: "ZIP targeting at activation" });
    if (out.length >= MAX_PRECISION) break;
  }
  return out;
}

function households(entry: GeoEntry, scope: "state" | "dma"): number {
  // The snapshot carries the figure the plan was sized to; a plan from before snapshots
  // looks it up.
  if (entry.tvHouseholds && entry.tvHouseholds > 0) return entry.tvHouseholds;
  if (scope === "state") return findStateHouseholds(entry.id)?.tvHouseholds || 0;
  return resolvePickerDma(entry.name)?.tvHouseholds || 0;
}

function titleFor(scope: "state" | "dma", rows: GeoFootprintRow[]): string {
  if (scope === "state") {
    return rows.length <= 3 ? joinNames(rows.map((row) => row.name)) : `${rows.length}-State Footprint`;
  }
  return rows.length === 1 ? `${rows[0].name.replace(/,\s*[A-Z]{2}(-[A-Z]{2})*$/, "")} Market` : `${rows.length}-Market Footprint`;
}

/**
 * Written for the client, since the share link shows it. State plans get none: the TV markets a
 * state's DMAs spill into only matter to a buy made by DMA, and streaming and digital target the
 * state itself, so listing them told prospects the plan ran in states the RFP never asked for.
 */
function coverageNoteFor(targeting: GeoTargeting, rows: GeoFootprintRow[]): string {
  const coverage = geoCoverage(targeting);
  if (coverage?.scope === "dma") {
    const names = coverage.states.map(stateName);
    if (names.length === 0) return "";
    if (names.length === 1) return `${rows.length === 1 ? "This market sits" : `All ${rows.length} markets sit`} within ${names[0]}.`;
    return `${rows.length === 1 ? "This market reaches" : "These markets reach"} viewers across ${names.length} states: ${joinNames(names)}.`;
  }
  return "";
}

/** Null for national, or when nothing in the footprint could be sized. */
export function buildGeoFootprint(input: GeoFootprintInput): GeoFootprintView | null {
  const targeting = input.targeting;
  if (!targeting || (targeting.scope !== "state" && targeting.scope !== "dma")) return null;
  const scope = targeting.scope;

  const unsized = (targeting.unresolved || []).map((token) => token.token);
  const sized: Array<{ entry: GeoEntry; households: number }> = [];
  for (const entry of targeting.entries || []) {
    const value = households(entry, scope);
    if (value > 0) sized.push({ entry, households: value });
    else unsized.push(entry.name || entry.id);
  }
  if (sized.length === 0) return null;
  sized.sort((a, b) => b.households - a.households);

  const counts = sized.map((item) => item.households);
  const shares = sharesOf(counts);
  const budgets = input.plannedBudget > 0 ? splitByHouseholds(input.plannedBudget, counts) : null;
  const rows: GeoFootprintRow[] = sized.map(({ entry, households: value }, index) => ({
    id: entry.id,
    name: entry.name,
    detail: scope === "dma"
      ? (entry.rank ? `#${entry.rank}` : "")
      : (() => { const served = dmasForState(entry.id).length; return `${served} DMA${served === 1 ? "" : "s"}`; })(),
    households: value,
    sharePct: shares[index],
    ...(budgets ? { budget: budgets[index] } : {}),
  }));

  const total = counts.reduce((acc, value) => acc + value, 0);
  const coverage = geoCoverage({ ...targeting, entries: sized.map((item) => item.entry) });
  return {
    scope,
    title: titleFor(scope, rows),
    rows,
    households: total,
    usSharePct: (total / NATIONAL_TV_HOUSEHOLDS) * 100,
    coveredStates: coverage?.scope === "dma" ? coverage.states : rows.map((row) => row.id),
    coverageNote: coverageNoteFor({ ...targeting, entries: sized.map((item) => item.entry) }, rows),
    // The notes saved with the plan, so the chips match what it was generated from; a plan from
    // before notes were saved reads the brief's.
    precision: precisionTargets(targeting.notes ?? input.notes, input.geofenceChannels),
    unsized,
  };
}

/** The footprint as the planning engine and the QA checks read it. */
export interface GeoPlanFacts {
  scope: "state" | "dma";
  unitCount: number;
  households: number;
  usSharePct: number;
  /** Market or state names, largest first. */
  places: string[];
  precision: PrecisionKind[];
}

export function geoPlanFacts(targeting: GeoTargeting | undefined | null): GeoPlanFacts | undefined {
  const view = buildGeoFootprint({ targeting, plannedBudget: 0 });
  if (!view) return undefined;
  return {
    scope: view.scope,
    unitCount: view.rows.length,
    households: view.households,
    usSharePct: Math.round(view.usSharePct * 10) / 10,
    places: view.rows.map((row) => row.name),
    precision: Array.from(new Set(view.precision.map((target) => target.kind))),
  };
}

/** "Boston (Manchester), MA" -> "Boston", "Hartford & New Haven, CT" -> "Hartford"; state names pass through. */
export function shortPlaceName(name: string): string {
  return name.split(/[(,&]/)[0].split("-")[0].trim();
}

/**
 * One line naming the footprint, for the slide glance and the executive brief: the places when
 * there are few enough to read, else a count, then the households.
 */
export function footprintSummary(facts: Pick<GeoPlanFacts, "scope" | "places" | "households">): string {
  const unit = facts.scope === "dma" ? (facts.places.length === 1 ? "DMA" : "DMAs") : (facts.places.length === 1 ? "state" : "states");
  const names = facts.places.length <= 3
    ? `${joinNames(facts.places.map(shortPlaceName))} ${unit}`
    : `${facts.places.length} ${unit}`;
  const households = facts.households >= 1_000_000 ? `${(facts.households / 1_000_000).toFixed(1)}M` : `${Math.round(facts.households / 1000)}K`;
  return `${names} · ${households} TV households`;
}

/**
 * Markets whose household share of the monthly budget falls below the lead media type's monthly
 * minimum. The section shows a per-market budget, so a footprint spread too thin is visible to
 * the client; the planner hears about it first. The minimum is the catalog's own, not a new rule.
 */
export function thinMarketAlert(
  targeting: GeoTargeting | undefined | null,
  monthlyBudget: number,
  leadMediaType: { name: string; monthlyMinimum: number } | null,
): string | null {
  if (!leadMediaType || leadMediaType.monthlyMinimum <= 0 || monthlyBudget <= 0) return null;
  const view = buildGeoFootprint({ targeting, plannedBudget: monthlyBudget });
  if (!view || view.rows.length < 2) return null;
  const thin = view.rows.filter((row) => (row.budget ?? 0) < leadMediaType.monthlyMinimum);
  if (thin.length === 0) return null;
  const named = thin.slice(-3).map((row) => shortPlaceName(row.name));
  const unit = view.scope === "dma" ? "markets" : "states";
  return `${thin.length} of ${view.rows.length} ${unit} get less than $${leadMediaType.monthlyMinimum.toLocaleString()} per 30 days by household share, ${leadMediaType.name}'s monthly minimum (smallest: ${joinNames(named)}). Consider fewer ${unit}, a larger budget, or buying them as one regional footprint.`;
}

/**
 * A saved footprint as a client sent it back: entries rebuilt from the reference data by id
 * (so a request cannot change the households), notes kept as text. Undefined for national.
 */
export function rehydrateGeoSnapshot(value: unknown): GeoTargeting | undefined {
  const base = rehydrateGeoTargeting(value);
  if (!base || base.scope === "national" || base.entries.length === 0) return undefined;
  const notes = typeof (value as { notes?: unknown })?.notes === "string" ? ((value as { notes: string }).notes).trim().slice(0, GEOGRAPHY_NOTES_MAX_CHARS) : "";
  return { ...base, ...(notes ? { notes } : {}) };
}

/** CTV when the plan carries it (plans are CTV-first), else the largest allocation. */
export function leadMediaType(plan: MediaRecommendationPlan | undefined | null): { name: string; monthlyMinimum: number } | null {
  const channels = plan?.channels || [];
  if (channels.length === 0) return null;
  const lead = channels.find((channel) => channel.channelId === "channel.ctv")
    || [...channels].sort((a, b) => (b.allocationDollars || 0) - (a.allocationDollars || 0))[0];
  const product = plan!.evaluatedCandidates.find((candidate) => candidate.product.id === lead.channelId)?.product;
  return { name: lead.channelName, monthlyMinimum: product?.minimumNormalized30DaySpend ?? 0 };
}

/**
 * Prose that calls a plan national, and prose that promises radius or venue targeting. Shared by
 * the QA check on the plan and the executive brief's guard, so both read a claim the same way.
 */
export const NATIONAL_CLAIM = /\b(?:nationwide|nation-wide|coast[- ]to[- ]coast|national (?:campaign|reach|footprint|scale|coverage|flight|buy|plan)|across the (?:country|nation|u\.?s\.?|united states)|all 50 states)\b/i;
export const GEOFENCE_CLAIM = /\bgeo-?fenc\w*|\bgeo-?fram\w*|\bradius\b|\bwithin (?:a )?\d+(?:\.\d+)?[- ]?(?:mi|miles?|km)\b/i;
