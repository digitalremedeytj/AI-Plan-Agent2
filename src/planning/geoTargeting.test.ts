import assert from "node:assert/strict";
import test from "node:test";
import type { GeoTargeting } from "../types";
import {
  MAX_GEO_ENTRIES,
  MAX_UNRESOLVED_TOKENS,
  applyGeographyChoice,
  geoCoverage,
  geoSummaryForPrompt,
  mergeGeoEntries,
  parseGeoList,
  stateEntry,
} from "./geoTargeting";
import { DMA_MARKETS } from "./knowledge/dmaMarkets";

const ids = (result: { entries: { id: string }[] }) => result.entries.map((entry) => entry.id);

function targeting(scope: "state" | "dma", raw: string): GeoTargeting {
  const { entries, unresolved } = parseGeoList(raw, scope);
  return { scope, entries, unresolved, inputMethod: "paste" };
}

test("a comma-separated paste of DMA codes resolves in the order it was entered", () => {
  const result = parseGeoList("501, 803, 602", "dma");
  assert.deepEqual(ids(result), ["501", "803", "602"]);
  assert.deepEqual(result.unresolved, []);
});

test("a market resolves the same whether entered by code or by name", () => {
  assert.deepEqual(ids(parseGeoList("501", "dma")), ids(parseGeoList("New York", "dma")));
});

test("truncated market names are reachable by the city spelled out in full", () => {
  assert.deepEqual(ids(parseGeoList("Sacramento", "dma")), ["862"]);
  assert.deepEqual(ids(parseGeoList("San Francisco", "dma")), ["807"]);
  assert.deepEqual(ids(parseGeoList("Winston Salem", "dma")), ["518"]);
  assert.deepEqual(ids(parseGeoList("Fort Myers", "dma")), ["571"]);
});

test("a name that could mean several markets is reported with its candidates, not guessed", () => {
  const result = parseGeoList("Portland", "dma");
  assert.deepEqual(result.entries, []);
  assert.equal(result.unresolved.length, 1);
  assert.equal(result.unresolved[0].reason, "ambiguous");
  assert.deepEqual(result.unresolved[0].candidates, ["Portland, Or (820)", "Portland-Auburn (500)"]);
});

test("the full market name disambiguates what the bare city name could not", () => {
  assert.deepEqual(ids(parseGeoList("Portland, Or", "dma")), ["820"]);
});

test("an unrecognised entry in a pasted list is reported rather than dropped", () => {
  const result = parseGeoList("New York, Manhatten, Chicago", "dma");
  assert.deepEqual(ids(result), ["501", "602"]);
  assert.deepEqual(result.unresolved, [{ token: "Manhatten", reason: "unknown" }]);
});

test("duplicates collapse to one entry, keeping the position they were first entered in", () => {
  assert.deepEqual(ids(parseGeoList("803, New York, 501, Los Angeles", "dma")), ["803", "501"]);
});

test("an exported spreadsheet reads one market per row without reporting its other columns", () => {
  const csv = [
    "rank,market_name,tv_hhs,%us,dma_code,state",
    '1,New York,"7,348,620",6.407,501,CT-NJ-NY-PA',
    '2,Los Angeles,"5,476,830",4.775,803,CA-NV',
  ].join("\n");
  const result = parseGeoList(csv, "dma");
  assert.deepEqual(ids(result), ["501", "803"]);
  assert.deepEqual(result.unresolved, [], "rank, households and share are not typos");
});

test("a row of a spreadsheet that matches nothing is still reported", () => {
  const csv = [
    "rank,market_name,tv_hhs,%us,dma_code,state",
    '1,New York,"7,348,620",6.407,501,CT-NJ-NY-PA',
    '2,Notamarket,"1,000",0.1,999,ZZ',
  ].join("\n");
  const result = parseGeoList(csv, "dma");
  assert.deepEqual(ids(result), ["501"]);
  assert.equal(result.unresolved.length, 1);
  assert.match(result.unresolved[0].token, /Notamarket/);
});

test("states resolve from a code, a name or a punctuated abbreviation", () => {
  assert.deepEqual(ids(parseGeoList("NY", "state")), ["NY"]);
  assert.deepEqual(ids(parseGeoList("new york", "state")), ["NY"]);
  assert.deepEqual(ids(parseGeoList("N.Y.", "state")), ["NY"]);
  assert.deepEqual(ids(parseGeoList("Washington DC", "state")), ["DC"]);
});

test("every market in the reference can be selected at once", () => {
  const everyMarket = DMA_MARKETS.map((market) => market.code).join("\n");
  const result = parseGeoList(everyMarket, "dma");
  assert.equal(result.entries.length, 210);
  assert.ok(result.entries.length <= MAX_GEO_ENTRIES);
  assert.deepEqual(result.unresolved, []);
});

test("the wrong file pasted in reports a readable sample instead of every bad row", () => {
  const junk = Array.from({ length: 500 }, (_, index) => `not-a-market-${index}`).join("\n");
  const result = parseGeoList(junk, "dma");
  assert.deepEqual(result.entries, []);
  assert.equal(result.unresolved.length, MAX_UNRESOLVED_TOKENS + 1);
  assert.equal(result.unresolved.at(-1)?.reason, "over_limit");
  assert.match(result.unresolved.at(-1)!.token, /450 further unrecognised entries/);
});

test("merging keeps first-seen order and refuses to exceed the cap", () => {
  const merged = mergeGeoEntries(
    [stateEntry("NY")!],
    [stateEntry("NY")!, stateEntry("CA")!],
  );
  assert.deepEqual(merged.map((entry) => entry.id), ["NY", "CA"]);
});

test("DMA coverage totals households and US share from the market reference", () => {
  const coverage = geoCoverage(targeting("dma", "501, 803"));
  assert.equal(coverage?.scope, "dma");
  assert.equal(coverage!.scope === "dma" && coverage.tvHouseholds, 7_348_620 + 5_476_830);
  assert.equal(coverage!.scope === "dma" && coverage.usSharePct, 11.182);
  assert.deepEqual(coverage!.scope === "dma" && coverage.states, ["CA", "CT", "NJ", "NV", "NY", "PA"]);
});

test("state coverage reports market overlap and spill, never a household share", () => {
  const coverage = geoCoverage(targeting("state", "NY"));
  assert.equal(coverage?.scope, "state");
  assert.ok(!("tvHouseholds" in (coverage as object)), "a household roll-up would double-count multi-state markets");
  assert.ok(!("usSharePct" in (coverage as object)));
  if (coverage?.scope !== "state") return;
  assert.ok(coverage.overlappingDmaCount > 0);
  assert.ok(coverage.spillStates.includes("NJ"), "the New York DMA delivers into New Jersey");
});

test("the prompt summary states coverage for DMAs and spill for states", () => {
  const dma = geoSummaryForPrompt(targeting("dma", "501, 803"));
  assert.match(dma, /2 markets/);
  assert.match(dma, /12,825,450 TV households \(11\.182% of US\)/);
  assert.match(dma, /New York \(501, #1\)/);

  const state = geoSummaryForPrompt(targeting("state", "NY, NJ"));
  assert.match(state, /2 states/);
  assert.match(state, /served by \d+ DMAs/);
  assert.doesNotMatch(state, /% of US/, "state scope must not imply a household share");
});

test("a national brief summarises as national", () => {
  assert.equal(
    geoSummaryForPrompt({ scope: "national", entries: [], unresolved: [], inputMethod: "select" }),
    "National (United States).",
  );
});

test("choosing a targeting scope leaves the market the planning engine gates on untouched", () => {
  assert.deepEqual(applyGeographyChoice("dma", "United States"), { market: "United States", scope: "dma" });
  assert.deepEqual(applyGeographyChoice("state", "United States"), { market: "United States", scope: "state" });
});

test("choosing a market clears the scope back to national", () => {
  assert.deepEqual(applyGeographyChoice("United States", "United States"), { market: "United States", scope: "national" });
});
