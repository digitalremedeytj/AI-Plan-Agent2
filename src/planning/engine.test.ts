import assert from "node:assert/strict";
import test from "node:test";
import { buildCampaignFacts, buildMediaRecommendationPlan, channelRecordOptions, CTV_PRODUCT_ID, ctvRuledOutByBrief, inferAudienceType, measurementFitsCampaign, profileSignals, tacticFitsCampaign } from "./engine";
import { ctvMissingAlerts } from "./briefMediaTypes";
import { planningKnowledgeBase, resolveCompatibilityTacticIds } from "./knowledge/normalizeWorkbook";
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

test("media types in the same family can be selected together", () => {
  const facts = buildCampaignFacts({
    kpis: ["awareness", "video reach", "engagement"],
    audienceDescriptions: ["Social, YouTube, video, visual audience"],
    workingMediaBudget: 250_000,
    campaignFlightDays: 30,
    geography: "United States",
    creativeReadiness: { socialAssets: true, onlineVideoAssets: true },
    requiredChannelIds: ["channel.social_meta", "channel.youtube"],
    planningSettings: settings(),
  });
  const plan = buildMediaRecommendationPlan(facts);
  const selected = plan.channels.map((channel) => channel.channelId);
  assert.ok(selected.includes("channel.social_meta"));
  assert.ok(selected.includes("channel.youtube"));
  const families = plan.channels.map((channel) => channel.familyId);
  assert.ok(new Set(families).size < families.length, "same-family selection is no longer blocked");
  assert.ok(!plan.allocationAudit.some((entry) => /overlap/i.test(entry.detail)));
});

test("a planner override funds a media type the budget could never afford on its own", () => {
  const facts = buildCampaignFacts({
    kpis: ["awareness"],
    audienceDescriptions: ["Streaming television audience"],
    workingMediaBudget: 3_000,
    campaignFlightDays: 30,
    geography: "United States",
    requiredChannelIds: ["channel.ctv"],
    planningSettings: settings(),
  });
  const plan = buildMediaRecommendationPlan(facts);
  const ctv = plan.channels.find((channel) => channel.channelId === "channel.ctv");
  assert.ok(ctv, "a required media type is funded even below its product minimums");
  assert.equal(ctv?.manuallyForced, true);
  // The product minimums are still reported so the planner sees what the override waived.
  const candidate = plan.evaluatedCandidates.find((item) => item.product.id === "channel.ctv");
  assert.ok(candidate!.eligibilityFailures.length > 0);
  assert.equal(plan.channels.reduce((sum, channel) => sum + channel.allocationPercent, 0), 100);
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
  assert.equal(greenfield.channels[0].fundingSource, "New plan working media budget");
  const grow = buildMediaRecommendationPlan(buildCampaignFacts({ ...base, planningMode: "grow" }));
  assert.equal(incremental.channels[0].fundingSource, "Additional working media budget");
  assert.ok(incremental.assumptions.some((item) => item.includes("RFP media types keep their RFP budgets")));
  assert.equal(grow.channels[0].fundingSource, "Uploaded-plan plus additional working media");
  assert.ok(grow.assumptions.some((item) => item.includes("allocated as one total")));
});

test("an RFP line is placed by its most specific field, and an unrecognised line is not counted as display", () => {
  const facts = buildCampaignFacts({
    kpis: ["awareness"],
    workingMediaBudget: 38_500,
    campaignFlightDays: 30,
    geography: "United States",
    planningSettings: settings(),
    selectedPlanOptions: [{
      id: "rfp", name: "RFP", selected: true, budget: 38_500, rawChannels: [], lineItemsCount: 5,
      placements: [
        { mediaType: "Video", productType: "OTT", budget: 7_500 },
        { mediaType: "Video", productType: "OTT", budget: 7_500 },
        { mediaType: "Display", productType: "DSP", budget: 2_500 },
        { mediaType: "Advanced Measurement", productType: "Halo Effect Study", budget: 0 },
        { mediaType: "Telepathy", productType: "Mind Ads", budget: 21_000 },
      ],
    }],
  });
  const baseline = buildMediaRecommendationPlan(facts).rfpBaseline!;
  assert.deepEqual(facts.existingChannelIds.sort(), ["channel.ctv", "channel.display"]);
  assert.deepEqual(baseline.channels.map((channel) => [channel.channelId, channel.dollars, channel.lines.length]).sort(), [["channel.ctv", 15_000, 2], ["channel.display", 2_500, 1]]);
  assert.equal(baseline.unmatchedLines.length, 1);
  assert.equal(baseline.unmatchedLines[0].budget, 21_000);
  // The measurement study is non-media: it is neither a channel nor an unmatched media line.
  assert.equal(baseline.mediaTotal, 38_500);
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

test("manual additions expand beyond the automatic media-type cap, and a strong fit can take the extra room", () => {
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
  }), [
    // The expanded cap is room, not a target: the second slot is filled only by a media type
    // worth its minimum, so this one is scored as a clear fit.
    { channelId: "channel.display", components: { kpiAndFunnelFit: 95, audienceAndPersonaFit: 95, incrementalGapCoverage: 95, dataReadiness: 95, creativeReadiness: 95, measurementFit: 95 } },
  ]);
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

test("a hidden product is absent from planning entirely, not merely rejected", () => {
  const base = settings();
  const target = base.products.find((product) => product.productId === "channel.ctv");
  assert.ok(target, "channel.ctv is in the default catalog");

  const withCtv = buildMediaRecommendationPlan(buildCampaignFacts({
    kpis: ["awareness", "reach"],
    audienceDescriptions: ["Streaming video viewers"],
    workingMediaBudget: 250_000,
    campaignFlightDays: 30,
    planningSettings: base,
  }));
  assert.ok(
    withCtv.evaluatedCandidates.some((candidate) => candidate.product.id === "channel.ctv"),
    "baseline evaluates the product",
  );

  const hidden = settings();
  hidden.products.find((product) => product.productId === "channel.ctv")!.enabled = false;
  const plan = buildMediaRecommendationPlan(buildCampaignFacts({
    kpis: ["awareness", "reach"],
    audienceDescriptions: ["Streaming video viewers"],
    workingMediaBudget: 250_000,
    campaignFlightDays: 30,
    planningSettings: hidden,
  }));

  // Distinct from recommendationEligible, which leaves a DO_NOT_ADD candidate behind
  // that the planner can still add by hand.
  assert.ok(!plan.evaluatedCandidates.some((candidate) => candidate.product.id === "channel.ctv"));
  assert.ok(!plan.channels.some((channel) => channel.channelId === "channel.ctv"));
});

test("a custom media type is scored and can win budget alongside registry products", () => {
  const withCustom = settings();
  withCustom.customProducts.push({
    productId: "custom.retail_media_network",
    displayName: "Retail Media Network",
    enabled: true,
    digitalRemedyExecutable: true,
    status: "live",
    recommendationEligible: true,
    supportedGeographies: ["United States"],
    typicalCpmLow: 8,
    typicalCpmHigh: 22,
    minimumTotalSpend: 5_000,
    minimumNormalized30DaySpend: 5_000,
    minimumFlightDays: 14,
    minimumAllocationPercent: 10,
    maximumAllocationPercent: 60,
    canonicalId: "programmatic_display",
    aliases: ["rmn", "retail media"],
    funnelRoles: ["consideration", "conversion"],
    supportedKpis: ["conversion", "roas", "sales lift"],
    audienceSignals: ["shopping", "purchase intent"],
    planningNotes: "Use when the advertiser sells through retail partners.",
  });

  const plan = buildMediaRecommendationPlan(buildCampaignFacts({
    kpis: ["conversion", "roas"],
    campaignFocus: "drive retail sales and conversion",
    audienceDescriptions: ["Shoppers with purchase intent"],
    workingMediaBudget: 250_000,
    campaignFlightDays: 30,
    planningSettings: withCustom,
  }));

  const evaluated = plan.evaluatedCandidates.find((candidate) => candidate.product.id === "custom.retail_media_network");
  assert.ok(evaluated, "the custom media type is evaluated like any other candidate");
  assert.equal(evaluated.eligibilityFailures.length, 0, evaluated.eligibilityFailures.join("; "));
  assert.ok(evaluated.recommendationScore > 0);
});

test("a hidden custom media type never reaches the planner", () => {
  const hidden = settings();
  hidden.customProducts.push({
    productId: "custom.hidden_type",
    displayName: "Hidden Type",
    enabled: false,
    digitalRemedyExecutable: true,
    status: "live",
    recommendationEligible: true,
    supportedGeographies: ["United States"],
    typicalCpmLow: null,
    typicalCpmHigh: null,
    minimumTotalSpend: 1_000,
    minimumNormalized30DaySpend: 1_000,
    minimumFlightDays: 7,
    minimumAllocationPercent: 10,
    maximumAllocationPercent: 100,
    canonicalId: "ctv",
    aliases: [],
    funnelRoles: ["awareness"],
    supportedKpis: ["reach"],
    audienceSignals: [],
    planningNotes: "",
  });

  const plan = buildMediaRecommendationPlan(buildCampaignFacts({
    kpis: ["awareness"],
    audienceDescriptions: ["Broad reach"],
    workingMediaBudget: 250_000,
    campaignFlightDays: 30,
    planningSettings: hidden,
  }));

  assert.ok(!plan.evaluatedCandidates.some((candidate) => candidate.product.id === "custom.hidden_type"));
});

test("facts.ctvPublishers are attached to both CTV/OTT and Performance TV candidates", () => {
  const customPublishers = [
    { publisher: "Hulu", category: "App", why: "Top premium streaming" },
    { publisher: "Disney+", category: "App", why: "Family co-viewing" },
    { publisher: "ESPN", category: "Network", why: "Live sports" },
  ];

  const customSettings = settings();
  customSettings.customProducts.push({
    productId: "custom.performance_tv",
    displayName: "Performance TV",
    enabled: true,
    digitalRemedyExecutable: true,
    status: "live",
    recommendationEligible: true,
    supportedGeographies: ["United States"],
    typicalCpmLow: null,
    typicalCpmHigh: null,
    minimumTotalSpend: 1_000,
    minimumNormalized30DaySpend: 1_000,
    minimumFlightDays: 7,
    minimumAllocationPercent: 10,
    maximumAllocationPercent: 100,
    canonicalId: "ctv",
    aliases: [],
    funnelRoles: ["awareness", "conversion"],
    supportedKpis: ["reach", "conversion"],
    audienceSignals: [],
    planningNotes: "",
  });

  const facts = buildCampaignFacts({
    kpis: ["awareness", "conversion"],
    audienceDescriptions: ["Connected TV streaming audience"],
    workingMediaBudget: 100_000,
    campaignFlightDays: 30,
    planningSettings: customSettings,
    ctvPublishers: customPublishers,
  });

  const plan = buildMediaRecommendationPlan(facts);
  const ctvCandidate = plan.evaluatedCandidates.find((c) => c.product.id === "channel.ctv");
  const perfTvCandidate = plan.evaluatedCandidates.find((c) => c.product.id === "custom.performance_tv");

  assert.ok(ctvCandidate);
  assert.ok(perfTvCandidate);

  const ctvPubNames = ctvCandidate.publishers.map((p) => p.displayName);
  const perfTvPubNames = perfTvCandidate.publishers.map((p) => p.displayName);

  assert.deepEqual(ctvPubNames, ["Hulu", "Disney+", "ESPN"]);
  assert.deepEqual(perfTvPubNames, ["Hulu", "Disney+", "ESPN"]);
});


test("only candidates scored by the AI layer are marked as assessed", () => {
  const facts = buildCampaignFacts({
    kpis: ["awareness"],
    audienceDescriptions: ["Streaming video viewers"],
    workingMediaBudget: 50_000,
    campaignFlightDays: 30,
    geography: "United States",
    planningSettings: settings(),
  });
  const first = buildMediaRecommendationPlan(facts).evaluatedCandidates[0];
  const signal = {
    channelId: first.product.id,
    components: { kpiAndFunnelFit: 80, audienceAndPersonaFit: 80, incrementalGapCoverage: 80, dataReadiness: 80, creativeReadiness: 80, measurementFit: 80 },
    gapAddressed: "g", evidence: [], activationGuidance: "a", measurementApproach: "m", tradeoffs: [], allocationRationale: "r", decisionRule: "d",
  };

  const plan = buildMediaRecommendationPlan(facts, [signal as any]);

  const assessed = plan.evaluatedCandidates.filter((candidate) => candidate.aiAssessed).map((candidate) => candidate.product.id);
  assert.deepEqual(assessed, [first.product.id]);
});

const B2B_TACTIC = /B2B Job Title/;
const tacticNames = (facts: ReturnType<typeof buildCampaignFacts>) =>
  buildMediaRecommendationPlan(facts).evaluatedCandidates.flatMap((candidate) => candidate.targetingTactics.map((tactic) => tactic.displayName));

test("a consumer campaign never carries B2B job-title or company-IP targeting", () => {
  const facts = buildCampaignFacts({
    advertiserName: "PetSmart",
    kpis: ["Site visits"],
    campaignFocus: "Full-Funnel",
    audienceDescriptions: ["U.S. dog and cat owners shopping for pet food, grooming and supplies; high-value conversion"],
    audienceType: "B2C",
    workingMediaBudget: 100_000,
    campaignFlightDays: 30,
    planningSettings: settings(),
  });
  const names = tacticNames(facts);
  assert.ok(names.length > 0);
  assert.ok(!names.some((name) => B2B_TACTIC.test(name)), names.join(", "));
});

test("a B2B campaign can still carry B2B targeting", () => {
  const facts = buildCampaignFacts({
    kpis: ["Lead gen"],
    audienceDescriptions: ["B2B IT decision-makers at firms with 100+ employees"],
    workingMediaBudget: 100_000,
    campaignFlightDays: 30,
    planningSettings: settings(),
  });
  assert.equal(facts.audienceType, "B2B");
  assert.ok(tacticNames(facts).some((name) => B2B_TACTIC.test(name)));
});

test("without a brief of record the audience type is inferred from the brief text", () => {
  assert.equal(inferAudienceType("Luxury travelers looking for boutique hotels"), "B2C");
  assert.equal(inferAudienceType("B2B IT decision-makers"), "B2B");
});

test("retail-media data is only attached when the brief names that retailer", () => {
  const base = buildCampaignFacts({
    advertiserName: "Jinx",
    audienceDescriptions: ["Dog and cat owners; this is our target audience"],
    workingMediaBudget: 50_000,
    campaignFlightDays: 30,
    planningSettings: settings(),
  });
  const walmart = { id: "tactic.walmart_connect_retail_data_off_site_activation", displayName: "Walmart Connect (retail data, off-site activation)", trigger: "" };
  const target = { id: "tactic.roundel_target_retail_data_off_site_activation", displayName: "Roundel / Target (retail data, off-site activation)", trigger: "" };
  assert.equal(tacticFitsCampaign(walmart, base), false);
  assert.equal(tacticFitsCampaign(target, base), false, "the word 'target' in a brief is not the retailer");
  assert.equal(tacticFitsCampaign(walmart, { ...base, audienceSignals: ["Buys pet food at Walmart"] }), true);
});

test("a tactic whose data prerequisite the brief rules out is not attached", () => {
  const facts = buildCampaignFacts({
    audienceDescriptions: ["New customers; no customer list is available"],
    workingMediaBudget: 50_000,
    campaignFlightDays: 30,
    planningSettings: settings(),
  });
  assert.equal(facts.dataReadiness.crmSeedList, false);
  assert.equal(tacticFitsCampaign({ id: "tactic.crm_targeting", displayName: "CRM Targeting", trigger: "" }, facts), false);
  assert.equal(tacticFitsCampaign({ id: "tactic.contextual_targeting", displayName: "Contextual Targeting", trigger: "" }, facts), true);
});

test("a retail partner named in the brief of record's business model unlocks that retailer's data", () => {
  const signals = profileSignals({
    intro: "Premium dog and cat food.",
    executiveSummary: "",
    personas: [],
    briefOfRecord: { businessModel: "DTC e-commerce plus national retail partners including Walmart, Chewy and Amazon" },
  } as any);
  const facts = buildCampaignFacts({ ...signals, workingMediaBudget: 50_000, campaignFlightDays: 30, planningSettings: settings() });
  const walmart = { id: "tactic.walmart_connect_retail_data_off_site_activation", displayName: "Walmart Connect (retail data, off-site activation)", trigger: "" };
  assert.equal(tacticFitsCampaign(walmart, facts), true);
});

const siteVisitsPlan = () => buildMediaRecommendationPlan(buildCampaignFacts({
  advertiserName: "PetSmart",
  kpis: ["Site visits"],
  campaignFocus: "Full-funnel digital media plan",
  audienceDescriptions: ["Dog and cat owners"],
  audienceType: "B2C",
  workingMediaBudget: 100_000,
  campaignFlightDays: 30,
  planningSettings: settings(),
}));

test("a site-visits plan measures online conversions, not leads, CRM matchback or linear TV", () => {
  const plan = siteVisitsPlan();
  const measurement = plan.evaluatedCandidates.flatMap((c) => c.measurementCapabilities.map((m) => m.id));
  for (const id of ["measurement.leadmatch", "measurement.matchback", "measurement.crossview_linear_plus_ctv"]) {
    assert.ok(!measurement.includes(id), `${id} should not attach`);
  }
  const ctv = plan.evaluatedCandidates.find((c) => c.product.id === "channel.ctv")!;
  assert.ok(ctv.measurementCapabilities.some((m) => m.id === "measurement.online_booking_order_attribution"));
});

test("lead-gen measurement attaches when the brief is about leads", () => {
  const facts = buildCampaignFacts({ kpis: ["Lead gen", "Qualified leads"], workingMediaBudget: 50_000, campaignFlightDays: 30, planningSettings: settings() });
  assert.equal(measurementFitsCampaign({ id: "measurement.leadmatch" }, facts), true);
  assert.equal(measurementFitsCampaign({ id: "measurement.crossview_linear_plus_ctv" }, facts), false);
});

test("display retargeting leads with site retargeting, and prospecting channels do not lead with retargeting", () => {
  const plan = siteVisitsPlan();
  const retargeting = plan.evaluatedCandidates.find((c) => c.product.id === "channel.display_retargeting")!;
  assert.equal(retargeting.targetingTactics[0].id, "tactic.site_retargeting");
  const ctv = plan.evaluatedCandidates.find((c) => c.product.id === "channel.ctv")!;
  assert.ok(!ctv.targetingTactics.some((t) => t.id.includes("retargeting")), ctv.targetingTactics.map((t) => t.id).join(", "));
});

test("compatibility rows resolve to the tactic records they name, so those tactics can attach", () => {
  const ids = planningKnowledgeBase.targetingTactics.map((t) => t.id);
  assert.deepEqual(resolveCompatibilityTacticIds("contextual", ids), ["tactic.contextual_targeting"]);
  assert.deepEqual(resolveCompatibilityTacticIds("retargeting_off_ctv_ott", ids), ["tactic.sequential_retargeting_off_ctv_ott"]);
  assert.ok(resolveCompatibilityTacticIds("retail_data_on_site_data_off_site_activation_all_partners", ids).length >= 6);
  const edgeIds = new Set(planningKnowledgeBase.compatibilityEdges.map((e) => e.fromId).filter((id) => id.startsWith("tactic.")));
  const unmatched = [...edgeIds].filter((id) => !ids.includes(id));
  // The workbook has a compatibility row for this, but no targeting record to attach.
  assert.deepEqual(unmatched, ["tactic.cross_channel_sequential_messaging"]);
});

test("a brief that rules out pixels gets no pixel-dependent measurement", () => {
  const facts = buildCampaignFacts({
    kpis: ["awareness", "site visits", "conversion"],
    campaignFocus: "full-funnel",
    additionalContext: "Looking to promote YNHH as the go-to hospital. Cannot place pixels so can't track lower funnel activity",
    workingMediaBudget: 50_000,
    campaignFlightDays: 30,
    geography: "Connecticut",
    requiredChannelIds: ["channel.ctv"],
    planningSettings: settings(),
  });
  assert.equal(facts.dataReadiness.sitePixel, false);
  assert.equal(facts.dataReadiness.conversionEvents, false);
  const measurement = buildMediaRecommendationPlan(facts).channels.flatMap((channel) => channel.measurementCapabilities.map((record) => record.id));
  for (const id of ["measurement.consumer_journey_analytics_opa", "measurement.online_booking_order_attribution", "measurement.halo_effect", "measurement.leadmatch"]) {
    assert.ok(!measurement.includes(id), `${id} needs a pixel`);
  }
});

test("pixel negations are read from the planner's own phrasing", () => {
  const pixelFor = (additionalContext: string) => buildCampaignFacts({ additionalContext, workingMediaBudget: 50_000, planningSettings: settings() }).dataReadiness.sitePixel;
  for (const phrase of ["Cannot place pixels", "client can't place a pixel on the site", "We are unable to add tracking pixels", "Pixels are not allowed on the hospital site", "no pixels"]) {
    assert.equal(pixelFor(phrase), false, phrase);
  }
  assert.equal(pixelFor("Site pixel installed on all pages"), true);
  assert.equal(pixelFor("Promote the hospital statewide"), "unknown");
});

const ynhhFacts = (planningSettings = settings(), additionalContext = "Cannot place pixels so can't track lower funnel activity") => buildCampaignFacts({
  kpis: ["awareness", "reach", "brand lift", "site visits"],
  additionalContext,
  workingMediaBudget: 50_000,
  campaignFlightDays: 30,
  requiredChannelIds: ["channel.ctv"],
  planningSettings,
});
const recommendedMeasurement = (facts: ReturnType<typeof buildCampaignFacts>) =>
  buildMediaRecommendationPlan(facts).channels.flatMap((channel) => channel.measurementCapabilities.map((record) => record.id));
const withMeasurement = (id: string, patch: object) => {
  const s = settings();
  s.measurement = s.measurement.map((row) => (row.measurementId === id ? { ...row, ...patch } : row));
  return s;
};
const ctv = () => {
  const product = buildMediaRecommendationPlan(ynhhFacts()).evaluatedCandidates.find((candidate) => candidate.product.id === "channel.ctv")!.product;
  return product;
};

test("a data requirement added in Settings blocks the product when the brief rules that data out", () => {
  assert.ok(recommendedMeasurement(ynhhFacts()).includes("measurement.brand_lift"));
  const s = withMeasurement("measurement.brand_lift", { dataRequirements: ["sitePixel"] });
  assert.ok(!recommendedMeasurement(ynhhFacts(s)).includes("measurement.brand_lift"));
});

test("clearing a product's data requirements in Settings lets it be recommended without a pixel", () => {
  const s = withMeasurement("measurement.consumer_journey_analytics_opa", { dataRequirements: [] });
  const facts = ynhhFacts(s);
  assert.equal(measurementFitsCampaign({ id: "measurement.consumer_journey_analytics_opa" }, facts), true);
});

test("manual-only measurement is never recommended but can still be added by a planner", () => {
  const s = withMeasurement("measurement.brand_lift", { availability: "manual" });
  assert.ok(!recommendedMeasurement(ynhhFacts(s)).includes("measurement.brand_lift"));
  assert.ok(channelRecordOptions(ctv(), s).measurementCapabilities.some((record) => record.id === "measurement.brand_lift"));
});

test("measurement switched off in Settings is neither recommended nor offered for manual add", () => {
  const s = withMeasurement("measurement.brand_lift", { availability: "off" });
  assert.ok(!recommendedMeasurement(ynhhFacts(s)).includes("measurement.brand_lift"));
  assert.ok(!channelRecordOptions(ctv(), s).measurementCapabilities.some((record) => record.id === "measurement.brand_lift"));
});

const scored = (scores: Record<string, number>) => Object.entries(scores).map(([channelId, score]) => ({
  channelId,
  components: { kpiAndFunnelFit: score, audienceAndPersonaFit: score, incrementalGapCoverage: score, dataReadiness: score, creativeReadiness: score, measurementFit: score },
}));
const MIXED_FIT = { "channel.search": 92, "channel.social_meta": 90, "channel.ctv": 88, "channel.display": 74, "channel.olv": 73, "channel.native": 73, "channel.youtube": 73, "channel.audio": 72, "channel.display_retargeting": 72, "channel.dooh": 72, "channel.youtube_tv": 72, "channel.linear_tv": 72 };
const hundredThousand = (kpis: string[]) => buildCampaignFacts({
  kpis,
  audienceDescriptions: ["Online shoppers who stream, search and scroll social"],
  workingMediaBudget: 100_000,
  campaignFlightDays: 30,
  geography: "United States",
  planningSettings: settings(),
});

test("the media-type cap is a ceiling, not a target: weaker fits are left out when the strong ones can use the budget", () => {
  const plan = buildMediaRecommendationPlan(hundredThousand(["purchases", "roas"]), scored(MIXED_FIT));
  assert.equal(plan.maxMediaTypes, 8);
  assert.ok(plan.selectedMediaTypeCount < 8, `expected fewer than 8 media types, got ${plan.selectedMediaTypeCount}`);
  const strong = plan.channels.filter((channel) => ["channel.search", "channel.social_meta", "channel.ctv"].includes(channel.channelId));
  assert.equal(strong.length, 3, "the three clear fits are all funded");
  assert.ok(strong.reduce((sum, channel) => sum + channel.allocationPercent, 0) >= 60, "and carry most of the budget");
  assert.equal(plan.channels.reduce((sum, channel) => sum + channel.allocationPercent, 0), 100);
  assert.ok(plan.allocationAudit.some((entry) => entry.type === "exclusion" && entry.detail.startsWith("Not funded")));
});

test("a stronger fit gets a meaningfully larger share than a weaker one with the same minimum spend", () => {
  // Meta and Native share a $5,000 minimum, so their curves differ only by fit. (A cheap media
  // type such as Search flattens sooner whatever its score, which is the point of the curves.)
  const plan = buildMediaRecommendationPlan(hundredThousand(["awareness", "reach"]), scored(MIXED_FIT));
  const share = (id: string) => plan.channels.find((channel) => channel.channelId === id)?.allocationPercent ?? 0;
  assert.ok(share("channel.native") > 0, "the weaker fit is still funded here");
  assert.ok(share("channel.social_meta") >= share("channel.native") * 1.5, `meta ${share("channel.social_meta")}% vs native ${share("channel.native")}%`);
});

test("a conversion goal concentrates the budget more than an awareness goal with the same scores", () => {
  const conversion = buildMediaRecommendationPlan(hundredThousand(["purchases", "roas"]), scored(MIXED_FIT));
  const awareness = buildMediaRecommendationPlan(hundredThousand(["awareness", "reach"]), scored(MIXED_FIT));
  // 1 / sum of squared shares: how many equal media types the split behaves like.
  const effective = (plan: typeof conversion) => 1 / plan.channels.reduce((sum, channel) => sum + (channel.allocationPercent / 100) ** 2, 0);
  assert.ok(conversion.selectedMediaTypeCount <= awareness.selectedMediaTypeCount);
  assert.ok(effective(conversion) < effective(awareness), `conversion ${effective(conversion).toFixed(2)} vs awareness ${effective(awareness).toFixed(2)}`);
});

test("every allocation still honours each media type's minimum spend and allocation bounds", () => {
  for (const kpis of [["purchases"], ["awareness"], ["site visits"]]) {
    const plan = buildMediaRecommendationPlan(hundredThousand(kpis), scored(MIXED_FIT));
    plan.channels.forEach((channel) => {
      assert.ok(channel.allocationDollars >= channel.minimumTotalSpend, `${channel.channelId} below its minimum spend`);
      assert.ok(channel.allocationPercent >= channel.minimumAllocationPercent);
      assert.ok(channel.allocationPercent <= channel.maximumAllocationPercent);
    });
  }
});

// CTV scores well below the rest here, so only the CTV-first rule can keep it in.
const WEAK_CTV = { ...MIXED_FIT, "channel.ctv": 60 };
const ctvPlan = (input: Partial<Parameters<typeof buildCampaignFacts>[0]> = {}) => buildMediaRecommendationPlan(buildCampaignFacts({
  kpis: ["purchases", "roas"],
  audienceDescriptions: ["Online shoppers who stream, search and scroll social"],
  workingMediaBudget: 100_000,
  campaignFlightDays: 30,
  geography: "United States",
  planningSettings: settings(),
  ...input,
}), scored(WEAK_CTV));
const hasCtv = (plan: ReturnType<typeof ctvPlan>) => plan.channels.some((channel) => channel.channelId === CTV_PRODUCT_ID);

test("CTV stays in every plan it is eligible for, even on a weak fit, within the media-type cap", () => {
  const plan = ctvPlan();
  assert.ok(hasCtv(plan));
  const ctv = plan.channels.find((channel) => channel.channelId === CTV_PRODUCT_ID)!;
  assert.ok(ctv.allocationDollars >= ctv.minimumTotalSpend, "at its normal minimum, not a planner-override floor");
  assert.ok(plan.selectedMediaTypeCount <= plan.maxMediaTypes);
  assert.deepEqual(ctvMissingAlerts(plan), []);
});

test("a planner who removes CTV, or picks only other media types, gets a plan without it and no warning", () => {
  const removed = ctvPlan({ excludedChannelIds: [CTV_PRODUCT_ID] });
  const onlyThese = ctvPlan({ requiredChannelIds: ["channel.search", "channel.social_meta"], requiredChannelsOnly: true });
  assert.ok(!hasCtv(removed));
  assert.ok(!hasCtv(onlyThese));
  assert.deepEqual(ctvMissingAlerts(removed), []);
  assert.deepEqual(ctvMissingAlerts(onlyThese), []);
});

test("a brief or RFP that rules out CTV is honoured, and the planner is shown the words it matched", () => {
  const fromNotes = ctvPlan({ additionalContext: "Client has a separate TV agency. No CTV this flight." });
  const fromRfp = ctvPlan({ mediaDirections: ["Streaming TV is out of scope for this RFP."] });
  assert.ok(!hasCtv(fromNotes));
  assert.ok(!hasCtv(fromRfp));
  const [alert] = ctvMissingAlerts(fromNotes);
  assert.ok(alert.includes('"No CTV"') && alert.includes("add CTV back"), alert);
});

test("a planner who adds CTV back overrides the brief's wording", () => {
  const plan = ctvPlan({ additionalContext: "No CTV this flight.", requiredChannelIds: [CTV_PRODUCT_ID] });
  assert.ok(hasCtv(plan));
});

test("only explicit exclusions of CTV count, not limits or comparisons", () => {
  for (const ruledOut of ["No CTV please", "exclude CTV/OTT from the mix", "We do not want to run connected TV", "Client won't buy OTT", "CTV is not approved by legal", "without streaming TV"]) {
    assert.ok(ctvRuledOutByBrief([ruledOut]), `should rule out: ${ruledOut}`);
  }
  for (const allowed of ["No more than 30% in CTV", "Not just CTV, we need search too", "CTV and OLV are priorities", "No other channels besides CTV matter as much", "Lead with CTV; no audio"]) {
    assert.equal(ctvRuledOutByBrief([allowed]), null, `should not rule out: ${allowed}`);
  }
});

test("a media type ScoutAI calls core earns more of the budget than the same fit called optional", () => {
  const withRole = (role: string) => buildMediaRecommendationPlan(hundredThousand(["purchases"]), scored(MIXED_FIT).map((signal) => signal.channelId === "channel.social_meta" ? { ...signal, role } : signal));
  const share = (plan: ReturnType<typeof withRole>) => plan.channels.find((channel) => channel.channelId === "channel.social_meta")?.allocationPercent ?? 0;
  assert.ok(share(withRole("core")) > share(withRole("optional")), `core ${share(withRole("core"))}% vs optional ${share(withRole("optional"))}%`);
  assert.equal(withRole("Core").evaluatedCandidates.find((candidate) => candidate.product.id === "channel.social_meta")?.aiRole, "core");
  assert.equal(withRole("essential").evaluatedCandidates.find((candidate) => candidate.product.id === "channel.social_meta")?.aiRole, undefined, "an unknown label is ignored, not guessed");
});

test("Plan focus moves a plan between fewer, deeper media types and a broader mix", () => {
  const withFocus = (planFocus: "focused" | "balanced" | "broad") => {
    const planningSettings = settings();
    planningSettings.planFocus = planFocus;
    return buildMediaRecommendationPlan(buildCampaignFacts({
      kpis: ["awareness", "reach"],
      audienceDescriptions: ["Online shoppers who stream, search and scroll social"],
      workingMediaBudget: 250_000,
      campaignFlightDays: 30,
      geography: "United States",
      planningSettings,
    }), scored(MIXED_FIT));
  };
  const effective = (plan: ReturnType<typeof withFocus>) => 1 / plan.channels.reduce((sum, channel) => sum + (channel.allocationPercent / 100) ** 2, 0);
  const [focused, balanced, broad] = [withFocus("focused"), withFocus("balanced"), withFocus("broad")];
  assert.ok(effective(focused) < effective(balanced) && effective(balanced) < effective(broad), `${effective(focused).toFixed(2)} < ${effective(balanced).toFixed(2)} < ${effective(broad).toFixed(2)}`);
  assert.ok(broad.selectedMediaTypeCount <= broad.maxMediaTypes, "Broad still respects the cap");
});

test("a local footprint puts Geo-Targeting in each channel's tactics, and a radius adds Geo-Fencing", () => {
  const base = {
    kpis: ["awareness"],
    audienceDescriptions: ["Streaming video viewers"],
    workingMediaBudget: 100_000,
    campaignFlightDays: 30,
    geography: "DMA (Boston)",
    planningSettings: settings(),
  };
  const tacticIds = (plan: ReturnType<typeof buildMediaRecommendationPlan>, id: string) =>
    plan.evaluatedCandidates.find((candidate) => candidate.product.id === id)!.targetingTactics.map((t) => t.id);

  const national = buildMediaRecommendationPlan(buildCampaignFacts(base));
  assert.ok(!tacticIds(national, "channel.ctv").includes("tactic.geo_targeting"));

  const geo = { scope: "dma" as const, unitCount: 1, households: 2_424_240, usSharePct: 2.1, places: ["Boston (Manchester), MA"], precision: [] };
  const local = buildMediaRecommendationPlan(buildCampaignFacts({ ...base, geo }));
  assert.ok(tacticIds(local, "channel.ctv").includes("tactic.geo_targeting"));
  assert.ok(!tacticIds(local, "channel.display").includes("tactic.geo_fencing"));
  assert.ok(local.assumptions.some((line) => /Boston DMA · 2\.4M TV households \(2\.1% of US\)/.test(line)), local.assumptions.join(" | "));

  const radius = buildMediaRecommendationPlan(buildCampaignFacts({ ...base, geo: { ...geo, precision: ["radius" as const] } }));
  assert.ok(tacticIds(radius, "channel.display").includes("tactic.geo_fencing"));
  // A retargeting channel still leads with the site visitors it exists to reach.
  assert.equal(radius.evaluatedCandidates.find((c) => c.product.id === "channel.display_retargeting")!.targetingTactics[0].id, "tactic.site_retargeting");
});
