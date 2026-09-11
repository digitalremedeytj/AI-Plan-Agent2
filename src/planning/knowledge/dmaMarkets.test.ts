import assert from "node:assert/strict";
import test from "node:test";
import { DMA_MARKETS, DMA_SOURCE_LABEL, TOTAL_US_TV_HOUSEHOLDS, dmasForState, findDmaByCode } from "./dmaMarkets";
import { findStateByCode } from "./usStates";

test("the market reference carries all 210 markets with unique codes and names", () => {
  assert.equal(DMA_MARKETS.length, 210);
  assert.equal(new Set(DMA_MARKETS.map((market) => market.code)).size, 210);
  assert.equal(new Set(DMA_MARKETS.map((market) => market.name)).size, 210);
  assert.equal(new Set(DMA_MARKETS.map((market) => market.rank)).size, 210);
});

test("every market has a rank, households and at least one state", () => {
  for (const market of DMA_MARKETS) {
    assert.ok(market.rank >= 1 && market.rank <= 210, `rank out of range for ${market.code}`);
    assert.ok(market.tvHouseholds > 0, `no households for ${market.code}`);
    assert.ok(market.states.length > 0, `no states for ${market.code}`);
  }
});

test("household totals match the source export, so coverage math can be trusted", () => {
  const summed = DMA_MARKETS.reduce((total, market) => total + market.tvHouseholds, 0);
  assert.equal(summed, 114_695_130);
  assert.equal(TOTAL_US_TV_HOUSEHOLDS, summed);
  const share = DMA_MARKETS.reduce((total, market) => total + market.usSharePct, 0);
  assert.ok(Math.abs(share - 100) < 0.01, `US share sums to ${share}`);
});

test("every state code in the market reference resolves to a named state", () => {
  const codes = new Set(DMA_MARKETS.flatMap((market) => market.states));
  assert.equal(codes.size, 51, "50 states plus DC");
  for (const code of codes) {
    assert.ok(findStateByCode(code), `no state named for ${code}`);
  }
});

test("the household figures carry the vintage they will be cited with", () => {
  assert.equal(DMA_SOURCE_LABEL, "U.S. Census Bureau, 2025");
});

test("markets are reachable by code and by state", () => {
  assert.equal(findDmaByCode("501")?.name, "New York");
  assert.equal(findDmaByCode("999"), undefined);
  assert.ok(dmasForState("ny").some((market) => market.code === "501"));
  assert.ok(dmasForState("NJ").some((market) => market.code === "501"), "New York DMA serves New Jersey");
});
