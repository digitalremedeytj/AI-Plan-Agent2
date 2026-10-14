import assert from "node:assert/strict";
import test from "node:test";
import { buildCampaignFacts, buildMediaRecommendationPlan, inferAudienceType, measurementFitsCampaign, profileSignals, tacticFitsCampaign } from "./engine";
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
