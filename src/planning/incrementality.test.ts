import assert from "node:assert/strict";
import test from "node:test";
import type { ChannelStrategyData } from "../types";
import { incrementalityView, isPerformanceKpi } from "./incrementality";
import { DEFAULT_INCREMENTALITY_MIN_MONTHLY_SPEND } from "./settings";

/** A plan that spends `total` over `flightDays`, split across the given media types. */
function strategy(total: number, flightDays: number, split: Array<[string, string, number]>): ChannelStrategyData {
  return {
    budgetStrategyMode: "reallocation",
    mediaPlan: {
      workingMediaBudget: total,
      flightDays,
      channels: split.map(([channelId, channelName, share]) => ({ channelId, channelName, allocationDollars: total * share, allocationPercent: share * 100 })),
    },
  } as unknown as ChannelStrategyData;
}

const PET_PLAN: Array<[string, string, number]> = [
  ["channel.ctv", "CTV / OTT", 0.55],
  ["channel.display_retargeting", "Display Retargeting", 0.15],
  ["channel.search", "Search", 0.12],
  ["channel.social_meta", "Social - Meta", 0.18],
];
const PUBLISHERS = [{ publisher: "Hulu" }, { publisher: "Peacock" }, { publisher: "Roku" }] as any;

test("a performance plan at the threshold qualifies, read from the whole plan's monthly spend", () => {
  const view = incrementalityView({ strategy: strategy(200_000, 60, PET_PLAN), kpis: ["ROAS"], ctvPublishers: PUBLISHERS, threshold: undefined })!;
  assert.equal(view.monthlySpend, 100_000);
  assert.equal(view.threshold, DEFAULT_INCREMENTALITY_MIN_MONTHLY_SPEND);
  assert.equal(view.eligible, true);
  assert.equal(view.metric, "Incremental ROAS");
  assert.ok(!view.otherMetrics.includes("Incremental ROAS"));
});

test("a plan under the threshold says how much more it needs", () => {
  const view = incrementalityView({ strategy: strategy(72_000, 30, PET_PLAN), kpis: ["CPA"], threshold: 100_000 })!;
  assert.equal(view.eligible, false);
  assert.equal(view.shortfall, 28_000);
  assert.equal(view.metric, "Incremental CPA");
});

test("the plan's pinned threshold is the one applied", () => {
  const view = incrementalityView({ strategy: strategy(60_000, 30, PET_PLAN), kpis: ["Purchases"], threshold: 50_000 })!;
  assert.equal(view.eligible, true);
  assert.equal(view.metric, "Incremental conversion rate");
});

test("brand KPIs never qualify, however large the plan", () => {
  for (const kpi of ["Awareness", "Reach", "VCR", "Brand lift"]) assert.equal(isPerformanceKpi(kpi), false, kpi);
  const view = incrementalityView({ strategy: strategy(1_000_000, 30, PET_PLAN), kpis: ["Awareness", "Reach"], threshold: 100_000 })!;
  assert.equal(view.eligible, false);
  assert.equal(view.metric, null);
  assert.deepEqual(view.questions, []);
});

test("only the media types the measurement reads count as measured", () => {
  const view = incrementalityView({ strategy: strategy(200_000, 30, PET_PLAN), kpis: ["ROAS"], ctvPublishers: PUBLISHERS, threshold: 100_000 })!;
  assert.deepEqual(view.measured.map((line) => line.name), ["CTV / OTT", "Display Retargeting"]);
  assert.deepEqual(view.notMeasured.map((line) => line.name), ["Search", "Social - Meta"]);
  assert.equal(view.measuredPct, 70);
});

test("the questions name the plan's own media types and publishers", () => {
  const view = incrementalityView({ strategy: strategy(200_000, 30, PET_PLAN), kpis: ["ROAS"], ctvPublishers: PUBLISHERS, threshold: 100_000 })!;
  const text = view.questions.map((question) => question.text).join(" ");
  assert.match(text, /CTV \/ OTT plus Display Retargeting drive more incremental revenue than CTV \/ OTT alone/);
  assert.match(text, /Hulu then Peacock, or Peacock alone/);
});

test("a plan with nothing the measurement reads does not qualify", () => {
  const view = incrementalityView({ strategy: strategy(500_000, 30, [["channel.search", "Search", 1]]), kpis: ["ROAS"], threshold: 100_000 })!;
  assert.equal(view.eligible, false);
});
