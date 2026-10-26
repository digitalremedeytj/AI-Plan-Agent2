import assert from "node:assert/strict";
import test from "node:test";
import { buildCampaignFacts, buildMediaRecommendationPlan } from "../engine";
import { clonePlanningSettings, DEFAULT_PLANNING_SETTINGS } from "../settings";
import { replayInputsFromRecord, replayMix, sameSelection } from "./mixReplay";

const savedRecord = (overrides: Record<string, unknown> = {}, strategyOverrides: Record<string, unknown> = {}) => {
  const planningSettings = clonePlanningSettings(DEFAULT_PLANNING_SETTINGS);
  const kpis = ["purchases"];
  const mediaPlan = buildMediaRecommendationPlan(buildCampaignFacts({
    kpis,
    campaignFocus: "Online sales",
    workingMediaBudget: 100_000,
    campaignFlightDays: 30,
    geography: "United States",
    planningSettings,
  }), ["channel.search", "channel.ctv", "channel.social_meta", "channel.display", "channel.olv"].map((channelId, index) => ({
    channelId,
    components: { kpiAndFunnelFit: 90 - index * 4, audienceAndPersonaFit: 90 - index * 4, incrementalGapCoverage: 80, dataReadiness: 80, creativeReadiness: 80, measurementFit: 80 },
  })));
  mediaPlan.evaluatedCandidates = mediaPlan.evaluatedCandidates.map((candidate) => ({ ...candidate, aiAssessed: true }));
  return {
    id: "plan-1",
    title: "Saved plan",
    archived: false,
    ...overrides,
    payload: JSON.stringify({
      kpis,
      campaignFocus: "Online sales",
      geography: "United States",
      planningSettings,
      profile: { channelStrategy: { mediaPlan, manualIncludedChannelIds: [], manualExcludedChannelIds: [], ...strategyOverrides } },
    }),
  };
};

test("replaying a saved plan through an unchanged engine chooses the same media types and split", () => {
  const outcome = replayInputsFromRecord(savedRecord());
  assert.ok(outcome.ok && "inputs" in outcome);
  const replayed = replayMix("plan-1", "Saved plan", outcome.inputs);
  assert.ok(sameSelection(replayed, outcome.stored));
  assert.deepEqual(replayed.channels.map((channel) => channel.percent), outcome.stored.channels.map((channel) => channel.percent));
});

test("plans the engine cannot replay faithfully are skipped with a reason, not guessed at", () => {
  const archived = replayInputsFromRecord(savedRecord({ archived: true }));
  const handEdited = replayInputsFromRecord(savedRecord({}, { hasManualAllocationChanges: true }));
  assert.ok("reason" in archived && archived.reason === "archived");
  assert.ok("reason" in handEdited && handEdited.reason.includes("by hand"));
});
