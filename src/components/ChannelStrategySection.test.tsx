import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildCampaignFacts, buildMediaRecommendationPlan } from "../planning/engine";
import { clonePlanningSettings, DEFAULT_PLANNING_SETTINGS } from "../planning/settings";
import type { ChannelStrategyData } from "../types";
import { ChannelStrategySection, MediaTypeDetails, isCtvOrPerformanceTvChannel } from "./ChannelStrategySection";

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

test("ChannelStrategySection hides Edit allocations, [-] buttons, and candidate groups when readOnly is true", () => {
  const mediaPlan = buildMediaRecommendationPlan(buildCampaignFacts({
    kpis: ["conversion", "retargeting", "roas"],
    audienceDescriptions: ["High-intent site visitors"],
    workingMediaBudget: 50_000,
    campaignFlightDays: 30,
    geography: "United States",
    dataReadiness: { sitePixel: "unknown", meaningfulSiteTraffic: "unknown" },
    planningSettings: clonePlanningSettings(DEFAULT_PLANNING_SETTINGS),
  }));
  const data: ChannelStrategyData = {
    rfpChannels: [],
    scoutAiRecommendedChannels: [],
    executiveInsight: "Test plan",
    budgetStrategyMode: "reallocation",
    totalRfpBudget: 50_000,
    analyzedPlanNames: [],
    generatedAt: "2026-08-31T00:00:00.000Z",
    manualIncludedChannelIds: [],
    manualExcludedChannelIds: [],
    mediaPlan,
  };

  const interactiveMarkup = renderToStaticMarkup(
    <ChannelStrategySection data={data} onSaveAllocations={async () => {}} onManualMediaTypeChange={async () => {}} />
  );
  assert.match(interactiveMarkup, /Edit allocations/);
  assert.match(interactiveMarkup, /Media types not in plan/);
  assert.match(interactiveMarkup, /Remove .* from plan/);

  const readOnlyMarkup = renderToStaticMarkup(
    <ChannelStrategySection data={data} readOnly={true} onSaveAllocations={async () => {}} onManualMediaTypeChange={async () => {}} />
  );
  assert.doesNotMatch(readOnlyMarkup, /Edit allocations/);
  assert.doesNotMatch(readOnlyMarkup, /Media types not in plan/);
  assert.doesNotMatch(readOnlyMarkup, /Remove .* from plan/);
});

test("isCtvOrPerformanceTvChannel correctly identifies CTV and Performance TV", () => {
  assert.equal(isCtvOrPerformanceTvChannel("channel.ctv", "CTV / OTT", "ctv_ott"), true);
  assert.equal(isCtvOrPerformanceTvChannel("channel.performance_tv", "Performance TV", "performance_tv"), true);
  assert.equal(isCtvOrPerformanceTvChannel("ctv", "Connected TV"), true);
  assert.equal(isCtvOrPerformanceTvChannel("channel.search", "Paid Search", "search"), false);
  assert.equal(isCtvOrPerformanceTvChannel("channel.social", "Social Media", "social"), false);
});

test("CTV/OTT and Performance TV publisher details match Recommended CTV Publishers", () => {
  const recommendedPublishers = [
    { publisher: "Hulu", category: "App", why: "Premium streaming" },
    { publisher: "Disney+", category: "App", why: "Family co-viewing" },
    { publisher: "The Roku Channel", category: "OS", why: "Roku OS platform" },
    { publisher: "ESPN", category: "Network", why: "Sports streaming" },
  ];

  const facts = buildCampaignFacts({
    kpis: ["awareness", "conversion"],
    audienceDescriptions: ["TV and digital consumers"],
    workingMediaBudget: 150_000,
    campaignFlightDays: 30,
    geography: "United States",
    planningSettings: clonePlanningSettings(DEFAULT_PLANNING_SETTINGS),
    ctvPublishers: recommendedPublishers,
  });

  const mediaPlan = buildMediaRecommendationPlan(facts);
  const data: ChannelStrategyData = {
    rfpChannels: [],
    scoutAiRecommendedChannels: [],
    executiveInsight: "CTV Test",
    budgetStrategyMode: "reallocation",
    totalRfpBudget: 150_000,
    analyzedPlanNames: [],
    generatedAt: "2026-08-31T00:00:00.000Z",
    manualIncludedChannelIds: [],
    manualExcludedChannelIds: [],
    mediaPlan,
    ctvPublishers: recommendedPublishers,
  };

  const markup = renderToStaticMarkup(
    <ChannelStrategySection
      data={data}
      ctvPublishers={recommendedPublishers}
      initialExpandedChannels={["channel.ctv", "channel.performance_tv"]}
    />
  );

  // Creative enhancements fallback should say "None suggested." and never "No complete workbook enhancement trigger fired."
  assert.doesNotMatch(markup, /No complete workbook enhancement trigger fired\./);
  // Both Hulu and Disney+ should be in the static markup when CTV/Performance TV is expanded
  assert.match(markup, /Hulu/);
  assert.match(markup, /Disney\+/);
  assert.match(markup, /The Roku Channel/);
  assert.match(markup, /ESPN/);
});

test("MediaTypeDetails renders fallback 'Creative enhancements: None suggested.'", () => {
  const markup = renderToStaticMarkup(
    <MediaTypeDetails
      detailsId="test-details"
      gapAddressed="Gap"
      planningRationale="Rationale"
      activationGuidance="Guidance"
      measurementApproach="Approach"
      targetingTactics={[]}
      publishers={[
        { id: "pub-1", displayName: "Hulu", rationale: "Premium ad-supported" },
        { id: "pub-2", displayName: "Disney+", rationale: "Family co-viewing" },
      ]}
      creativeEnhancements={[]}
      inventoryControls={[]}
      measurementCapabilities={[]}
      evidence={[]}
      decisionRule="Rule"
      minimumAllocationPercent={5}
      maximumAllocationPercent={30}
      minimumTotalSpend={5000}
      minimumFlightDays={14}
      typicalCpmLow={12}
      typicalCpmHigh={25}
    />
  );

  assert.match(markup, /Creative enhancements:\s*<\/span><span[^>]*>None suggested\./);
  assert.doesNotMatch(markup, /No complete workbook enhancement trigger fired\./);
  assert.match(markup, /Publishers:\s*<\/span><span[^>]*>.*Hulu.*Disney\+/);
});


