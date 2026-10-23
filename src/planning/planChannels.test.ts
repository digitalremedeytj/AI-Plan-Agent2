import assert from "node:assert/strict";
import test from "node:test";
import { combinedPlan } from "./planChannels";
import { RFP_OPTIONS, rfpStrategy } from "./testing/rfpPlans";

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

test("add on top of RFP totals the kept RFP dollars plus the additional budget, with shares that add to 100%", () => {
  const strategy = rfpStrategy("incremental", 25_000);
  const plan = combinedPlan(strategy);
  assert.equal(plan.allocatedBudget, 25_000);
  assert.equal(plan.keptAtRfpBudget, 50_000);
  assert.equal(plan.total, 75_000);
  assert.deepEqual(plan.keptChannels.map((c) => [c.channelId, c.allocationDollars, c.keptAtRfp]).sort(), [
    ["channel.ctv", 30_000, true],
    ["channel.dooh", 20_000, true],
  ]);
  assert.equal(sum(plan.channels.map((c) => c.allocationDollars)), 75_000);
  assert.ok(Math.abs(sum(plan.channels.map((c) => c.allocationPercent)) - 100) < 0.1);
  // Kept media types carry the catalog's CPMs, so impressions can be estimated for them.
  assert.ok(plan.keptChannels.every((c) => c.typicalCpmLow !== null || c.typicalCpmHigh !== null));
  // The stored plan is untouched: the view re-bases copies.
  assert.equal(sum(strategy.mediaPlan!.channels.map((c) => c.allocationDollars)), 25_000);
});

test("plans in the other budget approaches read exactly as stored", () => {
  for (const [mode, additional] of [["reallocation", 0], ["grow", 25_000]] as const) {
    const strategy = rfpStrategy(mode, additional);
    const plan = combinedPlan(strategy);
    assert.equal(plan.channels, strategy.mediaPlan!.channels, mode);
    assert.equal(plan.total, strategy.mediaPlan!.workingMediaBudget, mode);
    assert.equal(plan.keptChannels.length, 0, mode);
  }
});

test("an add-on-top plan saved before RFP dollars were recorded reads as stored instead of inventing a total", () => {
  const strategy = rfpStrategy("incremental", 25_000);
  delete strategy.mediaPlan!.rfpBaseline;
  strategy.rfpChannels = [{ channelId: "channel.ctv", channelName: "CTV" } as any];
  const plan = combinedPlan(strategy);
  assert.equal(plan.total, 25_000);
  assert.equal(plan.channels, strategy.mediaPlan!.channels);
});

test("an RFP media type the RFP gave $0 is still listed as in the plan, at 0%", () => {
  const strategy = rfpStrategy("incremental", 25_000);
  const dooh = strategy.mediaPlan!.rfpBaseline!.channels.find((c) => c.channelId === "channel.dooh")!;
  dooh.dollars = 0;
  const plan = combinedPlan(strategy);
  assert.equal(plan.total, 55_000);
  assert.deepEqual(plan.keptChannels.map((c) => [c.channelId, c.allocationPercent]).sort(), [["channel.ctv", 54.55], ["channel.dooh", 0]]);
});

test("a plan used as is reads as stored, unless uploaded lines outside the catalog add to its total", () => {
  const plain = rfpStrategy("asIs");
  assert.equal(combinedPlan(plain).channels, plain.mediaPlan!.channels);
  assert.equal(combinedPlan(plain).total, 50_000);

  const withPrint = rfpStrategy("asIs", 0, [{ ...RFP_OPTIONS[0], placements: [...RFP_OPTIONS[0].placements, { mediaType: "Print", productType: "Newspaper insert", budget: 10_000 }] }]);
  const plan = combinedPlan(withPrint);
  assert.equal(plan.allocatedBudget, 50_000);
  assert.equal(plan.outsideCatalogBudget, 10_000);
  assert.equal(plan.total, 60_000);
  assert.deepEqual(plan.outsideCatalog, [{ name: "Print · Newspaper insert", dollars: 10_000 }]);
  assert.deepEqual(plan.keptChannels, []);
  // Shares are of the whole plan, so the media types and the print line add to 100%.
  assert.equal(Math.round(sum(plan.channels.map((c) => c.allocationPercent)) + (10_000 / 60_000) * 100), 100);
});
