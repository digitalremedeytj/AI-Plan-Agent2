import marketData from "./dmaMarkets.json";

/**
 * The 210 Nielsen-designated market areas, generated from assets/dma-to-state.csv by
 * buildDmaMarkets.ts. Edit the CSV and regenerate; never hand-edit the JSON.
 */
export interface DmaMarket {
  /** Nielsen DMA code, e.g. "501". The stable identifier for a market. */
  code: string;
  /** Market name exactly as the source export spells it, abbreviations included. */
  name: string;
  /** 1 (New York) through 210 (Glendive), by TV households. */
  rank: number;
  tvHouseholds: number;
  /** Share of national TV households, as a percentage. */
  usSharePct: number;
  /** USPS codes of every state the market delivers into, sorted. */
  states: string[];
}

export const DMA_MARKETS: DmaMarket[] = marketData.markets;

/** Credit line for anywhere the household figures are displayed or exported. */
export const DMA_SOURCE_LABEL: string = marketData.sourceLabel;

export const TOTAL_US_TV_HOUSEHOLDS: number = marketData.totalTvHouseholds;

const byCode = new Map(DMA_MARKETS.map((market) => [market.code, market]));

export function findDmaByCode(code: string): DmaMarket | undefined {
  return byCode.get(code.trim());
}

/** Every market that delivers into the given state, in rank order. */
export function dmasForState(stateCode: string): DmaMarket[] {
  const state = stateCode.trim().toUpperCase();
  return DMA_MARKETS.filter((market) => market.states.includes(state));
}
