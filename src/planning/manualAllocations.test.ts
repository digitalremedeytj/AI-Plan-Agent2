import assert from "node:assert/strict";
import test from "node:test";
import { buildCampaignFacts, buildMediaRecommendationPlan } from "./engine";
import {
  addMediaTypeAndRebalance,
  allocationBasisPoints,
  applyBasisPointAllocations,
  rebalanceEditedAllocation,
  removeMediaTypeAndRebalance,
} from "./manualAllocations";
import { clonePlanningSettings, DEFAULT_PLANNING_SETTINGS } from "./settings";

function plan() {
  return buildMediaRecommendationPlan(buildCampaignFacts({
    kpis: ["awareness", "reach", "consideration", "engagement"],
    audienceDescriptions: ["Streaming, audio, social, and broad digital audiences"],
    workingMediaBudget: 100_000,
    campaignFlightDays: 30,
    geography: "United States",
    creativeReadiness: {
      displayAssets: true,
      onlineVideoAssets: true,
      ctvVideoAssets: true,
      audioAssets: true,
      socialAssets: true,
      nativeContent: true,
      doohAssets: true,
    },
    planningSettings: clonePlanningSettings(DEFAULT_PLANNING_SETTINGS),
  }));
}

test("manual allocation editing keeps locked rows fixed and total budget exact", () => {
  const original = plan();
  assert.ok(original.channels.length >= 3);
  const current = allocationBasisPoints(original);
  const editable = original.channels.find((channel) => {
    const minimum = Math.max(
      channel.minimumAllocationPercent * 100,
      Math.ceil((channel.minimumTotalSpend / original.workingMediaBudget) * 10_000),
    );
    return current[channel.channelId] - minimum >= 100;
  });
  assert.ok(editable);
  const locked = original.channels.find((channel) => channel.channelId !== editable.channelId);
  assert.ok(locked);
  const nextBasisPoints = rebalanceEditedAllocation(
    original,
    editable.channelId,
    current[editable.channelId] - 100,
    [locked.channelId],
  );
  assert.equal(nextBasisPoints[locked.channelId], current[locked.channelId]);
  assert.equal(Object.values(nextBasisPoints).reduce((sum, value) => sum + value, 0), 10_000);

  const updated = applyBasisPointAllocations(original, nextBasisPoints, "Test edit");
  assert.ok(Math.abs(updated.channels.reduce((sum, channel) => sum + channel.allocationPercent, 0) - 100) < 0.0001);
  assert.equal(updated.channels.reduce((sum, channel) => sum + channel.allocationDollars, 0), original.workingMediaBudget);
  assert.ok(updated.channels.every((channel) => Number.isInteger(channel.allocationPercent)));
});

test("adding and removing a media type preserves membership and the fixed budget", () => {
  const planningSettings = clonePlanningSettings(DEFAULT_PLANNING_SETTINGS);
  const audio = planningSettings.products.find((product) => product.productId === "channel.audio");
  assert.ok(audio);
  audio.minimumTotalSpend = 1_000;
  audio.minimumNormalized30DaySpend = 1_000;
  audio.minimumFlightDays = 1;
  audio.minimumAllocationPercent = 10;
  audio.maximumAllocationPercent = 40;
  const original = buildMediaRecommendationPlan(buildCampaignFacts({
    kpis: ["awareness", "reach", "frequency"],
    audienceDescriptions: ["Audio streaming and broad digital audience"],
    workingMediaBudget: 4_999,
    campaignFlightDays: 30,
    geography: "United States",
    creativeReadiness: { audioAssets: true, displayAssets: true },
    planningSettings,
  }));
  const originalIds = new Set(original.channels.map((channel) => channel.channelId));
  const candidate = original.evaluatedCandidates.find((item) => item.product.id === "channel.audio");
  assert.ok(candidate);

  const added = addMediaTypeAndRebalance(original, candidate.product.id);
  assert.equal(added.workingMediaBudget, original.workingMediaBudget);
  assert.equal(added.channels.length, original.channels.length + 1);
  originalIds.forEach((id) => assert.ok(added.channels.some((channel) => channel.channelId === id)));
  assert.ok(Math.abs(added.channels.reduce((sum, channel) => sum + channel.allocationPercent, 0) - 100) < 0.0001);
  assert.equal(added.channels.reduce((sum, channel) => sum + channel.allocationDollars, 0), original.workingMediaBudget);

  const removed = removeMediaTypeAndRebalance(added, candidate.product.id);
  assert.equal(removed.workingMediaBudget, original.workingMediaBudget);
  assert.deepEqual(new Set(removed.channels.map((channel) => channel.channelId)), originalIds);
  assert.ok(Math.abs(removed.channels.reduce((sum, channel) => sum + channel.allocationPercent, 0) - 100) < 0.0001);
  assert.equal(removed.channels.reduce((sum, channel) => sum + channel.allocationDollars, 0), original.workingMediaBudget);
});

test("manual allocation editing rejects values below effective minimum", () => {
  const original = plan();
  const channel = original.channels[0];
  assert.throws(
    () => rebalanceEditedAllocation(original, channel.channelId, 1),
    /must stay between/i,
  );
});

test("manual allocation persistence rejects fractional percentages", () => {
  const original = plan();
  const points = allocationBasisPoints(original);
  const ids = Object.keys(points);
  assert.ok(ids.length >= 2);
  points[ids[0]] += 50;
  points[ids[1]] -= 50;
  assert.throws(
    () => applyBasisPointAllocations(original, points, "Fractional test"),
    /whole numbers/i,
  );
});
