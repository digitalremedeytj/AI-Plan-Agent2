/**
 * Parsing, matching and coverage math for State and DMA targeting.
 *
 * Pure and dependency-free so the brief can validate as the user types and the server can
 * re-validate the same way on receipt. The server never trusts the client's resolution.
 */
import type { GeoEntry, GeoScope, GeoTargeting, GeoUnresolvedToken } from "../types";
import { DMA_MARKETS, TOTAL_US_TV_HOUSEHOLDS, type DmaMarket } from "./knowledge/dmaMarkets";
import { US_STATES, findStateByCode } from "./knowledge/usStates";

/** There are 210 DMAs and 51 states, so any list longer than this is a wrong file. */
export const MAX_GEO_ENTRIES = 250;
export const MAX_GEO_UPLOAD_BYTES = 1_000_000;
/** The wrong file pasted in should report a readable sample, not tens of thousands of rows. */
export const MAX_UNRESOLVED_TOKENS = 50;

export interface GeoResolution {
  entries: GeoEntry[];
  unresolved: GeoUnresolvedToken[];
}

/**
 * Market names in the source export are truncated to 26 characters, so a planner typing a
 * city in full will not match. These are the spellings worth accepting; a token that maps
 * to several markets is deliberately left ambiguous rather than guessed at.
 */
const DMA_ALIASES: Record<string, string[]> = {
  "501": ["nyc", "new york city"],
  "623": ["dfw"],
  "807": ["oakland"],
  "511": ["washington dc", "hagerstown"],
  "534": ["daytona beach", "melbourne"],
  "862": ["sacramento", "stockton"],
  "560": ["fayetteville"],
  "567": ["spartanburg", "asheville", "anderson"],
  "544": ["portsmouth", "newport news"],
  "566": ["lancaster", "lebanon"],
  "563": ["kalamazoo", "battle creek"],
  "630": ["anniston", "tuscaloosa"],
  "518": ["high point", "winston salem"],
  "686": ["fort walton beach"],
  "678": ["hutchinson"],
  "691": ["florence"],
  "570": ["florence"],
  "632": ["cape girardeau", "mount vernon"],
  "636": ["weslaco", "brownsville", "mcallen"],
  "637": ["waterloo", "iowa city", "dubuque"],
  "855": ["santa barbara", "santa maria", "san luis obispo"],
  "810": ["richland", "kennewick"],
  "709": ["lufkin", "nacogdoches"],
  "682": ["rock island"],
  "722": ["kearney"],
  "670": ["springdale", "rogers", "fayetteville"],
  "545": ["new bern"],
  "673": ["tupelo"],
  "759": ["scottsbluff"],
  "627": ["lawton"],
  "611": ["rochester minnesota"],
  "648": ["champaign urbana"],
};

/**
 * Lower-cases and flattens punctuation so "Ft. Myers", "ft myers" and "Fort Myers" all
 * land on the same key. Fort/Saint are expanded to the abbreviations the source uses.
 */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,'"()]/g, " ")
    .replace(/[-_/&]/g, " ")
    .replace(/\bfort\b/g, "ft")
    .replace(/\bsaint\b/g, "st")
    .replace(/\bmt\b/g, "mount")
    .replace(/\s+/g, " ")
    .trim()
    // "N.Y." and "D.C." arrive here as "n y" and "d c"; a run of bare letters is an
    // initialism, never a market name.
    .replace(/^(?:[a-z] )+[a-z]$/, (value) => value.replace(/ /g, ""));
}

const STATE_CODES = new Set(US_STATES.map((state) => state.code));

/**
 * The city names inside a compound market name, e.g. "Ft. Myers" and "Naples" from
 * "Ft. Myers-Naples". Fragments under four characters ("Oak", "And", the "Or" of
 * "Portland, Or") carry no meaning on their own and would match far too eagerly.
 */
function componentTokens(name: string): string[] {
  return name
    .split(/[-,()&/]/)
    .map((part) => normalize(part))
    .filter((part) => part.length >= 4 && !STATE_CODES.has(part.toUpperCase()));
}

/** name/alias/component -> market codes. Several codes means the token is ambiguous. */
const dmaIndex = (() => {
  const index = new Map<string, Set<string>>();
  const add = (key: string, code: string) => {
    if (!key) return;
    const existing = index.get(key);
    if (existing) existing.add(code);
    else index.set(key, new Set([code]));
  };
  for (const market of DMA_MARKETS) {
    add(normalize(market.name), market.code);
    for (const token of componentTokens(market.name)) add(token, market.code);
    for (const alias of DMA_ALIASES[market.code] || []) add(normalize(alias), market.code);
  }
  return index;
})();

const dmaByCode = new Map(DMA_MARKETS.map((market) => [market.code, market]));

const stateIndex = (() => {
  const index = new Map<string, string>();
  for (const state of US_STATES) {
    index.set(normalize(state.name), state.code);
    index.set(state.code.toLowerCase(), state.code);
    for (const alias of state.aliases || []) index.set(normalize(alias), state.code);
  }
  return index;
})();

function toEntry(market: DmaMarket): GeoEntry {
  return {
    id: market.code,
    name: market.name,
    rank: market.rank,
    tvHouseholds: market.tvHouseholds,
    usSharePct: market.usSharePct,
    states: market.states,
  };
}

export function stateEntry(code: string): GeoEntry | undefined {
  const state = findStateByCode(code);
  return state ? { id: state.code, name: state.name } : undefined;
}

export function dmaEntry(code: string): GeoEntry | undefined {
  const market = dmaByCode.get(code.trim());
  return market ? toEntry(market) : undefined;
}

type FieldResult =
  | { status: "resolved"; entry: GeoEntry }
  | { status: "ambiguous"; candidates: string[] }
  | { status: "unknown" };

function resolveField(raw: string, scope: "state" | "dma"): FieldResult {
  const key = normalize(raw);
  if (!key) return { status: "unknown" };

  if (scope === "state") {
    const code = stateIndex.get(key);
    const entry = code ? stateEntry(code) : undefined;
    return entry ? { status: "resolved", entry } : { status: "unknown" };
  }

  // A bare three-digit number is a DMA code and nothing else.
  if (/^\d{3}$/.test(key)) {
    const entry = dmaEntry(key);
    return entry ? { status: "resolved", entry } : { status: "unknown" };
  }

  const matches = dmaIndex.get(key);
  if (!matches || matches.size === 0) return { status: "unknown" };
  if (matches.size === 1) {
    const entry = dmaEntry(Array.from(matches)[0]);
    return entry ? { status: "resolved", entry } : { status: "unknown" };
  }
  return {
    status: "ambiguous",
    candidates: Array.from(matches)
      .map((code) => dmaByCode.get(code))
      .filter((market): market is DmaMarket => Boolean(market))
      .sort((a, b) => a.rank - b.rank)
      .map((market) => `${market.name} (${market.code})`),
  };
}

/** Splits one CSV line, honouring the quotes the source export puts around "Portland, Or". */
function splitFields(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === "," || char === "\t" || char === ";") { fields.push(field); field = ""; continue; }
    field += char;
  }
  fields.push(field);
  return fields.map((value) => value.trim()).filter((value) => value.length > 0);
}

const HEADER_WORDS = /^(rank|dma|dma[ _]?code|code|market|market[ _]?name|name|state|states|tv[ _]?hhs|households|%us|share)$/i;

/**
 * A pasted list and an exported spreadsheet need different readings of a row. In a list,
 * every field is a market and a field that fails to resolve is a typo worth reporting. In
 * a table, one field is the market and the rest are rank, households and share - reporting
 * those as unrecognised would bury the real typos in noise.
 */
function looksTabular(rows: string[][]): boolean {
  const multiField = rows.filter((fields) => fields.length >= 3);
  return rows.length >= 2 && multiField.length >= Math.ceil(rows.length * 0.6);
}

/**
 * Splitting on commas is right for a pasted list and wrong for "Portland, Or" - a market
 * whose own name contains one. Where two adjacent fields resolve as a pair and the first
 * does not resolve alone, the pair is the market the user meant.
 */
function joinCommaNames(fields: string[], scope: "state" | "dma"): Array<{ field: string; result: FieldResult }> {
  const results: Array<{ field: string; result: FieldResult }> = [];
  for (let i = 0; i < fields.length; i += 1) {
    const single = resolveField(fields[i], scope);
    if (single.status !== "resolved" && i + 1 < fields.length) {
      const pairField = `${fields[i]}, ${fields[i + 1]}`;
      const pair = resolveField(pairField, scope);
      if (pair.status === "resolved") {
        results.push({ field: pairField, result: pair });
        i += 1;
        continue;
      }
    }
    results.push({ field: fields[i], result: single });
  }
  return results;
}

export function parseGeoList(raw: string, scope: "state" | "dma"): GeoResolution {
  const rows = raw
    .split(/\r?\n/)
    .map((line) => splitFields(line))
    .filter((fields) => fields.length > 0);

  const tabular = looksTabular(rows);
  const entries: GeoEntry[] = [];
  const seen = new Set<string>();
  const unresolved: GeoUnresolvedToken[] = [];
  const reported = new Set<string>();

  const keep = (entry: GeoEntry) => {
    if (seen.has(entry.id)) return;
    seen.add(entry.id);
    entries.push(entry);
  };
  let suppressed = 0;
  const report = (token: GeoUnresolvedToken) => {
    const key = `${token.reason}:${token.token.toLowerCase()}`;
    if (reported.has(key)) return;
    reported.add(key);
    if (unresolved.length >= MAX_UNRESOLVED_TOKENS) { suppressed += 1; return; }
    unresolved.push(token);
  };

  rows.forEach((fields, rowIndex) => {
    const results = joinCommaNames(fields, scope);
    const resolved = results.filter((item) => item.result.status === "resolved");

    if (tabular) {
      // One market per row; the first field that resolves is it.
      if (resolved.length > 0) {
        keep((resolved[0].result as { entry: GeoEntry }).entry);
        return;
      }
      const ambiguous = results.find((item) => item.result.status === "ambiguous");
      if (ambiguous) {
        report({
          token: ambiguous.field,
          reason: "ambiguous",
          candidates: (ambiguous.result as { candidates: string[] }).candidates,
        });
        return;
      }
      // Header and title rows resolve to nothing; anything later is a row we failed on.
      const isLeadingHeader = rowIndex < 2 && fields.some((field) => HEADER_WORDS.test(field));
      if (!isLeadingHeader) report({ token: fields.join(", ").slice(0, 80), reason: "unknown" });
      return;
    }

    results.forEach(({ field, result }) => {
      if (result.status === "resolved") keep(result.entry);
      else if (result.status === "ambiguous") report({ token: field, reason: "ambiguous", candidates: result.candidates });
      else if (rowIndex > 0 || !HEADER_WORDS.test(field)) report({ token: field, reason: "unknown" });
    });
  });

  if (entries.length > MAX_GEO_ENTRIES) {
    const dropped = entries.splice(MAX_GEO_ENTRIES);
    report({
      token: `${dropped.length} additional ${scope === "dma" ? "markets" : "states"}`,
      reason: "over_limit",
    });
  }

  if (suppressed > 0) {
    unresolved.push({ token: `${suppressed} further unrecognised entries`, reason: "over_limit" });
  }

  return { entries, unresolved };
}

/** Adds entries to a list, keeping first-seen order and honouring the cap. */
export function mergeGeoEntries(existing: GeoEntry[], incoming: GeoEntry[]): GeoEntry[] {
  const seen = new Set(existing.map((entry) => entry.id));
  const merged = [...existing];
  for (const entry of incoming) {
    if (seen.has(entry.id) || merged.length >= MAX_GEO_ENTRIES) continue;
    seen.add(entry.id);
    merged.push(entry);
  }
  return merged;
}

export interface DmaCoverage {
  scope: "dma";
  marketCount: number;
  tvHouseholds: number;
  usSharePct: number;
  /** Every state the selected markets deliver into, sorted. */
  states: string[];
}

export interface StateCoverage {
  scope: "state";
  stateCount: number;
  /** Markets that deliver into at least one selected state. */
  overlappingDmaCount: number;
  /** Of those, the ones that also deliver outside the selected states. */
  spillMarketCount: number;
  spillStates: string[];
}

/**
 * Household coverage is reported for DMA targeting only, and deliberately so: 102 of the
 * 210 markets straddle state lines, so rolling market households up to a set of states
 * counts the New York DMA's 7.3M households once for CT, once for NJ, once for NY and
 * once for PA. State targeting gets market overlap and spill instead - both of which the
 * mapping actually supports, and the spill is the part that surprises people at launch.
 */
export function geoCoverage(targeting: GeoTargeting): DmaCoverage | StateCoverage | null {
  if (targeting.scope === "national" || targeting.entries.length === 0) return null;

  if (targeting.scope === "dma") {
    const markets = targeting.entries
      .map((entry) => dmaByCode.get(entry.id))
      .filter((market): market is DmaMarket => Boolean(market));
    const states = new Set<string>();
    for (const market of markets) market.states.forEach((state) => states.add(state));
    const tvHouseholds = markets.reduce((total, market) => total + market.tvHouseholds, 0);
    return {
      scope: "dma",
      marketCount: markets.length,
      tvHouseholds,
      usSharePct: Number(((tvHouseholds / TOTAL_US_TV_HOUSEHOLDS) * 100).toFixed(3)),
      states: Array.from(states).sort(),
    };
  }

  const selected = new Set(targeting.entries.map((entry) => entry.id));
  const overlapping = DMA_MARKETS.filter((market) => market.states.some((state) => selected.has(state)));
  const spillMarkets = overlapping.filter((market) => market.states.some((state) => !selected.has(state)));
  const spillStates = new Set<string>();
  for (const market of spillMarkets) {
    market.states.filter((state) => !selected.has(state)).forEach((state) => spillStates.add(state));
  }
  return {
    scope: "state",
    stateCount: selected.size,
    overlappingDmaCount: overlapping.length,
    spillMarketCount: spillMarkets.length,
    spillStates: Array.from(spillStates).sort(),
  };
}

/** How many markets to name before the prompt summary switches to a count. */
const PROMPT_MARKET_LIMIT = 25;

/**
 * The one rendering of the footprint the research and synthesis prompts see. Coverage is
 * stated as fact here because code computed it; the model is instructed elsewhere not to
 * re-derive it.
 */
export function geoSummaryForPrompt(targeting: GeoTargeting | undefined, market = "United States"): string {
  if (!targeting || targeting.scope === "national" || targeting.entries.length === 0) {
    return `National (${market}).`;
  }
  const coverage = geoCoverage(targeting);

  if (targeting.scope === "dma" && coverage?.scope === "dma") {
    const named = targeting.entries.slice(0, PROMPT_MARKET_LIMIT)
      .map((entry) => `${entry.name} (${entry.id}, #${entry.rank})`)
      .join(", ");
    const remainder = targeting.entries.length - Math.min(targeting.entries.length, PROMPT_MARKET_LIMIT);
    return [
      `DMA targeting within ${market}: ${coverage.marketCount} markets`,
      `covering ${coverage.tvHouseholds.toLocaleString()} TV households (${coverage.usSharePct}% of US)`,
      `and spanning ${coverage.states.length} states (${coverage.states.join(", ")}).`,
      `Markets: ${named}${remainder > 0 ? `, plus ${remainder} more` : ""}.`,
    ].join(" ");
  }

  if (coverage?.scope === "state") {
    const names = targeting.entries.map((entry) => `${entry.name} (${entry.id})`).join(", ");
    // No spill states: streaming and digital target the state itself, and naming them led the
    // narrative to describe the plan as running in states the brief never asked for.
    return [
      `State targeting within ${market}: ${coverage.stateCount} states - ${names}.`,
      `Delivery is limited to these states; they are served by ${coverage.overlappingDmaCount} DMAs.`,
    ].join(" ");
  }

  return `National (${market}).`;
}

/**
 * Resolves a pick from the single Geography control into the two values it actually sets.
 * The control offers markets and scopes in one list, but they are different fields: the
 * planning engine gates product eligibility on the market, so a scope value reaching
 * `geography` would fail every product and hand back an empty media plan.
 */
export function applyGeographyChoice(
  choice: string,
  currentMarket: string,
): { market: string; scope: GeoScope } {
  if (choice === "state" || choice === "dma") return { market: currentMarket, scope: choice };
  return { market: choice, scope: "national" };
}

export function emptyGeoTargeting(scope: GeoScope = "national"): GeoTargeting {
  return { scope, entries: [], unresolved: [], inputMethod: "select" };
}

/** A footprint before a scope is attached to it - what the brief's inputs produce. */
export type GeoSelection = Omit<GeoTargeting, "scope">;

export function emptyGeoSelection(inputMethod: GeoTargeting["inputMethod"] = "select"): GeoSelection {
  return { entries: [], unresolved: [], inputMethod };
}

/** Rebuilds a footprint from ids alone, dropping anything the reference no longer knows. */
export function rehydrateGeoTargeting(value: unknown): GeoTargeting | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<GeoTargeting>;
  const scope: GeoScope = raw.scope === "state" || raw.scope === "dma" ? raw.scope : "national";
  if (scope === "national") return emptyGeoTargeting();

  const entries: GeoEntry[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(raw.entries) ? raw.entries : []) {
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    if (!id || seen.has(id)) continue;
    const resolved = scope === "dma" ? dmaEntry(id) : stateEntry(id);
    if (!resolved) continue;
    seen.add(id);
    entries.push(resolved);
    if (entries.length >= MAX_GEO_ENTRIES) break;
  }

  const unresolved: GeoUnresolvedToken[] = (Array.isArray(raw.unresolved) ? raw.unresolved : [])
    .filter((token): token is GeoUnresolvedToken => typeof token?.token === "string")
    .slice(0, MAX_UNRESOLVED_TOKENS)
    .map((token) => ({
      token: token.token.slice(0, 120),
      reason: token.reason === "ambiguous" || token.reason === "over_limit" ? token.reason : "unknown",
      candidates: Array.isArray(token.candidates) ? token.candidates.slice(0, 8) : undefined,
    }));

  return {
    scope,
    entries,
    unresolved,
    inputMethod: raw.inputMethod === "paste" || raw.inputMethod === "upload" ? raw.inputMethod : "select",
    sourceFileName: typeof raw.sourceFileName === "string" ? raw.sourceFileName.slice(0, 200) : undefined,
  };
}
