import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildCampaignFacts, buildMediaRecommendationPlan } from "../planning/engine";
import { clonePlanningSettings, DEFAULT_PLANNING_SETTINGS } from "../planning/settings";
import type { ChannelStrategyData } from "../types";
import { ChannelStrategySection } from "./ChannelStrategySection";

test("media types render collapsed with manual add and remove controls", () => {
  const mediaPlan = buildMediaRecommendationPlan(buildCampaignFacts({
    kpis: ["awareness", "reach"],
    audienceDescriptions: ["Streaming television and broad digital audience"],
    workingMediaBudget: 25_000,
    campaignFlightDays: 30,
    geography: "United States",
    planningSettings: clonePlanningSettings(DEFAULT_PLANNING_SETTINGS),
  }));
  assert.ok(mediaPlan.channels.length > 0);
  assert.ok(mediaPlan.evaluatedCandidates.length > mediaPlan.channels.length);
  const data: ChannelStrategyData = {
    rfpChannels: [],
    scoutAiRecommendedChannels: [],
    executiveInsight: "Test plan",
    budgetStrategyMode: "reallocation",
    totalRfpBudget: 25_000,
    analyzedPlanNames: [],
    generatedAt: "2026-08-31T00:00:00.000Z",
    manualIncludedChannelIds: [],
    manualExcludedChannelIds: [],
    mediaPlan,
  };
  const markup = renderToStaticMarkup(
    <ChannelStrategySection
      data={data}
      onManualMediaTypeChange={async () => undefined}
      onSaveAllocations={async () => undefined}
    />,
  );
  assert.match(markup, /aria-expanded="false"/);
  assert.match(markup, /aria-controls="media-type-details-/);
  assert.match(markup, /aria-label="Remove [^"]+ from plan"/);
  assert.match(markup, /aria-label="Add [^"]+ to plan"/);
  assert.match(markup, /ScoutAI (Recommended Alternative|Test Opportunity)/);
  assert.match(markup, /ScoutAI recommended alternatives|ScoutAI test opportunities/);
  assert.match(markup, /Fixed budget: \$25,000/);
  assert.match(markup, /Edit allocations/);
  assert.match(markup, /Add &amp; rebalance/);
  assert.match(markup, /\/100/);
  assert.doesNotMatch(markup, /Gap addressed:/);
});

test("legacy conditional candidates render as advisory tests", () => {
  const mediaPlan = buildMediaRecommendationPlan(buildCampaignFacts({
    kpis: ["conversion", "retargeting", "roas"],
    audienceDescriptions: ["High-intent site visitors"],
    workingMediaBudget: 50_000,
    campaignFlightDays: 30,
    geography: "United States",
    dataReadiness: { sitePixel: "unknown", meaningfulSiteTraffic: "unknown" },
    planningSettings: clonePlanningSettings(DEFAULT_PLANNING_SETTINGS),
  }));
  const legacyCandidate = mediaPlan.evaluatedCandidates.find(
    (candidate) => !mediaPlan.channels.some((channel) => channel.channelId === candidate.product.id),
  );
  assert.ok(legacyCandidate);
  Object.assign(legacyCandidate, { status: "CONDITIONAL" });
  const data: ChannelStrategyData = {
    rfpChannels: [],
    scoutAiRecommendedChannels: [],
    executiveInsight: "Legacy plan",
    budgetStrategyMode: "reallocation",
    totalRfpBudget: 50_000,
    analyzedPlanNames: [],
    generatedAt: "2026-08-31T00:00:00.000Z",
    manualIncludedChannelIds: [],
    manualExcludedChannelIds: [],
    mediaPlan,
  };

  const markup = renderToStaticMarkup(<ChannelStrategySection data={data} />);
  assert.doesNotMatch(markup, /CONDITIONAL/);
});
