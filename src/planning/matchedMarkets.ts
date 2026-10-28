/**
 * A matched-market lift test for a State or DMA plan: for each targeted market, an untargeted one
 * of similar size in the same part of the country, held out as its control. Lift is the
 * difference in the KPI between the two groups over the flight.
 *
 * Deterministic so the same plan always proposes the same controls, and so nothing about the
 * design is model-written: households come from the reference data, regions from the Census.
 * It proposes a design; it does not claim a study is booked.
 */
import type { GeoTargeting } from "../types";
import { DMA_MARKETS, findDmaByCode } from "./knowledge/dmaMarkets";
import { MAP_MARKETS } from "./knowledge/geoMap";
import { STATE_HOUSEHOLDS } from "./knowledge/stateHouseholds";
import { NIELSEN_DMAS } from "../utils/geoReference";
import { buildGeoFootprint } from "./geoFootprint";
import { geoCoverage } from "./geoTargeting";
import { resolvePickerDma } from "./reach/briefGeography";

const DIVISIONS: Record<string, string[]> = {
  "New England": ["CT", "ME", "MA", "NH", "RI", "VT"],
  "Middle Atlantic": ["NJ", "NY", "PA"],
  "East North Central": ["IL", "IN", "MI", "OH", "WI"],
  "West North Central": ["IA", "KS", "MN", "MO", "NE", "ND", "SD"],
  "South Atlantic": ["DE", "DC", "FL", "GA", "MD", "NC", "SC", "VA", "WV"],
  "East South Central": ["AL", "KY", "MS", "TN"],
  "West South Central": ["AR", "LA", "OK", "TX"],
  Mountain: ["AZ", "CO", "ID", "MT", "NV", "NM", "UT", "WY"],
  Pacific: ["AK", "CA", "HI", "OR", "WA"],
};
const REGION_OF_DIVISION: Record<string, string> = {
  "New England": "Northeast", "Middle Atlantic": "Northeast",
  "East North Central": "Midwest", "West North Central": "Midwest",
  "South Atlantic": "South", "East South Central": "South", "West South Central": "South",
  Mountain: "West", Pacific: "West",
};
const divisionOf = new Map(Object.entries(DIVISIONS).flatMap(([division, states]) => states.map((state) => [state, division] as const)));

/** A control smaller than this share of its test market, or larger than its inverse, is not comparable. */
const MIN_SIZE_RATIO = 0.6;
/** Past this many markets a pairwise design is unwieldy and the controls run thin. */
export const MAX_TEST_UNITS = 12;
/** A footprint this large leaves too little of the country to hold out. */
const MAX_FOOTPRINT_SHARE_PCT = 40;

interface Unit { id: string; name: string; households: number; state: string }

export interface MatchedPair {
  test: Unit;
  /** Null when no untargeted market of comparable size exists. */
  control: Unit | null;
  /** "Same division", "Same region" or "Different region". */
  match?: string;
}

export interface MatchedMarketDesign {
  scope: "state" | "dma";
  pairs: MatchedPair[];
  testHouseholds: number;
  controlHouseholds: number;
}

/** The picker's spelling of a market ("Sacramento-Stktn-Modesto, CA") reads better than the household file's. */
const pickerNameByCode = (() => {
  let map: Map<string, string> | null = null;
  return () => {
    if (!map) {
      map = new Map();
      for (const dma of NIELSEN_DMAS) {
        const code = resolvePickerDma(dma.name)?.id;
        if (code && !map.has(code)) map.set(code, dma.name);
      }
    }
    return map;
  };
})();

function dmaUnit(code: string): Unit | null {
  const market = findDmaByCode(code);
  const state = MAP_MARKETS[code]?.state;
  if (!market || !state) return null;
  return { id: code, name: pickerNameByCode().get(code) || market.name, households: market.tvHouseholds, state };
}

function regionPenalty(a: string, b: string): { penalty: number; match: string } {
  const da = divisionOf.get(a);
  const db = divisionOf.get(b);
  if (da && da === db) return { penalty: 0, match: "Same division" };
  if (da && db && REGION_OF_DIVISION[da] === REGION_OF_DIVISION[db]) return { penalty: 0.15, match: "Same region" };
  return { penalty: 0.4, match: "Different region" };
}

/**
 * Null when the plan has no footprint, too many markets for a pairwise design, or covers too
 * much of the country to leave controls.
 */
export function matchedMarketDesign(targeting: GeoTargeting | undefined | null): MatchedMarketDesign | null {
  const view = buildGeoFootprint({ targeting, plannedBudget: 0 });
  if (!view || view.rows.length > MAX_TEST_UNITS || view.usSharePct > MAX_FOOTPRINT_SHARE_PCT) return null;

  const targeted = new Set(view.rows.map((row) => row.id));
  let tests: Unit[];
  let pool: Unit[];
  if (view.scope === "dma") {
    tests = view.rows.map((row) => {
      const unit = dmaUnit(row.id);
      return unit ? { ...unit, name: row.name, households: row.households } : null;
    }).filter((unit): unit is Unit => Boolean(unit));
    pool = DMA_MARKETS.filter((market) => !targeted.has(market.code)).map((market) => dmaUnit(market.code)).filter((unit): unit is Unit => Boolean(unit));
  } else {
    // A state the serving markets spill into would see any part of the buy made by DMA, so it is
    // held out of the controls even though the section no longer shows it.
    const coverage = geoCoverage(targeting!);
    const exposed = new Set([...targeted, ...(coverage?.scope === "state" ? coverage.spillStates : [])]);
    tests = view.rows.map((row) => ({ id: row.id, name: row.name, households: row.households, state: row.id }));
    pool = STATE_HOUSEHOLDS.filter((state) => !exposed.has(state.code))
      .map((state) => ({ id: state.code, name: state.name, households: state.tvHouseholds, state: state.code }));
  }
  if (tests.length === 0) return null;

  const used = new Set<string>();
  const pairs: MatchedPair[] = tests.map((test) => {
    let best: { unit: Unit; score: number; match: string } | null = null;
    for (const candidate of pool) {
      if (used.has(candidate.id)) continue;
      const ratio = candidate.households / test.households;
      if (ratio < MIN_SIZE_RATIO || ratio > 1 / MIN_SIZE_RATIO) continue;
      const { penalty, match } = regionPenalty(test.state, candidate.state);
      const score = Math.abs(Math.log(ratio)) + penalty;
      if (!best || score < best.score) best = { unit: candidate, score, match };
    }
    if (!best) return { test, control: null };
    used.add(best.unit.id);
    return { test, control: best.unit, match: best.match };
  });
  if (!pairs.some((pair) => pair.control)) return null;

  return {
    scope: view.scope,
    pairs,
    testHouseholds: pairs.reduce((sum, pair) => sum + (pair.control ? pair.test.households : 0), 0),
    controlHouseholds: pairs.reduce((sum, pair) => sum + (pair.control?.households || 0), 0),
  };
}
