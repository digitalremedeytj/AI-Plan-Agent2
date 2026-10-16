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
  // A real plan's candidates all carry AI reasoning; without it the section hides their scores.
  mediaPlan.evaluatedCandidates = mediaPlan.evaluatedCandidates.map((candidate) => ({ ...candidate, aiAssessed: true }));
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



test("a CTV line with no recommended publishers shows none rather than a canned Hulu/Disney+/Roku/ESPN list", () => {
  const facts = buildCampaignFacts({
    kpis: ["awareness"],
    audienceDescriptions: ["TV and digital consumers"],
    workingMediaBudget: 150_000,
    campaignFlightDays: 30,
    geography: "United States",
    planningSettings: clonePlanningSettings(DEFAULT_PLANNING_SETTINGS),
  });
  const data = {
    rfpChannels: [], scoutAiRecommendedChannels: [], executiveInsight: "", budgetStrategyMode: "reallocation",
    totalRfpBudget: 150_000, analyzedPlanNames: [], generatedAt: "2026-09-22T00:00:00.000Z",
    manualIncludedChannelIds: [], manualExcludedChannelIds: [], mediaPlan: buildMediaRecommendationPlan(facts),
  } as unknown as ChannelStrategyData;

  const markup = renderToStaticMarkup(
    <ChannelStrategySection data={data} initialExpandedChannels={["channel.ctv", "channel.performance_tv"]} />,
  );

  assert.doesNotMatch(markup, /Co-viewing hub matching family oriented household profiles/);
  assert.doesNotMatch(markup, /Recommended CTV publisher \(/);
});

test("a product ScoutAI did not assess shows no score, breakdown or stock rationale", () => {
  const markup = renderToStaticMarkup(
    <MediaTypeDetails
      detailsId="unassessed"
      gapAddressed="Stock gap text"
      planningRationale="Stock rationale"
      activationGuidance="Stock activation"
      measurementApproach="Stock measurement"
      targetingTactics={[]}
      publishers={[]}
      creativeEnhancements={[]}
      inventoryControls={[]}
      measurementCapabilities={[]}
      evidence={[]}
      scoreComponents={{ kpiAndFunnelFit: 60, audienceAndPersonaFit: 60, incrementalGapCoverage: 72, dataReadiness: 78, creativeReadiness: 78, measurementFit: 65 }}
      decisionRule="Stock rule"
      eligibilityFailures={["Product status is beta; only live products can receive allocation."]}
      minimumAllocationPercent={5}
      maximumAllocationPercent={30}
      minimumTotalSpend={5000}
      typicalCpmLow={null}
      typicalCpmHigh={null}
      aiAssessed={false}
    />,
  );

  assert.match(markup, /Not assessed by ScoutAI - not eligible: Product status is beta/);
  assert.doesNotMatch(markup, /Score breakdown|Stock gap text|Stock rationale|Stock activation|Stock measurement|Stock rule/);
});

function rfpStrategy(mode: "reallocation" | "incremental", additional = 0): ChannelStrategyData {
  const mediaPlan = buildMediaRecommendationPlan(buildCampaignFacts({
    kpis: ["awareness", "reach"],
    audienceDescriptions: ["Streaming and out-of-home audiences"],
    workingMediaBudget: mode === "incremental" ? additional : 50_000,
    campaignFlightDays: 30,
    geography: "United States",
    planningMode: mode,
    selectedPlanOptions: [{
      id: "rfp", name: "RFP", selected: true, budget: 50_000, rawChannels: [], lineItemsCount: 2,
      placements: [
        { mediaType: "Video", productType: "OTT", budget: 30_000 },
        { mediaType: "Digital Out of Home", productType: "DOOH", budget: 20_000 },
      ],
    }],
    planningSettings: clonePlanningSettings(DEFAULT_PLANNING_SETTINGS),
  }));
  mediaPlan.evaluatedCandidates = mediaPlan.evaluatedCandidates.map((candidate) => ({ ...candidate, aiAssessed: true }));
  return {
    rfpChannels: [],
    scoutAiRecommendedChannels: [],
    executiveInsight: "Test plan",
    budgetStrategyMode: mode,
    additionalBudget: additional,
    rfpMediaBudget: 50_000,
    totalRfpBudget: mediaPlan.workingMediaBudget,
    analyzedPlanNames: ["RFP"],
    generatedAt: "2026-10-15T00:00:00.000Z",
    mediaPlan,
  };
}

test("an RFP plan shows one Channel Allocation table split into RFP and added media types, without the old RFP tables", () => {
  const markup = renderToStaticMarkup(
    <ChannelStrategySection data={rfpStrategy("reallocation")} onManualMediaTypeChange={async () => undefined} onSaveAllocations={async () => undefined} onChangeBudgetStrategy={async () => undefined} />,
  );
  assert.match(markup, />From your RFP</);
  assert.match(markup, />RFP</);
  assert.match(markup, /RFP: \d of 2 in plan/);
  assert.match(markup, /Audience fit \d+\/100/);
  assert.match(markup, /Goal match \d+\/100/);
  assert.match(markup, /Media consumption evidence: /);
  assert.match(markup, /RFP \$30,000|RFP \$20,000/);
  assert.match(markup, /Budget approach/);
  assert.match(markup, /Optimize RFP budget/);
  assert.doesNotMatch(markup, /Baseline RFP Channels/);
  assert.doesNotMatch(markup, /ScoutAI Recommended Additional Channels/);
});

test("add on top of RFP lists RFP media types at their RFP dollars with no remove control", () => {
  const markup = renderToStaticMarkup(
    <ChannelStrategySection data={rfpStrategy("incremental", 25_000)} onManualMediaTypeChange={async () => undefined} onSaveAllocations={async () => undefined} />,
  );
  assert.match(markup, /Kept at RFP budget/);
  assert.match(markup, /\$75,000/);
  assert.match(markup, /Additional budget: \$25,000/);
  assert.doesNotMatch(markup, /aria-label="Remove CTV[^"]*from plan"/);
  assert.match(markup, /Added to your plan/);
});

test("the share link shows what the plan leaves out, with why, but no planner controls", () => {
  const markup = renderToStaticMarkup(<ChannelStrategySection data={rfpStrategy("reallocation")} readOnly />);
  assert.match(markup, /ScoutAI recommendations not in this plan/);
  assert.match(markup, /Recommended additions/);
  assert.match(markup, /Why add it: /);
  assert.doesNotMatch(markup, /Media types not in plan/);
  assert.doesNotMatch(markup, /Budget approach<\/h3>/);
  assert.doesNotMatch(markup, /Add &amp; rebalance/);
  const hidden = renderToStaticMarkup(
    <ChannelStrategySection data={rfpStrategy("reallocation")} readOnly internalOnly={{ channelAllocationColumn: true, channelDollarsColumn: false, channelScoreColumn: true, channelConfidenceBadge: false, channelStatusTag: false, channelRecommendationsNotInPlan: false, channelEvidence: false, channelFitScores: false }} />,
  );
  assert.doesNotMatch(hidden, /ScoutAI recommendations not in this plan/);
  assert.doesNotMatch(hidden, /Media consumption evidence: /);
  assert.doesNotMatch(hidden, /Audience fit/);
});
