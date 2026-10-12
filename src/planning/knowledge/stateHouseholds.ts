import stateData from "./stateHouseholds.json";

/**
 * TV households for the 50 states plus DC, generated from assets/state-tv-hh.csv by
 * buildStateHouseholds.ts. Edit the CSV and regenerate; never hand-edit the JSON.
 *
 * This is the national universe for reach. It comes from a different export than the DMA
 * file, so the two national totals differ slightly; Media Planning accepted that, since the
 * figures are rounded and reach is an estimate.
 */
export interface StateHouseholds {
  /** USPS code, matching usStates.ts and the GeoEntry ids for state targeting. */
  code: string;
  name: string;
  rank: number;
  tvHouseholds: number;
  usSharePct: number;
}

export const STATE_HOUSEHOLDS: StateHouseholds[] = stateData.states;

export const STATE_HOUSEHOLDS_SOURCE_LABEL: string = stateData.sourceLabel;

export const NATIONAL_TV_HOUSEHOLDS: number = stateData.totalTvHouseholds;

const byCode = new Map(STATE_HOUSEHOLDS.map((state) => [state.code, state]));

export function findStateHouseholds(code: string): StateHouseholds | undefined {
  return byCode.get(code.trim().toUpperCase());
}
