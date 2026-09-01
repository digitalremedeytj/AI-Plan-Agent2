import assert from "node:assert/strict";
import test from "node:test";
import { buildCampaignFacts, buildMediaRecommendationPlan } from "./engine";
import { validatePlanningKnowledgeBase } from "./knowledge/normalizeWorkbook";
import { validateProductRegistry } from "./knowledge/registry";
import { clonePlanningSettings, DEFAULT_PLANNING_SETTINGS } from "./settings";

const settings = () => clonePlanningSettings(DEFAULT_PLANNING_SETTINGS);

test("registry and normalized workbook collections validate at startup", () => {
  assert.deepEqual(validateProductRegistry(), []);
  assert.deepEqual(validatePlanningKnowledgeBase(), []);
});

test("every evaluated candidate carries a previewable planning stack", () => {
  const facts = buildCampaignFacts({
    kpis: ["awareness", "reach"],
    audienceDescriptions: ["Streaming video viewers and broad digital audiences"],
    workingMediaBudget: 50_000,
    campaignFlightDays: 30,
    geography: "United States",
    planningSettings: settings(),
  });
  const plan = buildMediaRecommendationPlan(facts);
  assert.ok(plan.evaluatedCandidates.length > 0);
  plan.evaluatedCandidates.forEach((candidate) => {
    assert.ok(Array.isArray(candidate.targetingTactics));
    assert.ok(Array.isArray(candidate.publishers));
    assert.ok(Array.isArray(candidate.creativeEnhancements));
    assert.ok(Array.isArray(candidate.inventoryControls));
    assert.ok(Array.isArray(candidate.measurementCapabilities));
  });
  plan.channels.forEach((channel) => {
    const candidate = plan.evaluatedCandidates.find((item) => item.product.id === channel.channelId);
    assert.ok(candidate);
    assert.deepEqual(channel.targetingTactics, candidate.targetingTactics);
    assert.deepEqual(channel.publishers, candidate.publishers);
    assert.deepEqual(channel.creativeEnhancements, candidate.creativeEnhancements);
    assert.deepEqual(channel.inventoryControls, candidate.inventoryControls);
    assert.deepEqual(channel.measurementCapabilities, candidate.measurementCapabilities);
  });
});

test("30-day normalized budget controls the channel cap while actual dollars are allocated", () => {
  const facts = buildCampaignFacts({
    advertiserName: "Example",
    kpis: ["awareness", "reach"],
    campaignFocus: "full-funnel awareness",
    audienceDescriptions: ["Streaming video viewers who research online"],
    workingMediaBudget: 120_000,
    campaignFlightDays: 180,
    geography: "United States",
    planningSettings: settings(),
  });
  const plan = buildMediaRecommendationPlan(facts);
  assert.equal(plan.normalized30DayBudget, 20_000);
  assert.equal(plan.maxMediaTypes, 4);
  assert.ok(plan.selectedMediaTypeCount <= 4);
  assert.equal(plan.channels.reduce((sum, channel) => sum + channel.allocationPercent, 0), 100);
  assert.equal(plan.channels.reduce((sum, channel) => sum + channel.allocationDollars, 0), 120_000);
  plan.channels.forEach((channel) => {
    assert.equal(Number.isInteger(channel.allocationPercent), true);
    assert.ok(channel.allocationDollars >= channel.minimumTotalSpend);
    assert.ok(channel.allocationPercent >= channel.minimumAllocationPercent);
    assert.ok(channel.allocationPercent <= channel.maximumAllocationPercent);
  });
});

test("minimum effective spend can reduce selection below the configured cap", () => {
  const facts = buildCampaignFacts({
    kpis: ["awareness", "reach"],
    audienceDescriptions: ["Video and streaming audience"],
    workingMediaBudget: 5_000,
    campaignFlightDays: 30,
    geography: "United States",
    planningSettings: settings(),
  });
  const plan = buildMediaRecommendationPlan(facts);
  assert.equal(plan.maxMediaTypes, 3);
  assert.equal(plan.selectedMediaTypeCount, 1);
  assert.equal(plan.channels[0].allocationPercent, 100);
  assert.equal(plan.channels[0].allocationDollars, 5_000);
});

test("unknown duration is explicit and future/non-executable products never allocate", () => {
  const facts = buildCampaignFacts({
    kpis: ["engagement", "consideration"],
    audienceDescriptions: ["Editorial research audience"],
    workingMediaBudget: 25_000,
    campaignFlightDays: null,
    geography: "United States",
    planningSettings: settings(),
  });
  const plan = buildMediaRecommendationPlan(facts);
  assert.ok(plan.assumptions.some((item) => item.includes("treated as a 30-day budget")));
  assert.ok(!plan.channels.some((channel) => channel.channelId === "channel.native_article" || channel.channelId === "channel.email"));
  const rejected = plan.evaluatedCandidates.filter((candidate) => ["channel.native_article", "channel.email"].includes(candidate.product.id));
  assert.ok(rejected.every((candidate) => candidate.status === "DO_NOT_ADD"));
});

test("data prerequisites are advisory and do not block an eligible media type", () => {
  const facts = buildCampaignFacts({
    kpis: ["conversion", "retargeting", "roas"],
    audienceDescriptions: ["High-intent site visitors"],
    workingMediaBudget: 50_000,
    campaignFlightDays: 30,
    geography: "United States",
    requiredChannelIds: ["channel.display_retargeting"],
    dataReadiness: { sitePixel: "unknown", meaningfulSiteTraffic: "unknown" },
    planningSettings: settings(),
  });
  const plan = buildMediaRecommendationPlan(facts);
  const retargeting = plan.evaluatedCandidates.find((candidate) => candidate.product.id === "channel.display_retargeting");
  assert.equal(retargeting?.status, "TEST");
  assert.ok(retargeting?.prerequisites.some((prerequisite) => prerequisite.includes("sitePixel")));
  assert.ok(plan.channels.some((channel) => channel.channelId === "channel.display_retargeting"));
  assert.ok(!plan.evaluatedCandidates.some((candidate) => String(candidate.status) === "CONDITIONAL"));
});

test("family overlap prevents multiple social variants from counting as diversification", () => {
  const facts = buildCampaignFacts({
    kpis: ["awareness", "video reach", "engagement"],
    audienceDescriptions: ["Social, YouTube, video, visual audience"],
    workingMediaBudget: 250_000,
    campaignFlightDays: 30,
    geography: "United States",
    creativeReadiness: { socialAssets: true, onlineVideoAssets: true },
    planningSettings: settings(),
  });
  const plan = buildMediaRecommendationPlan(facts);
  const families = plan.channels.map((channel) => channel.familyId);
  assert.equal(new Set(families).size, families.length);
});

test("planning mode changes the funding source and audit assumption", () => {
  const base = {
    kpis: ["awareness"],
    audienceDescriptions: ["Broad reach audience"],
    workingMediaBudget: 25_000,
    campaignFlightDays: 30,
    geography: "United States",
    planningSettings: settings(),
  };
  const greenfield = buildMediaRecommendationPlan(buildCampaignFacts({ ...base, planningMode: "greenfield" }));
  const incremental = buildMediaRecommendationPlan(buildCampaignFacts({ ...base, planningMode: "incremental" }));
  assert.equal(greenfield.channels[0].fundingSource, "Greenfield working media budget");
  assert.equal(incremental.channels[0].fundingSource, "Incremental working media budget");
  assert.ok(incremental.assumptions.some((item) => item.includes("Existing plan allocations are fixed")));
});

test("incremental mode keeps baseline channels fixed while reallocation can fund them", () => {
  const selectedPlanOptions = [{
    id: "baseline",
    name: "Baseline",
    selected: true,
    budget: 50_000,
    rawChannels: ["CTV / OTT"],
    lineItemsCount: 1,
    placements: [{ mediaType: "CTV / OTT", budget: 50_000 }],
  }];
  const base = {
    kpis: ["awareness", "reach"],
    audienceDescriptions: ["Streaming television audience"],
    workingMediaBudget: 50_000,
    campaignFlightDays: 30,
    geography: "United States",
    selectedPlanOptions,
    planningSettings: settings(),
  };
  const reallocation = buildMediaRecommendationPlan(buildCampaignFacts({ ...base, planningMode: "reallocation" }));
  const incremental = buildMediaRecommendationPlan(buildCampaignFacts({ ...base, planningMode: "incremental" }));
  assert.ok(reallocation.channels.some((channel) => channel.channelId === "channel.ctv"));
  assert.ok(!incremental.channels.some((channel) => channel.channelId === "channel.ctv"));
});

test("non-media line items are tracked separately and never receive channel allocation", () => {
  const facts = buildCampaignFacts({
    kpis: ["awareness"],
    workingMediaBudget: 25_000,
    campaignFlightDays: 30,
    geography: "United States",
    selectedPlanOptions: [{
      id: "with-fee",
      name: "With fee",
      selected: true,
      budget: 26_000,
      rawChannels: ["Display", "Ad Serving"],
      lineItemsCount: 2,
      placements: [
        { mediaType: "Display", budget: 25_000 },
        { mediaType: "Ad Serving", placementName: "Ad Serving Fee", budget: 1_000 },
      ],
    }],
    planningSettings: settings(),
  });
  const plan = buildMediaRecommendationPlan(facts);
  assert.equal(plan.nonMediaCosts.length, 1);
  assert.equal(plan.nonMediaCosts[0].amount, 1_000);
  assert.ok(!plan.channels.some((channel) => channel.canonicalId === "ad_serving" || channel.canonicalId === "advanced_measurement"));
});

test("selected channels receive workbook-backed plan-stack attachments", () => {
  const facts = buildCampaignFacts({
    kpis: ["awareness", "reach", "brand lift"],
    audienceDescriptions: ["Streaming television viewers"],
    workingMediaBudget: 50_000,
    campaignFlightDays: 30,
    geography: "United States",
    planningSettings: settings(),
  });
  const plan = buildMediaRecommendationPlan(facts);
  const ctv = plan.channels.find((channel) => channel.channelId === "channel.ctv");
  assert.ok(ctv);
  assert.ok(ctv.publishers.length > 0);
  assert.ok(ctv.inventoryControls.length > 0);
  assert.ok(ctv.measurementCapabilities.length > 0);
});

test("editable product economics and availability drive deterministic eligibility and output", () => {
  const planningSettings = settings();
  const display = planningSettings.products.find((product) => product.productId === "channel.display");
  assert.ok(display);
  display.minimumNormalized30DaySpend = 60_000;
  display.typicalCpmLow = 7;
  display.typicalCpmHigh = 11;
  const facts = buildCampaignFacts({
    kpis: ["awareness", "reach"],
    audienceDescriptions: ["Broad digital audience"],
    workingMediaBudget: 50_000,
    campaignFlightDays: 30,
    geography: "US",
    planningSettings,
  });
  const plan = buildMediaRecommendationPlan(facts);
  const evaluatedDisplay = plan.evaluatedCandidates.find((candidate) => candidate.product.id === "channel.display");
  assert.equal(evaluatedDisplay?.status, "DO_NOT_ADD");
  assert.ok(evaluatedDisplay?.eligibilityFailures.some((failure) => failure.includes("monthly minimum")));
  assert.equal(evaluatedDisplay?.product.typicalCpmLow, 7);
  assert.equal(evaluatedDisplay?.product.typicalCpmHigh, 11);
});

test("editable publisher tiers and enhancement specifications drive plan-stack attachment", () => {
  const planningSettings = settings();
  planningSettings.publishers.forEach((publisher) => {
    if (publisher.attachesTo.some((channel) => channel.toLowerCase().includes("ctv"))) publisher.tier = publisher.displayName === "BET" ? 1 : 4;
  });
  planningSettings.enhancements.forEach((enhancement) => { enhancement.recommendationEligible = false; });
  const ctvDco = planningSettings.enhancements.find((enhancement) => enhancement.displayName === "CTV DCO");
  assert.ok(ctvDco);
  ctvDco.recommendationEligible = true;
  ctvDco.trigger = "awareness reach";
  ctvDco.formatType = "CTV dynamic creative";
  ctvDco.specificationNotes = "Confirm VAST, duration, tracking, and vendor QA.";
  const plan = buildMediaRecommendationPlan(buildCampaignFacts({
    kpis: ["awareness", "reach"],
    audienceDescriptions: ["Streaming television viewers"],
    workingMediaBudget: 50_000,
    campaignFlightDays: 30,
    geography: "United States",
    planningSettings,
  }));
  const ctv = plan.channels.find((channel) => channel.channelId === "channel.ctv");
  assert.ok(ctv);
  assert.equal(ctv.publishers[0]?.displayName, "BET");
  assert.equal(ctv.creativeEnhancements[0]?.displayName, "CTV DCO");
  assert.ok(ctv.creativeEnhancements[0]?.rationale.includes("CTV dynamic creative"));
  assert.equal(ctv.creativeEnhancements[0]?.limitation, "Confirm VAST, duration, tracking, and vendor QA.");
});

test("manual additions expand beyond the automatic media-type cap", () => {
  const planningSettings = settings();
  const audio = planningSettings.products.find((product) => product.productId === "channel.audio");
  assert.ok(audio);
  audio.minimumTotalSpend = 1_000;
  audio.minimumNormalized30DaySpend = 1_000;
  audio.minimumFlightDays = 1;
  audio.minimumAllocationPercent = 10;
  audio.maximumAllocationPercent = 40;
  const plan = buildMediaRecommendationPlan(buildCampaignFacts({
    kpis: ["awareness", "reach", "frequency"],
    audienceDescriptions: ["Audio streaming and broad digital audience"],
    workingMediaBudget: 4_999,
    campaignFlightDays: 30,
    geography: "United States",
    creativeReadiness: { audioAssets: true, displayAssets: true },
    requiredChannelIds: ["channel.audio"],
    planningSettings,
  }));
  assert.equal(plan.maxMediaTypes, 1);
  assert.equal(plan.selectedMediaTypeCount, 2);
  assert.ok(plan.channels.some((channel) => channel.channelId === "channel.audio"));
  assert.ok(plan.allocationAudit.some((entry) => entry.detail.includes("automatic 1-type cap was expanded to 2")));
});

test("manual removals remain excluded during portfolio recalculation", () => {
  const plan = buildMediaRecommendationPlan(buildCampaignFacts({
    kpis: ["awareness", "reach"],
    audienceDescriptions: ["Broad digital audience"],
    workingMediaBudget: 25_000,
    campaignFlightDays: 30,
    geography: "United States",
    excludedChannelIds: ["channel.display"],
    planningSettings: settings(),
  }));
  assert.ok(!plan.channels.some((channel) => channel.channelId === "channel.display"));
  const display = plan.evaluatedCandidates.find((candidate) => candidate.product.id === "channel.display");
  assert.ok(display?.eligibilityFailures.some((failure) => failure.includes("explicitly excluded")));
});
