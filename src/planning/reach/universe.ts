/**
 * The household universe a plan's reach is measured against: every TV household in the
 * targeted geography. Reach can never exceed it.
 *
 * This is the only place the geo scope matters to reach. The reach model sees a household
 * count and nothing else, so adding a scope (ZIP is next) means adding a case here.
 */
import type { GeoTargeting } from "../../types";
import { DMA_SOURCE_LABEL, findDmaByCode } from "../knowledge/dmaMarkets";
import {
  NATIONAL_TV_HOUSEHOLDS,
  STATE_HOUSEHOLDS_SOURCE_LABEL,
  findStateHouseholds,
} from "../knowledge/stateHouseholds";

export interface HouseholdUniverse {
  households: number;
  scope: "national" | "state" | "dma";
  /** States or markets that contributed households; 0 for national. */
  unitCount: number;
  /** Short name for the footprint, e.g. "Virginia" or "3 DMAs". */
  label: string;
  sourceLabel: string;
  /** Selected entries we could not size. They contribute nothing, so they are reported. */
  unresolved: string[];
}

const NATIONAL: HouseholdUniverse = {
  households: NATIONAL_TV_HOUSEHOLDS,
  scope: "national",
  unitCount: 0,
  label: "United States",
  sourceLabel: STATE_HOUSEHOLDS_SOURCE_LABEL,
  unresolved: [],
};

function footprintLabel(names: string[], singular: string, plural: string): string {
  if (names.length === 1) return `${names[0]}${singular ? ` ${singular}` : ""}`;
  return `${names.length} ${plural}`;
}

export function resolveHouseholdUniverse(geo: GeoTargeting | undefined | null): HouseholdUniverse {
  if (!geo || geo.scope === "national" || !Array.isArray(geo.entries) || geo.entries.length === 0) {
    return { ...NATIONAL };
  }

  const unresolved: string[] = [];
  const names: string[] = [];
  let households = 0;
  // Entries are de-duplicated on input, but a plan saved by an older build may not have been.
  const seen = new Set<string>();

  for (const entry of geo.entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const record = geo.scope === "state" ? findStateHouseholds(entry.id) : findDmaByCode(entry.id);
    if (!record) {
      unresolved.push(entry.name || entry.id);
      continue;
    }
    households += record.tvHouseholds;
    names.push(record.name);
  }

  // Nothing resolved would size the plan at zero households; national is the honest fallback,
  // and the unresolved list says why.
  if (households <= 0) return { ...NATIONAL, unresolved };

  return geo.scope === "state"
    ? {
        households,
        scope: "state",
        unitCount: names.length,
        label: footprintLabel(names, "", "states"),
        sourceLabel: STATE_HOUSEHOLDS_SOURCE_LABEL,
        unresolved,
      }
    : {
        households,
        scope: "dma",
        unitCount: names.length,
        label: footprintLabel(names, "DMA", "DMAs"),
        sourceLabel: DMA_SOURCE_LABEL,
        unresolved,
      };
}
