import assert from "node:assert/strict";
import test from "node:test";
import { geoSnapshotFromBrief } from "./geoFootprint";
import { MAX_TEST_UNITS, matchedMarketDesign } from "./matchedMarkets";
import { DMA_MARKETS } from "./knowledge/dmaMarkets";

const NEW_ENGLAND = { type: "DMA" as const, targets: ["Boston (Manchester), MA", "Hartford & New Haven, CT", "Providence-New Bedford, RI"] };

test("each targeted market gets its own untargeted control of comparable size", () => {
  const design = matchedMarketDesign(geoSnapshotFromBrief(NEW_ENGLAND))!;
  const targeted = new Set(design.pairs.map((pair) => pair.test.id));
  const controls = design.pairs.map((pair) => pair.control!);
  assert.equal(new Set(controls.map((c) => c.id)).size, controls.length);
  for (const pair of design.pairs) {
    assert.ok(!targeted.has(pair.control!.id));
    const ratio = pair.control!.households / pair.test.households;
    assert.ok(ratio >= 0.6 && ratio <= 1 / 0.6, `${pair.test.name} -> ${pair.control!.name}`);
  }
});

test("a control is drawn from the same part of the country when one is comparable", () => {
  const design = matchedMarketDesign(geoSnapshotFromBrief({ type: "DMA", targets: ["Elmira (Corning), NY"] }))!;
  assert.equal(design.pairs[0].match, "Same division");
});

test("the same footprint always proposes the same controls", () => {
  const a = matchedMarketDesign(geoSnapshotFromBrief(NEW_ENGLAND));
  const b = matchedMarketDesign(geoSnapshotFromBrief(NEW_ENGLAND));
  assert.deepEqual(a, b);
});

test("a state the campaign spills into is never a control", () => {
  const design = matchedMarketDesign(geoSnapshotFromBrief({ type: "State", targets: ["Virginia (VA)", "Maryland (MD)"] }))!;
  const exposed = ["VA", "MD", "DC", "WV", "PA", "DE", "NC", "KY", "TN"];
  for (const pair of design.pairs) assert.ok(!exposed.includes(pair.control!.id), pair.control!.id);
});

test("a market with nothing comparable says so instead of taking a poor match", () => {
  const design = matchedMarketDesign(geoSnapshotFromBrief({ type: "DMA", targets: ["New York, NY", "Los Angeles, CA"] }))!;
  assert.equal(design.pairs.find((pair) => pair.test.id === "501")!.control, null);
  // Totals compare like with like: an unmatched market is out of both.
  assert.equal(design.testHouseholds, design.pairs.find((pair) => pair.test.id === "803")!.test.households);
});

test("national plans, very large footprints and long market lists get no design", () => {
  assert.equal(matchedMarketDesign(undefined), null);
  const many = DMA_MARKETS.slice(60, 60 + MAX_TEST_UNITS + 1).map((market) => market.code);
  assert.equal(matchedMarketDesign({ scope: "dma", entries: many.map((id) => ({ id, name: id })), unresolved: [], inputMethod: "select" }), null);
  const bigStates = ["CA", "TX", "FL", "NY", "PA", "IL", "OH", "GA", "NC", "MI"].map((id) => ({ id, name: id }));
  assert.equal(matchedMarketDesign({ scope: "state", entries: bigStates, unresolved: [], inputMethod: "select" }), null);
});
