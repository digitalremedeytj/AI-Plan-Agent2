import assert from "node:assert/strict";
import test from "node:test";
import type { ChannelStrategyData, ParsedPlanOption } from "../types";
import { buildAllocationView, WHY_LABELS } from "./allocationRows";
import { resolveStrategyBudget, type BudgetStrategyMode } from "./budgetStrategy";
import { buildCampaignFacts, buildMediaRecommendationPlan } from "./engine";
import { addMediaTypeAndRebalance } from "./manualAllocations";
import { clonePlanningSettings, DEFAULT_PLANNING_SETTINGS } from "./settings";

const rfp: ParsedPlanOption[] = [{
  id: "rfp",
  name: "RFP",
  selected: true,
  budget: 50_000,
  rawChannels: [],
  lineItemsCount: 3,
  placements: [
    { mediaType: "Video", productType: "OTT", budget: 30_000 },
    { mediaType: "Digital Out of Home", productType: "DOOH", budget: 20_000 },
    { mediaType: "Advanced Measurement", productType: "Halo Effect Study", budget: 0 },
  ],
}];

function strategyFor(mode: BudgetStrategyMode, additional = 0, options: { excludedChannelIds?: string[]; plan?: ParsedPlanOption[] } = {}): ChannelStrategyData {
  const budget = resolveStrategyBudget(mode, 50_000, additional);
  const mediaPlan = buildMediaRecommendationPlan(buildCampaignFacts({
    kpis: ["awareness", "reach"],
    audienceDescriptions: ["Streaming and out-of-home audiences"],
    workingMediaBudget: budget.allocatedBudget,
    campaignFlightDays: 30,
    geography: "United States",
    planningMode: mode,
    selectedPlanOptions: options.plan || rfp,
    excludedChannelIds: options.excludedChannelIds,
    planningSettings: clonePlanningSettings(DEFAULT_PLANNING_SETTINGS),
  }));
  // The server refuses to plan without AI reasoning for every candidate, so a real plan's
  // candidates are all AI-assessed; these engine-only plans are marked to match.
  mediaPlan.evaluatedCandidates = mediaPlan.evaluatedCandidates.map((candidate) => ({ ...candidate, aiAssessed: true }));
  return {
    rfpChannels: [],
    scoutAiRecommendedChannels: [],
    executiveInsight: "",
    budgetStrategyMode: mode,
    additionalBudget: budget.additionalBudget,
    rfpMediaBudget: 50_000,
    totalRfpBudget: mediaPlan.workingMediaBudget,
    analyzedPlanNames: ["RFP"],
    generatedAt: "2026-10-15T00:00:00.000Z",
    manualExcludedChannelIds: options.excludedChannelIds,
    mediaPlan,
  };
}

const placedIds = (view: ReturnType<typeof buildAllocationView>) => [...view.rfpRows, ...view.rfpNotFunded].map((row) => row.channelId).sort();

test("every RFP media type is either in the plan or listed as not funded, never dropped", () => {
  for (const mode of ["reallocation", "incremental", "grow"] as const) {
    const view = buildAllocationView(strategyFor(mode, mode === "reallocation" ? 0 : 25_000));
    assert.deepEqual(placedIds(view), ["channel.ctv", "channel.dooh"], mode);
    assert.equal(view.summary.rfpCount, 2);
  }
});

test("optimizing the RFP budget shows each RFP media type's RFP dollars and the change", () => {
  const view = buildAllocationView(strategyFor("reallocation"));
  assert.equal(view.planTotal, 50_000);
  view.rfpRows.forEach((row) => {
    assert.equal(row.source, "rfp");
    assert.equal(row.rfpDollars, row.channelId === "channel.ctv" ? 30_000 : 20_000);
    assert.equal(row.changeDollars, Math.round(((row.dollars ?? 0) - (row.rfpDollars ?? 0)) * 100) / 100);
  });
});

test("add on top of RFP keeps RFP media types at their RFP dollars and allocates only the additional budget", () => {
  const view = buildAllocationView(strategyFor("incremental", 25_000));
  assert.equal(view.allocatedBudget, 25_000);
  assert.equal(view.planTotal, 75_000);
  assert.equal(view.rfpRows.length, 2);
  view.rfpRows.forEach((row) => {
    assert.equal(row.keptAtRfp, true);
    assert.equal(row.inAllocation, false);
    assert.equal(row.dollars, row.rfpDollars);
    assert.equal(row.changeDollars, 0);
  });
  assert.ok(view.addedRows.length > 0);
  assert.ok(view.addedRows.every((row) => row.source === "scoutai" && row.rfpDollars === null));
  const shown = [...view.rfpRows, ...view.addedRows].reduce((sum, row) => sum + (row.dollars ?? 0), 0);
  assert.equal(Math.round(shown * 100) / 100, 75_000);
  const percent = [...view.rfpRows, ...view.addedRows].reduce((sum, row) => sum + (row.percentOfTotal ?? 0), 0);
  assert.ok(Math.abs(percent - 100) < 0.01);
});

test("optimizing an increased budget allocates the RFP budget plus the additional budget together", () => {
  const view = buildAllocationView(strategyFor("grow", 25_000));
  assert.equal(view.allocatedBudget, 75_000);
  assert.equal(view.planTotal, 75_000);
  assert.ok(view.rfpRows.every((row) => row.inAllocation && !row.keptAtRfp));
});

test("a removed RFP media type says the planner removed it rather than the engine's wording", () => {
  const view = buildAllocationView(strategyFor("reallocation", 0, { excludedChannelIds: ["channel.dooh"] }));
  const dooh = view.rfpNotFunded.find((row) => row.channelId === "channel.dooh");
  assert.ok(dooh);
  assert.equal(dooh.whyLabel, WHY_LABELS.notFunded);
  assert.equal(dooh.why, "Removed from this plan by your Digital Remedy planner.");
  assert.equal(dooh.changeDollars, -20_000);
});

test("a media type the planner added is labelled as theirs, not ScoutAI's", () => {
  const strategy = strategyFor("reallocation");
  const addable = strategy.mediaPlan!.evaluatedCandidates.find((candidate) =>
    !strategy.mediaPlan!.channels.some((channel) => channel.channelId === candidate.product.id)
    && candidate.product.status === "live" && candidate.product.digitalRemedyExecutable && candidate.product.recommendationEligible
    && candidate.product.id !== "channel.ctv" && candidate.product.id !== "channel.dooh");
  assert.ok(addable);
  const view = buildAllocationView({
    ...strategy,
    manualIncludedChannelIds: [addable.product.id],
    mediaPlan: addMediaTypeAndRebalance(strategy.mediaPlan!, addable.product.id),
  });
  assert.equal(view.addedRows.find((row) => row.channelId === addable.product.id)?.source, "planner");
  assert.equal(view.summary.plannerAdded, 1);
});

test("recommended additions are qualified media types only, best score first", () => {
  const strategy = strategyFor("reallocation");
  const view = buildAllocationView(strategy);
  assert.ok(view.recommendedAdditions.length > 0);
  const byId = new Map(strategy.mediaPlan!.evaluatedCandidates.map((candidate) => [candidate.product.id, candidate]));
  view.recommendedAdditions.forEach((row, index) => {
    const candidate = byId.get(row.channelId)!;
    assert.ok(candidate.status === "ADD" || candidate.status === "TEST");
    assert.equal(candidate.eligibilityFailures.length, 0);
    assert.equal(row.whyLabel, WHY_LABELS.addition);
    if (index > 0) assert.ok((view.recommendedAdditions[index - 1].score ?? 0) >= (row.score ?? 0));
  });
  assert.ok(view.recommendedAdditions.every((row) => !view.rfpRows.some((rfpRow) => rfpRow.channelId === row.channelId)));
});

test("scores are shown out of 100 from the engine's own components, and hidden without AI reasoning", () => {
  const strategy = strategyFor("reallocation");
  const view = buildAllocationView(strategy);
  const row = view.rfpRows[0];
  const candidate = strategy.mediaPlan!.evaluatedCandidates.find((item) => item.product.id === row.channelId)!;
  assert.equal(row.score, candidate.recommendationScore);
  assert.equal(row.audienceFit, Math.round(candidate.components.audienceAndPersonaFit));
  assert.equal(row.goalMatch, Math.round(candidate.components.kpiAndFunnelFit));
  const unassessed = buildAllocationView({
    ...strategy,
    mediaPlan: { ...strategy.mediaPlan!, evaluatedCandidates: strategy.mediaPlan!.evaluatedCandidates.map((item) => ({ ...item, aiAssessed: false })) },
  });
  assert.equal(unassessed.rfpRows[0].score, null);
  assert.equal(unassessed.recommendedAdditions.length, 0);
});

test("a plan saved before the RFP baseline existed still shows its RFP media types, without dollars", () => {
  const strategy = strategyFor("incremental", 25_000);
  const { rfpBaseline: _dropped, ...oldPlan } = strategy.mediaPlan!;
  const view = buildAllocationView({
    ...strategy,
    mediaPlan: oldPlan,
    rfpChannels: [
      { channelName: "CTV", canonicalId: "ctv", channelId: "channel.ctv", isRecommended: false, score: 7, audienceFit: 7, goalMatch: 7, mediaConsumptionEvidence: "", whyItEarnsASpot: "" },
    ],
  });
  assert.equal(view.rfpRows.length, 1);
  assert.equal(view.rfpRows[0].keptAtRfp, true);
  assert.equal(view.rfpRows[0].dollars, null);
  assert.equal(view.rfpRows[0].rfpDollars, null);
  assert.equal(view.planTotal, 25_000);
});

test("a growth choice without an additional budget is refused instead of silently doubling the plan", () => {
  assert.throws(() => resolveStrategyBudget("incremental", 50_000, 0), /additional budget/);
  assert.throws(() => resolveStrategyBudget("grow", 50_000, undefined), /additional budget/);
  assert.deepEqual(resolveStrategyBudget("reallocation", 50_000, 25_000), { allocatedBudget: 50_000, additionalBudget: 0 });
  assert.deepEqual(resolveStrategyBudget("grow", 50_000, 25_000), { allocatedBudget: 75_000, additionalBudget: 25_000 });
});

const withPrint: ParsedPlanOption[] = [{
  ...rfp[0],
  placements: [...rfp[0].placements, { mediaType: "Print", productType: "Newspaper insert", budget: 5_000 }, { mediaType: "Print", productType: "Newspaper insert", budget: 2_500 }],
}];

test("using the plan as is funds exactly the uploaded media types at exactly their uploaded dollars", () => {
  const strategy = strategyFor("asIs");
  const plan = strategy.mediaPlan!;
  assert.equal(plan.planningMode, "asIs");
  assert.equal(plan.workingMediaBudget, 50_000);
  assert.deepEqual(
    plan.channels.map((channel) => [channel.channelId, channel.allocationDollars, channel.allocationPercent]),
    [["channel.ctv", 30_000, 60], ["channel.dooh", 20_000, 40]],
  );
  const view = buildAllocationView(strategy);
  assert.equal(view.asIs, true);
  assert.equal(view.planTotal, 50_000);
  view.rfpRows.forEach((row) => assert.equal(row.changeDollars, 0));
  assert.deepEqual(view.addedRows, []);
  assert.deepEqual(view.rfpNotFunded, []);
  assert.deepEqual(view.recommendedAdditions, [], "a plan used as is offers no upsell");
});

test("a plan used as is keeps a media type even when the engine would not fund it at that budget", () => {
  const tiny: ParsedPlanOption[] = [{ ...rfp[0], budget: 1_500, placements: [{ mediaType: "Video", productType: "OTT", budget: 1_000 }, { mediaType: "Digital Out of Home", productType: "DOOH", budget: 500 }] }];
  const plan = strategyFor("asIs", 0, { plan: tiny }).mediaPlan!;
  assert.deepEqual(plan.channels.map((channel) => [channel.channelId, channel.allocationDollars]), [["channel.ctv", 1_000], ["channel.dooh", 500]]);
});

test("uploaded lines outside the catalog are rows at their dollars when the plan is used as is, and only a warning otherwise", () => {
  const asIs = buildAllocationView(strategyFor("asIs", 0, { plan: withPrint }));
  const print = asIs.rfpRows.find((row) => row.outsideCatalog);
  assert.equal(print?.channelName, "Print · Newspaper insert");
  assert.equal(print?.dollars, 7_500, "lines with the same label are one row");
  assert.equal(asIs.planTotal, 57_500);
  assert.equal(Math.round(asIs.rfpRows.reduce((sum, row) => sum + (row.percentOfTotal || 0), 0)), 100);
  assert.deepEqual(asIs.unmatchedLines, [], "no warning: they are rows");
  assert.equal(asIs.summary.rfpFunded, 2, "the summary counts media types, not uploaded lines");

  const optimized = buildAllocationView(strategyFor("reallocation", 0, { plan: withPrint }));
  assert.equal(optimized.rfpRows.some((row) => row.outsideCatalog), false);
  assert.equal(optimized.unmatchedLines.length, 2);
});

test("using the plan as is needs no additional budget", () => {
  assert.deepEqual(resolveStrategyBudget("asIs", 50_000, undefined), { allocatedBudget: 50_000, additionalBudget: 0 });
});
