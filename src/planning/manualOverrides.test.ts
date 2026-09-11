import assert from "node:assert/strict";
import test from "node:test";
import { buildCampaignFacts, buildMediaRecommendationPlan } from "./engine";
import { validateManualPlanTransition } from "./manualOverrides";
import { clonePlanningSettings, DEFAULT_PLANNING_SETTINGS } from "./settings";
import type { ChannelStrategyData } from "../types";

function strategy(requiredChannelIds: string[] = []): ChannelStrategyData {
  const mediaPlan = buildMediaRecommendationPlan(buildCampaignFacts({
    kpis: ["awareness", "reach"],
    audienceDescriptions: ["Streaming television audience"],
    workingMediaBudget: 100_000,
    campaignFlightDays: 30,
    geography: "United States",
    requiredChannelIds,
    planningSettings: clonePlanningSettings(DEFAULT_PLANNING_SETTINGS),
  }));
  return {
    rfpChannels: [],
    scoutAiRecommendedChannels: [],
    executiveInsight: "Test",
    budgetStrategyMode: "reallocation",
    totalRfpBudget: 100_000,
    analyzedPlanNames: [],
    generatedAt: new Date().toISOString(),
    manualIncludedChannelIds: requiredChannelIds,
    manualExcludedChannelIds: [],
    mediaPlan,
  };
}

test("a recalculation that omits the requested media type keeps the last valid plan", () => {
  const previous = strategy();
  const next: ChannelStrategyData = {
    ...previous,
    generatedAt: "next",
    mediaPlan: { ...previous.mediaPlan!, channels: [], selectedMediaTypeCount: 0 },
  };
  const result = validateManualPlanTransition(previous, next, "channel.ctv", "add");
  assert.equal(result.valid, false);
  assert.match(result.error || "", /existing plan was kept unchanged/i);
});

test("a planner override is honoured below the product budget minimum", () => {
  const forced = strategy(["channel.linear_tv"]);
  assert.ok(forced.mediaPlan?.channels.some((channel) => channel.channelId === "channel.linear_tv"));
  const result = validateManualPlanTransition(strategy(), forced, "channel.linear_tv", "add");
  assert.equal(result.valid, true);
});

test("removing the final channel accepts an empty allocation when the candidate catalog remains", () => {
  const previous = strategy();
  const channelId = previous.mediaPlan!.channels[0].channelId;
  const next: ChannelStrategyData = {
    ...previous,
    generatedAt: "next",
    mediaPlan: { ...previous.mediaPlan!, channels: [], selectedMediaTypeCount: 0 },
  };
  assert.equal(validateManualPlanTransition(previous, next, channelId, "remove").valid, true);
});

test("a response that drops the candidate catalog is rejected", () => {
  const previous = strategy();
  const next: ChannelStrategyData = {
    ...previous,
    generatedAt: "next",
    mediaPlan: { ...previous.mediaPlan!, evaluatedCandidates: [] },
  };
  assert.equal(validateManualPlanTransition(previous, next, previous.mediaPlan!.channels[0].channelId, "remove").valid, false);
});
