import type { AudienceProfile, CanonicalMediaType } from "../types";
import { isNonMediaItem, normalizeRawChannel } from "../utils/mediaTaxonomy";
import {
  DIGITAL_REMEDY_PRODUCT_REGISTRY,
  findProductByAnyId,
  PLANNING_CATALOG_VERSION,
} from "./knowledge/registry";
import { planningKnowledgeBase } from "./knowledge/normalizeWorkbook";
import { findEffectiveProduct, resolveEffectiveProducts } from "./effectiveProducts";
import { findBudgetChannelTier, mergeMeasurementSettings, normalizeCampaignBudget, type MeasurementPlanningSetting, type PlanningSettings } from "./settings";
import type {
  AiCandidateSignal,
  AllocationAuditEntry,
  AttachedPlanningRecord,
  CampaignAudienceType,
  CampaignFacts,
  CampaignFactsInput,
  CandidateScoreComponents,
  ChannelPlanRecommendation,
  ConfidenceLevel,
  CreativeReadinessFacts,
  DataReadinessFacts,
  EvaluatedMediaCandidate,
  MediaProductRecord,
  MediaRecommendationPlan,
  RecommendationStatus,
  TriState,
} from "./types";

/**
 * Allocation floor, in whole percent, used for planner-required media types. A manual
 * override always wins over the product allocation minimum, so a required media type is
 * only ever held to 1% when checking whether a portfolio can be funded.
 */
const FORCED_FLOOR_PERCENT = 1;

/**
 * Whether a product can be sold at all. Planner overrides waive planning constraints
 * (budget, flight, and readiness minimums) but never catalog availability: a retired or
 * not-yet-launched product cannot be forced into a plan.
 */
function isSellable(product: MediaProductRecord): boolean {
  return product.digitalRemedyExecutable && product.recommendationEligible && product.status === "live";
}

/**
 * Whole-percent allocation bounds for a product. Planner-required media types are exempt
 * from both the product allocation minimum and the minimum-spend floor, and may absorb the
 * whole budget, so a manual override can never be rejected as infeasible. Every feasibility
 * check and the allocator itself must use this so they cannot disagree.
 */
function allocationBoundsPercent(product: MediaProductRecord, totalBudget: number, forced: boolean) {
  if (forced) return { minimum: FORCED_FLOOR_PERCENT, maximum: 100 };
  const spendPercent = totalBudget > 0 ? (product.minimumTotalSpend / totalBudget) * 100 : 100;
  return {
    minimum: Math.ceil(Math.max(product.minimumAllocationPercent, spendPercent)),
    maximum: Math.floor(product.maximumAllocationPercent),
  };
}

const SCORE_WEIGHTS: Record<keyof CandidateScoreComponents, number> = {
  kpiAndFunnelFit: 0.3,
  audienceAndPersonaFit: 0.25,
  incrementalGapCoverage: 0.15,
  dataReadiness: 0.1,
  creativeReadiness: 0.1,
  measurementFit: 0.1,
};

const DEFAULT_DATA_READINESS: DataReadinessFacts = {
  sitePixel: "unknown",
  conversionEvents: "unknown",
  meaningfulSiteTraffic: "unknown",
  crmSeedList: "unknown",
  crmSuppressionList: "unknown",
  leadOrRevenueExports: "unknown",
  offlineSalesData: "unknown",
  productFeed: "unknown",
  locationData: "unknown",
  firstPartyDataPermission: "unknown",
};

const DEFAULT_CREATIVE_READINESS: CreativeReadinessFacts = {
  displayAssets: "unknown",
  onlineVideoAssets: "unknown",
  ctvVideoAssets: "unknown",
  audioAssets: "unknown",
  socialAssets: "unknown",
  nativeContent: "unknown",
  productFeedCreative: "unknown",
  doohAssets: "unknown",
  highImpactBudgetAndLeadTime: "unknown",
};

function clampScore(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Math.round(Math.min(100, Math.max(0, Number.isFinite(numeric) ? numeric : fallback)));
}

function includesAny(haystack: string, needles: string[]): number {
  const normalized = haystack.toLowerCase();
  return needles.filter((needle) => normalized.includes(needle.toLowerCase())).length;
}

function inferTriState(text: string, positive: string[], negative: Array<string | RegExp>): TriState {
  const normalized = text.toLowerCase();
  if (negative.some((term) => typeof term === "string" ? normalized.includes(term) : term.test(normalized))) return false;
  if (positive.some((term) => normalized.includes(term))) return true;
  return "unknown";
}

// Planners write constraints as sentences ("Cannot place pixels so can't track lower funnel
// activity"), which fixed phrases like "no pixel" missed: the pixel stayed "unknown" and
// pixel-dependent measurement was still recommended. A negation within a few words of "pixel"
// counts as a no.
const NO_PIXEL = /\b(?:no|cannot|can ?not|can['’]?t|unable to|not able to|won['’]?t|will not|don['’]?t|do not|doesn['’]?t|does not|not allowed to|not permitted to)\b[^.;\n]{0,40}\bpixel|\bpixels?\b[^.;\n]{0,20}\b(?:not allowed|not permitted|not possible|unavailable|prohibited|not an option)\b/;
const NO_LOWER_FUNNEL_TRACKING = /\b(?:cannot|can ?not|can['’]?t|unable to|not able to|no way to)\b[^.;\n]{0,30}\b(?:track|measure|attribute)\b[^.;\n]{0,30}\b(?:lower[- ]funnel|conversions?|site activity|on-site)/;

function inferReadiness(text: string): { data: DataReadinessFacts; creative: CreativeReadinessFacts } {
  return {
    data: {
      ...DEFAULT_DATA_READINESS,
      sitePixel: inferTriState(text, ["site pixel", "pixel installed", "tracking pixel"], ["pixel unavailable", NO_PIXEL]),
      conversionEvents: inferTriState(text, ["conversion tracking", "defined conversion", "purchase event"], ["no conversion tracking", NO_PIXEL, NO_LOWER_FUNNEL_TRACKING]),
      meaningfulSiteTraffic: inferTriState(text, ["meaningful site traffic", "high site traffic", "retargeting pool"], ["no site traffic", "low site traffic"]),
      crmSeedList: inferTriState(text, ["crm seed", "customer list", "first-party list"], ["no crm", "no customer list"]),
      crmSuppressionList: inferTriState(text, ["suppression list", "crm suppression"], ["no suppression list"]),
      leadOrRevenueExports: inferTriState(text, ["lead export", "revenue export", "crm export"], ["no crm export"]),
      offlineSalesData: inferTriState(text, ["offline sales", "transaction data", "pos data"], ["no offline sales data"]),
      productFeed: inferTriState(text, ["product feed", "sku feed"], ["no product feed"]),
      locationData: inferTriState(text, ["store locations", "venue locations", "competitor locations", "campus locations"], ["no physical locations"]),
      firstPartyDataPermission: inferTriState(text, ["first-party data permission", "consented data"], ["no data permission"]),
    },
    creative: {
      ...DEFAULT_CREATIVE_READINESS,
      displayAssets: inferTriState(text, ["display assets", "banner assets", "static banners"], ["no display assets"]),
      onlineVideoAssets: inferTriState(text, ["online video assets", "olv creative", "video assets"], ["no video assets"]),
      ctvVideoAssets: inferTriState(text, ["ctv creative", ":15 video", ":30 video", "broadcast-quality video"], ["no ctv creative", "no video assets"]),
      audioAssets: inferTriState(text, ["audio assets", "audio creative", "radio spot"], ["no audio assets"]),
      socialAssets: inferTriState(text, ["social assets", "social creative", "ugc creative"], ["no social assets"]),
      nativeContent: inferTriState(text, ["native content", "editorial content", "sponsored article"], ["no native content"]),
      productFeedCreative: inferTriState(text, ["commerce creative", "product feed creative"], ["no product feed creative"]),
      doohAssets: inferTriState(text, ["dooh creative", "out-of-home creative", "high-glance creative"], ["no dooh creative"]),
      highImpactBudgetAndLeadTime: inferTriState(text, ["high impact budget", "production lead time"], ["no production budget"]),
    },
  };
}

// Used only when no Brief of Record supplied the audience type (a plan generated before it
// existed, or a direct engine call). Matches phrases a B2B brief would contain; anything else
// is treated as consumer, which is what every brand this tool has planned for has been.
const B2B_SIGNALS = ["b2b", "decision-maker", "decision maker", "it buyers", "procurement", "firmographic", "business owners", "enterprise buyers", "c-suite", "job title"];

export function inferAudienceType(text: string): CampaignAudienceType {
  return includesAny(text, B2B_SIGNALS) > 0 ? "B2B" : "B2C";
}

function canonicalToProductId(canonicalId: CanonicalMediaType): string | null {
  return DIGITAL_REMEDY_PRODUCT_REGISTRY.find((record) => record.legacyCanonicalId === canonicalId)?.id || null;
}

function effectiveProductRegistry(facts: CampaignFacts): MediaProductRecord[] {
  return resolveEffectiveProducts(facts.settings);
}

/**
 * `products` is the effective catalog, so custom media types resolve by id, name, or
 * alias the same way registry ones do. It falls back to the registry-only lookup for
 * the few call sites that run before a catalog is in hand.
 */
function resolveChannelId(raw: string, products?: MediaProductRecord[]): string | null {
  const exact = products ? findEffectiveProduct(products, raw) : findProductByAnyId(raw);
  if (exact) return exact.id;
  const mapping = normalizeRawChannel(raw);
  return canonicalToProductId(mapping.canonicalId);
}

function inclusiveDays(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!start || !end) return null;
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime()) || endDate < startDate) return null;
  return Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
}

export function buildCampaignFacts(input: CampaignFactsInput): CampaignFacts {
  const selectedOptions = input.selectedPlanOptions || [];
  const existingPlacements = selectedOptions.flatMap((option) => option.placements || []);
  const optionStarts = selectedOptions.map((option) => option.flightDates?.start).filter(Boolean) as string[];
  const optionEnds = selectedOptions.map((option) => option.flightDates?.end).filter(Boolean) as string[];
  const campaignStartDate = input.campaignStartDate || optionStarts.sort()[0] || null;
  const campaignEndDate = input.campaignEndDate || optionEnds.sort().at(-1) || null;
  const dateDerivedDays = inclusiveDays(campaignStartDate, campaignEndDate);
  const campaignFlightDays = input.campaignFlightDays && input.campaignFlightDays >= 1
    ? Math.round(input.campaignFlightDays)
    : dateDerivedDays;
  const normalization = normalizeCampaignBudget(input.workingMediaBudget, campaignFlightDays);
  const appliedBudgetTier = findBudgetChannelTier(normalization.normalized30DayBudget, input.planningSettings);
  const combinedText = [
    input.campaignFocus,
    // The brief's free-text context is where planners state data constraints ("cannot place pixels").
    input.additionalContext,
    ...(input.kpis || []),
    ...(input.audienceDescriptions || []),
    ...(input.audienceSignals || []),
    ...existingPlacements.flatMap((placement) => [placement.audience, placement.notes, placement.adSizes]),
  ].filter(Boolean).join(" ");
  const inferred = inferReadiness(combinedText);
  const effectiveProducts = resolveEffectiveProducts(input.planningSettings);
  const existingChannelIds = Array.from(new Set(
    existingPlacements
      .map((placement) => resolveChannelId(placement.mediaType || placement.productType || placement.publisher || "", effectiveProducts))
      .filter((value): value is string => Boolean(value)),
  ));

  const requiredChannelIds = (input.requiredChannelIds || []).map((id) => resolveChannelId(id, effectiveProducts) || id);
  // "Only these" is expressed as exclusions rather than a separate cap so it survives the
  // round trip through manualExcludedChannelIds and every later re-plan keeps honouring it.
  const excludedChannelIds = Array.from(new Set([
    ...(input.excludedChannelIds || []).map((id) => resolveChannelId(id, effectiveProducts) || id),
    ...(input.requiredChannelsOnly && requiredChannelIds.length > 0
      ? effectiveProducts.map((product) => product.id).filter((id) => !requiredChannelIds.includes(id))
      : []),
  ])).filter((id) => !requiredChannelIds.includes(id));

  return {
    advertiserName: input.advertiserName || "",
    advertiserUrl: input.advertiserUrl || "",
    vertical: input.vertical || "unknown",
    subvertical: input.subvertical || "unknown",
    audienceType: input.audienceType || inferAudienceType(combinedText),
    primaryKpi: input.kpis?.find(Boolean) || input.campaignFocus || "awareness",
    kpis: (input.kpis || []).filter(Boolean),
    funnelStages: [input.campaignFocus || "full-funnel"],
    audienceDescriptions: (input.audienceDescriptions || []).filter(Boolean),
    audienceSignals: (input.audienceSignals || []).filter(Boolean),
    geography: input.geography || "United States",
    totalWorkingMediaBudget: normalization.workingMediaBudget,
    campaignStartDate,
    campaignEndDate,
    campaignFlightDays: normalization.campaignFlightDays,
    normalized30DayBudget: normalization.normalized30DayBudget,
    planningMode: input.planningMode || (selectedOptions.length > 0 ? "reallocation" : "greenfield"),
    existingPlacements,
    existingChannelIds,
    requiredChannelIds,
    preferredChannelIds: (input.preferredChannelIds || []).map((id) => resolveChannelId(id, effectiveProducts) || id),
    excludedChannelIds,
    dataReadiness: { ...inferred.data, ...(input.dataReadiness || {}) },
    creativeReadiness: { ...inferred.creative, ...(input.creativeReadiness || {}) },
    measurementExpectations: input.measurementExpectations || [],
    brandSafetyConstraints: input.brandSafetyConstraints || [],
    assumptions: [
      ...normalization.assumptions,
      ...(input.planningMode === "incremental" ? ["Existing plan allocations are fixed; only the supplied incremental working media budget is allocated."] : []),
    ],
    settings: input.planningSettings,
    appliedBudgetTier,
    ctvPublishers: input.ctvPublishers || [],
  };
}

function readinessScore(requirements: string[], readiness: Record<string, TriState>): number {
  if (requirements.length === 0) return 78;
  const values = requirements.map((requirement) => readiness[requirement]);
  if (values.some((value) => value === false)) return 10;
  if (values.some((value) => value === "unknown")) return 45;
  return 92;
}

function triggerText(facts: CampaignFacts): string {
  return [facts.primaryKpi, ...facts.kpis, ...facts.funnelStages, ...facts.audienceDescriptions, ...facts.audienceSignals].join(" ").toLowerCase();
}

function fallbackComponents(product: MediaProductRecord, facts: CampaignFacts): CandidateScoreComponents {
  const context = triggerText(facts);
  const kpiHits = includesAny(context, [...product.supportedKpis, ...product.funnelRoles]);
  const audienceHits = includesAny(context, product.audienceSignals);
  // existingChannelIds are already resolved product ids, so compare directly; routing
  // them back through the registry lookup would drop custom media types.
  const alreadyRunning = facts.existingChannelIds.includes(product.id);
  const preferred = facts.preferredChannelIds.includes(product.id);
  return {
    kpiAndFunnelFit: Math.min(95, 48 + kpiHits * 12 + (product.defaultPriority === "core" ? 6 : 0)),
    audienceAndPersonaFit: Math.min(95, 48 + audienceHits * 12),
    incrementalGapCoverage: alreadyRunning ? 25 : preferred ? 90 : 72,
    dataReadiness: readinessScore(product.dataRequirements, facts.dataReadiness as unknown as Record<string, TriState>),
    creativeReadiness: readinessScore(product.creativeRequirements, facts.creativeReadiness as unknown as Record<string, TriState>),
    measurementFit: Math.min(95, 65 + kpiHits * 7),
  };
}

function weightedScore(components: CandidateScoreComponents): number {
  return Math.round(
    (Object.keys(SCORE_WEIGHTS) as Array<keyof CandidateScoreComponents>)
      .reduce((total, key) => total + components[key] * SCORE_WEIGHTS[key], 0),
  );
}

function evidenceConfidence(evidenceCount: number, prerequisites: string[], score: number): ConfidenceLevel {
  if (evidenceCount >= 3 && prerequisites.length === 0 && score >= 75) return "high";
  if (evidenceCount >= 1 && score >= 60) return "medium";
  return "low";
}

function canonicalGeography(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    [
      "us",
      "u.s.",
      "usa",
      "u.s.a.",
      "united states",
      "united states of america",
      "national",
    ].includes(normalized)
  ) {
    return "united states";
  }
  if (normalized.startsWith("state") || normalized.startsWith("dma")) {
    return "united states";
  }
  return normalized;
}

function eligibility(product: MediaProductRecord, facts: CampaignFacts): { failures: string[]; prerequisites: string[] } {
  const failures: string[] = [];
  const prerequisites: string[] = [];
  if (!product.digitalRemedyExecutable) failures.push("Product is not Digital Remedy-executable.");
  if (!product.recommendationEligible) failures.push("Product is not recommendation eligible.");
  if (product.status !== "live") failures.push(`Product status is ${product.status}; only live products can receive allocation.`);
  if (!product.supportedGeographies.some((geography) => canonicalGeography(geography) === canonicalGeography(facts.geography))) failures.push(`Product is not currently verified for ${facts.geography}.`);
  if (facts.excludedChannelIds.includes(product.id)) failures.push("Product was explicitly excluded by the planner.");
  if (facts.planningMode === "incremental" && facts.existingChannelIds.includes(product.id)) {
    failures.push("Channel is already in the fixed baseline and is excluded from incremental-budget allocation.");
  }
  if (product.verticalExclusions.some((vertical) => facts.vertical.toLowerCase().includes(vertical.toLowerCase()))) {
    failures.push(`Product is excluded for the ${facts.vertical} vertical.`);
  }
  if (facts.totalWorkingMediaBudget < product.minimumTotalSpend) {
    failures.push(`Working media budget is below the $${product.minimumTotalSpend.toLocaleString()} product minimum.`);
  }
  if (facts.normalized30DayBudget < product.minimumNormalized30DaySpend) {
    failures.push(`Normalized 30-day budget is below the $${product.minimumNormalized30DaySpend.toLocaleString()} monthly minimum.`);
  }
  if (facts.campaignFlightDays !== null && facts.campaignFlightDays < product.minimumFlightDays) {
    failures.push(`Flight is shorter than the ${product.minimumFlightDays}-day product minimum.`);
  } else if (facts.campaignFlightDays === null) {
    prerequisites.push(`Confirm a flight of at least ${product.minimumFlightDays} days.`);
  }

  const formatReqName = (req: string): string => {
    const map: Record<string, string> = {
      ctvVideoAssets: 'CTV Video Assets',
      onlineVideoAssets: 'Online Video Assets',
      displayAssets: 'Display Assets',
      audioAssets: 'Audio Assets',
      socialAssets: 'Social Assets',
      nativeContent: 'Native Content Assets',
      productFeedCreative: 'Product Feed Creative Assets',
      doohAssets: 'DOOH Creative Assets',
      highImpactBudgetAndLeadTime: 'High Impact Budget & Lead Time',
      sitePixel: 'Site Conversion Pixel',
      meaningfulSiteTraffic: 'Meaningful Site Traffic',
      crmSuppressionList: 'CRM Suppression List',
      leadOrRevenueExports: 'Lead or Revenue Exports',
      offlineSalesData: 'Offline Sales Data',
      productFeed: 'Product Feed',
      locationData: 'Location Data',
      firstPartyDataPermission: '1st-Party Data Permission',
    };
    return map[req] || req.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
  };

  product.dataRequirements.forEach((requirement) => {
    const value = facts.dataReadiness[requirement];
    if (value !== true) prerequisites.push(`${formatReqName(requirement)} (${requirement}) must be confirmed before allocation.`);
  });
  product.creativeRequirements.forEach((requirement) => {
    const value = facts.creativeReadiness[requirement];
    if (value !== true) prerequisites.push(`${formatReqName(requirement)} (${requirement}) must be supplied or produced before launch.`);
  });
  return { failures, prerequisites };
}

function defaultGap(product: MediaProductRecord, facts: CampaignFacts): string {
  const existing = facts.existingChannelIds.length > 0 ? "uploaded baseline" : "new plan mix";
  return `${product.displayName} adds ${product.funnelRoles.join(" and ")} coverage that is not fully represented in the ${existing}.`;
}

function defaultActivation(product: MediaProductRecord): string {
  return `Activate ${product.displayName} with workbook-compatible targeting, controlled inventory, and creative matched to its ${product.funnelRoles.join("/")} role.`;
}

function findSignal(productId: string, aiSignals: AiCandidateSignal[]): AiCandidateSignal | undefined {
  return aiSignals.find((signal) => signal.channelId === productId || resolveChannelId(signal.channelId) === productId);
}

export function evaluateCandidates(facts: CampaignFacts, aiSignals: AiCandidateSignal[] = []): EvaluatedMediaCandidate[] {
  const context = triggerText(facts);
  return effectiveProductRegistry(facts).map((product) => {
    const signal = findSignal(product.id, aiSignals);
    const fallback = fallbackComponents(product, facts);
    const components: CandidateScoreComponents = {
      kpiAndFunnelFit: clampScore(signal?.components?.kpiAndFunnelFit, fallback.kpiAndFunnelFit),
      audienceAndPersonaFit: clampScore(signal?.components?.audienceAndPersonaFit, fallback.audienceAndPersonaFit),
      incrementalGapCoverage: clampScore(signal?.components?.incrementalGapCoverage, fallback.incrementalGapCoverage),
      dataReadiness: clampScore(signal?.components?.dataReadiness, fallback.dataReadiness),
      creativeReadiness: clampScore(signal?.components?.creativeReadiness, fallback.creativeReadiness),
      measurementFit: clampScore(signal?.components?.measurementFit, fallback.measurementFit),
    };
    const score = weightedScore(components);
    const { failures, prerequisites } = eligibility(product, facts);
    const triggerFired = includesAny(context, [...product.supportedKpis, ...product.audienceSignals, ...product.funnelRoles]) > 0;
    if (product.defaultPriority === "deprioritized" && !triggerFired) {
      failures.push("The workbook-specific trigger for this deprioritized channel did not fire.");
    }
    let status: RecommendationStatus;
    if (failures.length > 0 || score < 55) status = "DO_NOT_ADD";
    else if (score < 72 || prerequisites.length > 0) status = "TEST";
    else status = "ADD";

    const evidence = [
      ...(signal?.evidence || []).filter((item) => item && item.sourceType && item.detail),
      { sourceType: "digital_remedy_rule" as const, detail: `${product.displayName} is ${product.status} and Digital Remedy-executable.`, sourceId: product.sourceMetadata.sourceLabels.join("; ") },
    ];
    if (facts.kpis.length > 0) evidence.push({ sourceType: "brief", detail: `Campaign KPI context: ${facts.kpis.join(", ")}.` });
    if (facts.existingChannelIds.includes(product.id)) evidence.push({ sourceType: "uploaded_plan", detail: `${product.displayName} appears in the uploaded baseline.` });
    const confidence = evidenceConfidence(evidence.length, prerequisites, score);

    return {
      product,
      aiAssessed: Boolean(signal),
      status,
      recommendationScore: score,
      confidence,
      components,
      evidence,
      eligibilityFailures: failures,
      prerequisites,
      gapAddressed: signal?.gapAddressed || defaultGap(product, facts),
      activationGuidance: signal?.activationGuidance || defaultActivation(product),
      measurementApproach: signal?.measurementApproach || "Use the best eligible workbook measurement capability for the primary KPI.",
      tradeoffs: signal?.tradeoffs || (prerequisites.length ? ["Readiness must be confirmed before launch."] : []),
      allocationRationale: signal?.allocationRationale || "Allocation follows validated fit score, product minimums, and portfolio constraints.",
      decisionRule: signal?.decisionRule || "Scale when the primary KPI clears target after the initial learning period; reduce or stop if it does not.",
      targetingTactics: attachTargeting(product, facts),
      publishers: attachPublishers(product, facts),
      creativeEnhancements: attachEnhancements(product, facts),
      inventoryControls: attachInventory(product, facts),
      measurementCapabilities: attachMeasurement(product, facts),
    };
  });
}

function selectPortfolio(candidates: EvaluatedMediaCandidate[], facts: CampaignFacts, audit: AllocationAuditEntry[]): EvaluatedMediaCandidate[] {
  const required = new Set(facts.requiredChannelIds);
  const selectable = candidates
    .filter((candidate) =>
      candidate.status === "ADD" ||
      candidate.status === "TEST" ||
      (required.has(candidate.product.id) && isSellable(candidate.product)),
    )
    .sort((a, b) => {
      const aRequired = facts.requiredChannelIds.includes(a.product.id) ? 1 : 0;
      const bRequired = facts.requiredChannelIds.includes(b.product.id) ? 1 : 0;
      const aExisting = facts.existingChannelIds.includes(a.product.id) ? 1 : 0;
      const bExisting = facts.existingChannelIds.includes(b.product.id) ? 1 : 0;
      return bRequired - aRequired || bExisting - aExisting || b.recommendationScore - a.recommendationScore || a.product.id.localeCompare(b.product.id);
    });
  const cap = Math.min(selectable.length, facts.appliedBudgetTier.maxChannels + required.size);
  if (required.size > 0) {
    audit.push({
      type: "mode",
      detail: `Planner manually required ${required.size} media type(s); the automatic ${facts.appliedBudgetTier.maxChannels}-type cap was expanded to ${cap}.`,
    });
  }
  let best: EvaluatedMediaCandidate[] = [];
  let bestObjective = Number.NEGATIVE_INFINITY;

  const evaluatePortfolio = (portfolio: EvaluatedMediaCandidate[]) => {
    if (portfolio.length === 0) return;
    if ([...required].some((id) => !portfolio.some((candidate) => candidate.product.id === id))) return;
    const minimumSpend = portfolio.reduce(
      (sum, candidate) => sum + (required.has(candidate.product.id) ? 0 : candidate.product.minimumTotalSpend),
      0,
    );
    if (minimumSpend > facts.totalWorkingMediaBudget) return;
    const minimumPercent = portfolio.reduce(
      (sum, candidate) => sum + allocationBoundsPercent(candidate.product, facts.totalWorkingMediaBudget, required.has(candidate.product.id)).minimum,
      0,
    );
    const maximumPercent = portfolio.reduce(
      (sum, candidate) => sum + allocationBoundsPercent(candidate.product, facts.totalWorkingMediaBudget, required.has(candidate.product.id)).maximum,
      0,
    );
    if (minimumPercent > 100 || maximumPercent < 100) return;
    const objective = portfolio.reduce((sum, candidate) => {
      const existingBonus = facts.existingChannelIds.includes(candidate.product.id) ? 12 : 0;
      const preferredBonus = facts.preferredChannelIds.includes(candidate.product.id) ? 8 : 0;
      const requiredBonus = required.has(candidate.product.id) ? 100 : 0;
      const addBonus = candidate.status === "ADD" ? 5 : 0;
      return sum + candidate.recommendationScore - 60 + existingBonus + preferredBonus + requiredBonus + addBonus;
    }, 0) - Math.max(0, portfolio.length - 1) * 5;
    if (
      objective > bestObjective ||
      (objective === bestObjective && portfolio.length < best.length) ||
      (objective === bestObjective && portfolio.length === best.length && portfolio.map((item) => item.product.id).join("|") < best.map((item) => item.product.id).join("|"))
    ) {
      best = [...portfolio];
      bestObjective = objective;
    }
  };

  const search = (index: number, portfolio: EvaluatedMediaCandidate[]) => {
    evaluatePortfolio(portfolio);
    if (index >= selectable.length || portfolio.length >= cap) return;
    for (let candidateIndex = index; candidateIndex < selectable.length; candidateIndex += 1) {
      const candidate = selectable[candidateIndex];
      const minimumSpend = portfolio.reduce(
        (sum, item) => sum + (required.has(item.product.id) ? 0 : item.product.minimumTotalSpend),
        0,
      ) + (required.has(candidate.product.id) ? 0 : candidate.product.minimumTotalSpend);
      if (minimumSpend > facts.totalWorkingMediaBudget) continue;
      search(candidateIndex + 1, [...portfolio, candidate]);
    }
  };
  search(0, []);

  if (required.size > 0 && best.length === 0) {
    audit.push({
      type: "exclusion",
      detail: "No feasible portfolio can satisfy every planner-required media type together. The required set exceeds the spend and allocation bounds for this budget.",
    });
  }

  const selectedIds = new Set(best.map((candidate) => candidate.product.id));
  best.forEach((candidate) => audit.push({
    type: "selection",
    channelId: candidate.product.id,
    detail: `Selected with score ${candidate.recommendationScore} and ${candidate.status} status in the highest-value feasible portfolio.`,
  }));
  selectable.filter((candidate) => !selectedIds.has(candidate.product.id)).forEach((candidate) => audit.push({
    type: "exclusion",
    channelId: candidate.product.id,
    detail: "Excluded by portfolio optimization because it did not improve the highest-value feasible mix after spend, allocation, and fragmentation constraints.",
  }));
  return best;
}

function allocateBasisPoints(selected: EvaluatedMediaCandidate[], totalBudget: number, audit: AllocationAuditEntry[], forcedIds: Set<string> = new Set()): Map<string, number> {
  const allocations = new Map<string, number>();
  // Non-forced products hold a hard minimum. Whatever room is left over is offered to the
  // planner-forced products at their own product minimum, and only squeezed toward the 1%
  // override floor when the rest of the portfolio has already claimed the budget.
  const hardMinimumPercent = selected.reduce((sum, candidate) => {
    if (forcedIds.has(candidate.product.id)) return sum;
    return sum + allocationBoundsPercent(candidate.product, totalBudget, false).minimum;
  }, 0);
  const forcedCandidates = selected.filter((candidate) => forcedIds.has(candidate.product.id));
  let forcedRoomPercent = Math.max(0, 100 - hardMinimumPercent);
  const forcedTargets = new Map<string, number>();
  forcedCandidates
    .slice()
    .sort((a, b) => allocationBoundsPercent(a.product, totalBudget, false).minimum - allocationBoundsPercent(b.product, totalBudget, false).minimum)
    .forEach((candidate, index) => {
      const remainingForced = forcedCandidates.length - index;
      // Even share of what is left, so two forced media types are squeezed equally rather
      // than the first one taking the room. Anything a product does not need rolls forward.
      const fairShare = Math.floor(forcedRoomPercent / remainingForced);
      const wanted = Math.min(
        allocationBoundsPercent(candidate.product, totalBudget, false).minimum,
        Math.floor(candidate.product.maximumAllocationPercent),
      );
      const grant = Math.max(FORCED_FLOOR_PERCENT, Math.min(wanted, fairShare));
      forcedTargets.set(candidate.product.id, grant);
      forcedRoomPercent = Math.max(0, forcedRoomPercent - grant);
    });

  selected.forEach((candidate) => {
    const forced = forcedIds.has(candidate.product.id);
    const bounds = allocationBoundsPercent(candidate.product, totalBudget, forced);
    const productMinimum = allocationBoundsPercent(candidate.product, totalBudget, false).minimum;
    const wholeMinimumPercent = forced
      ? Math.min(bounds.maximum, forcedTargets.get(candidate.product.id) ?? bounds.minimum)
      : Math.min(bounds.maximum, bounds.minimum);
    allocations.set(candidate.product.id, wholeMinimumPercent * 100);
    audit.push({
      type: "minimum",
      channelId: candidate.product.id,
      detail: forced
        ? wholeMinimumPercent >= productMinimum
          ? `Applied the ${wholeMinimumPercent}% product minimum to this planner-required media type.`
          : `Applied a ${wholeMinimumPercent}% planner-override floor; the ${productMinimum}% product allocation and spend minimums were waived to honour the manual request.`
        : `Applied a whole-number effective minimum of ${wholeMinimumPercent}% from product percent and spend constraints.`,
    });
  });
  let remaining = 10_000 - Array.from(allocations.values()).reduce((sum, value) => sum + value, 0);
  if (remaining < 0) throw new Error("Selected channel minimum allocation percentages exceed 100%. Remove a media type or increase the budget.");

  const capOf = (candidate: EvaluatedMediaCandidate) => allocationBoundsPercent(candidate.product, totalBudget, forcedIds.has(candidate.product.id)).maximum * 100;
  let active = selected.filter((candidate) => (allocations.get(candidate.product.id) || 0) < capOf(candidate));
  while (remaining > 0 && active.length > 0) {
    const totalWeight = active.reduce((sum, candidate) => sum + Math.max(1, candidate.recommendationScore), 0);
    let distributed = 0;
    active.forEach((candidate) => {
      const available = remaining - distributed;
      if (available <= 0) return;
      const current = allocations.get(candidate.product.id) || 0;
      const cap = capOf(candidate);
      const proportional = Math.max(100, Math.floor(((remaining * candidate.recommendationScore) / totalWeight) / 100) * 100);
      const addition = Math.min(cap - current, proportional, available);
      if (addition > 0) {
        allocations.set(candidate.product.id, current + addition);
        distributed += addition;
      }
    });
    remaining -= distributed;
    active = active.filter((candidate) => (allocations.get(candidate.product.id) || 0) < capOf(candidate));
    if (distributed === 0 && active.length > 0) {
      const candidate = active[0];
      allocations.set(candidate.product.id, (allocations.get(candidate.product.id) || 0) + 100);
      remaining -= 100;
    }
  }
  if (remaining !== 0) throw new Error("Channel maximum allocations cannot absorb the full budget.");
  audit.push({ type: "rebalance", detail: "Distributed remaining allocation across uncapped channels using validated recommendation scores." });
  return allocations;
}

function dollarsFromBasisPoints(totalBudget: number, basisPoints: Map<string, number>): Map<string, number> {
  const totalCents = Math.round(totalBudget * 100);
  const ids = Array.from(basisPoints.keys()).sort();
  const exact = ids.map((id) => ({ id, value: (totalCents * (basisPoints.get(id) || 0)) / 10_000 }));
  const cents = new Map(exact.map(({ id, value }) => [id, Math.floor(value)]));
  let remainder = totalCents - Array.from(cents.values()).reduce((sum, value) => sum + value, 0);
  exact.sort((a, b) => (b.value - Math.floor(b.value)) - (a.value - Math.floor(a.value)) || a.id.localeCompare(b.id));
  for (let index = 0; remainder > 0; index = (index + 1) % exact.length) {
    const id = exact[index].id;
    cents.set(id, (cents.get(id) || 0) + 1);
    remainder -= 1;
  }
  return new Map(ids.map((id) => [id, (cents.get(id) || 0) / 100]));
}

function channelLabels(product: MediaProductRecord): string[] {
  const labels: Record<string, string[]> = {
    "channel.display": ["Display", "Any channel", "Any programmatic channel", "Any open-exchange channel"],
    "channel.display_retargeting": ["Display", "Any channel", "Any programmatic channel"],
    "channel.olv": ["OLV", "Online Video", "Video", "Any channel", "Any programmatic channel"],
    "channel.ctv": ["CTV / OTT", "CTV/OTT", "Any channel", "Any programmatic channel"],
    "channel.native": ["Native", "Any channel", "Any programmatic channel"],
    "channel.audio": ["Audio", "Any channel", "Any programmatic channel"],
    "channel.dooh": ["DOOH", "Any channel"],
    "channel.search": ["Search", "Any channel"],
    "channel.social_meta": ["Social", "Any channel"],
    "channel.youtube": ["Social", "Any channel"],
  };
  return labels[product.id] || [product.displayName, "Any channel"];
}

function attachmentMatches(attachesTo: string[], product: MediaProductRecord): boolean {
  const labels = channelLabels(product).map((label) => label.toLowerCase());
  return attachesTo.some((target) => labels.some((label) => target.toLowerCase().includes(label) || label.includes(target.toLowerCase())));
}

const RETAILER_PHRASES: Record<string, string[]> = {
  walmart: ["walmart"],
  amazon: ["amazon"],
  roundel_target: ["roundel", "target.com", "target stores", "at target", "target corporation"],
  kroger: ["kroger"],
  costco: ["costco"],
  home_depot: ["home depot", "homedepot"],
};

/**
 * Whether a workbook tactic can apply to this campaign at all. Compatibility with the channel
 * is not enough: "B2B Job Title / Company IP" is compatible with Display, Meta, CTV and more,
 * and attaching it on compatibility alone put B2B targeting in consumer pet-food plans.
 * A tactic whose prerequisite the brief rules out is excluded; one whose prerequisite is merely
 * unknown stays, since the plan already lists prerequisites for the planner to confirm.
 */
export function tacticFitsCampaign(record: { id: string; displayName: string; trigger: string }, facts: CampaignFacts): boolean {
  const isB2bTactic = /\bb2b\b/i.test(`${record.displayName} ${record.trigger}`);
  if (isB2bTactic) return facts.audienceType === "B2B" || facts.audienceType === "B2B2C";

  // Retail-media data belongs to one retailer, and is only a fit when the brief names that
  // retailer. Phrases rather than the display name, because "Target" alone matches every
  // brief that says "target audience".
  if (record.id.includes("retail_data")) {
    const phrases = Object.entries(RETAILER_PHRASES).find(([key]) => record.id.includes(key))?.[1];
    if (!phrases) return false;
    const context = [facts.advertiserName, facts.advertiserUrl, ...facts.audienceDescriptions, ...facts.audienceSignals].join(" ");
    return includesAny(context, phrases) > 0;
  }

  const data = facts.dataReadiness;
  const prerequisite: Record<string, TriState | undefined> = {
    "tactic.crm_targeting": data.crmSeedList,
    "tactic.crm_lookalike": data.crmSeedList,
    "tactic.crm_suppression": data.crmSuppressionList,
    "tactic.purchase_transaction_data": data.offlineSalesData,
    "tactic.site_retargeting": data.meaningfulSiteTraffic,
    "tactic.geo_conquesting": data.locationData,
  };
  return prerequisite[record.id] !== false;
}

// The campaign goals each tactic serves. Workbook triggers rarely share words with a brief, so
// without this every tactic tied and row order put "Purchase / Transaction Data" - meant for
// when offline sales panels exist - third on nearly every channel.
const TACTIC_SERVES: Record<string, string[]> = {
  "tactic.in_market_shopping_intent": ["conversion", "site visit", "purchase", "sales", "online sale", "traffic", "e-commerce", "ecommerce"],
  "tactic.search_intent_retargeting": ["conversion", "site visit", "consideration", "traffic"],
  // Site Retargeting is deliberately absent: it leads on retargeting channels (see
  // attachTargeting) and would otherwise duplicate that line's job on every prospecting channel.
  "tactic.contextual_targeting": ["awareness", "consideration", "full-funnel", "full funnel", "brand"],
  "tactic.acr_targeting": ["awareness", "reach", "conquest"],
  "tactic.crm_lookalike": ["prospecting", "acquisition", "new customer"],
  "tactic.crm_targeting": ["retention", "loyalty", "win-back", "re-engage"],
  "tactic.purchase_transaction_data": ["sales lift", "offline sales", "in-store sales"],
  "tactic.geo_targeting": ["local", "store", "market"],
  "tactic.daypart_targeting": ["frequency", "efficiency"],
};

function tacticScore(record: { id: string; trigger: string }, facts: CampaignFacts, context: string): number {
  const goals = [...facts.kpis, facts.primaryKpi, ...facts.funnelStages].join(" ");
  return includesAny(goals, TACTIC_SERVES[record.id] ?? []) * 10 + tacticRelevance(record.trigger, context);
}

/** How many of a tactic's trigger phrases ("Awareness", "Conversion", ...) the campaign mentions. */
function tacticRelevance(trigger: string, context: string): number {
  const phrases = trigger.split(/[;,]/).map((phrase) => phrase.trim()).filter((phrase) => phrase.length > 3);
  return includesAny(context, phrases);
}

function isRetargetingProduct(product: MediaProductRecord): boolean {
  return /retargeting/i.test(`${product.id} ${product.displayName}`);
}

function attachTargeting(product: MediaProductRecord, facts: CampaignFacts): AttachedPlanningRecord[] {
  const compatibleIds = new Set(planningKnowledgeBase.compatibilityEdges
    .filter((edge) => edge.toId === product.id && edge.relationship === "compatible")
    .map((edge) => edge.fromId));
  const context = triggerText(facts);
  return planningKnowledgeBase.targetingTactics
    .filter((record) => record.recommendationEligible && (compatibleIds.has(record.id) || product.id === "channel.display_retargeting"))
    .filter((record) => tacticFitsCampaign(record, facts))
    // Ranked by trigger phrases rather than the whole trigger string: the whole string never
    // appears in a brief, so every tactic tied and the workbook's row order decided the top 3.
    // A retargeting channel leads with its retargeting tactics; others with the foundational
    // demographic default. Display Retargeting used to carry Behavioral, Interest and
    // Contextual - nothing that names the site visitors it exists to reach.
    .sort((a, b) => {
      const lead = (record: { id: string; displayName: string }) => isRetargetingProduct(product)
        ? (record.id === "tactic.site_retargeting" ? 2 : record.id.includes("retargeting") ? 1 : 0)
        : (record.displayName === "Behavioral / Demographic" ? 1 : record.id.includes("retargeting") ? -1 : 0);
      return lead(b) - lead(a) || tacticScore(b, facts, context) - tacticScore(a, facts, context);
    })
    .slice(0, 3)
    .map(({ id, displayName, rationale }) => ({ id, displayName, rationale }));
}

function isCtvOrPerformanceTvProduct(product: MediaProductRecord): boolean {
  const id = product.id.toLowerCase();
  const name = product.displayName.toLowerCase();
  const canonical = (product.legacyCanonicalId || "").toLowerCase();

  return (
    id === "channel.ctv" ||
    id === "channel.performance_tv" ||
    id === "ctv" ||
    id === "performance_tv" ||
    canonical === "ctv" ||
    canonical === "ctv_ott" ||
    canonical === "performance_tv" ||
    name === "ctv / ott" ||
    name === "ctv/ott" ||
    name === "performance tv" ||
    name === "performance ctv" ||
    name === "connected tv" ||
    id.includes("channel.ctv") ||
    id.includes("performance_tv") ||
    name.includes("performance tv") ||
    name.includes("ctv / ott") ||
    name.includes("ctv/ott")
  );
}

function attachPublishers(product: MediaProductRecord, facts: CampaignFacts): AttachedPlanningRecord[] {
  const isCtvOrPerf = isCtvOrPerformanceTvProduct(product);

  if (isCtvOrPerf && facts.ctvPublishers && facts.ctvPublishers.length > 0) {
    return facts.ctvPublishers.map((pub) => ({
      id: `publisher.ctv.${pub.publisher.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
      displayName: pub.publisher,
      rationale: pub.why || "",
    }));
  }

  const context = triggerText(facts);
  const eligible = facts.settings.publishers
    .filter((record) => record.recommendationEligible && (attachmentMatches(record.attachesTo, product) || (isCtvOrPerf && attachmentMatches(record.attachesTo, { ...product, id: "channel.ctv", displayName: "CTV / OTT" }))));

  if (isCtvOrPerf) {
    const targetCount = Math.max(1, Math.min(30, Math.round(facts.settings.ctvPublisherTargetCount ?? 8)));

    const sortByRelevance = (a: (typeof eligible)[0], b: (typeof eligible)[0]) =>
      includesAny(context, [b.notes]) - includesAny(context, [a.notes]) || a.displayName.localeCompare(b.displayName);

    const t1 = eligible.filter((p) => p.tier === 1).sort(sortByRelevance);
    const t2 = eligible.filter((p) => p.tier === 2).sort(sortByRelevance);
    const t3 = eligible.filter((p) => p.tier === 3).sort(sortByRelevance);

    // Distribution: 35% Tier 1, 45% Tier 2, 20% Tier 3
    const t1Count = Math.round(targetCount * 0.35);
    const t2Count = Math.round(targetCount * 0.45);
    const t3Count = Math.max(0, targetCount - t1Count - t2Count);

    const selectedT1 = t1.slice(0, t1Count);
    const selectedT2 = t2.slice(0, t2Count);
    const selectedT3 = t3.slice(0, t3Count);

    const selected = [...selectedT1, ...selectedT2, ...selectedT3];
    const selectedIds = new Set(selected.map((p) => p.publisherId));

    if (selected.length < targetCount) {
      const remaining = eligible
        .filter((p) => !selectedIds.has(p.publisherId))
        .sort((a, b) => a.tier - b.tier || sortByRelevance(a, b));
      selected.push(...remaining.slice(0, targetCount - selected.length));
    }

    return selected.slice(0, targetCount).map((record) => ({
      id: record.publisherId,
      displayName: record.displayName,
      rationale: record.notes || "Strong audience and contextual alignment with target parameters.",
    }));
  }

  return eligible
    .sort((a, b) => a.tier - b.tier || includesAny(context, [b.notes]) - includesAny(context, [a.notes]) || a.displayName.localeCompare(b.displayName))
    .slice(0, 4)
    .map((record) => ({
      id: record.publisherId,
      displayName: record.displayName,
      rationale: record.notes || "Recommended based on campaign channel profile.",
    }));
}

function attachEnhancements(product: MediaProductRecord, facts: CampaignFacts): AttachedPlanningRecord[] {
  const context = triggerText(facts);
  return facts.settings.enhancements
    .filter((record) => record.recommendationEligible && attachmentMatches(record.attachesTo, product) && includesAny(context, record.trigger.split(/[,;/]+|\s+/).filter((term) => term.length > 2)) > 0)
    .sort((a, b) => includesAny(context, b.trigger.split(/[,;/]+|\s+/)) - includesAny(context, a.trigger.split(/[,;/]+|\s+/)) || a.displayName.localeCompare(b.displayName))
    .slice(0, 2)
    .map((record) => ({
      id: record.enhancementId,
      displayName: record.displayName,
      rationale: `${record.trigger}. Format: ${record.formatType}.`,
      limitation: record.specificationNotes,
    }));
}

function attachInventory(product: MediaProductRecord, facts: CampaignFacts): AttachedPlanningRecord[] {
  const context = [triggerText(facts), ...facts.brandSafetyConstraints].join(" ");
  return planningKnowledgeBase.inventoryControls
    .filter((record) => {
      const recommendAs = String(record.metadata["Recommend As"] || "").toLowerCase();
      return attachmentMatches(record.attachesTo, product) && (recommendAs === "default-on" || includesAny(context, [record.trigger]) > 0);
    })
    .map(({ id, displayName, rationale }) => ({ id, displayName, rationale }));
}

function verticalAllowed(gate: string, vertical: string): boolean {
  const normalizedGate = gate.toLowerCase();
  if (!normalizedGate || normalizedGate === "none") return true;
  if (normalizedGate.includes("only")) return normalizedGate.includes(vertical.toLowerCase());
  if (normalizedGate.startsWith("avoid")) return !normalizedGate.includes(vertical.toLowerCase());
  return true;
}

// What each measurement product proves, keyed to the campaign signals that call for it. The
// workbook's triggers are sentences ("Client runs linear + CTV; is CTV incremental to linear?"),
// and ranking on whether the whole sentence appeared in the brief tied every product, so row
// order attached LeadMatch and MatchBack to every CTV, display and video line and CrossView to
// search and social. A product listed here with a 'requires' only attaches when the campaign
// shows that condition; 'serves' ranks it for the KPIs it measures.
const MEASUREMENT_FIT: Record<string, { requires?: (facts: CampaignFacts, context: string) => boolean; serves?: string[] }> = {
  "measurement.leadmatch": { requires: (_f, c) => includesAny(c, ["lead gen", "lead-gen", "leads", "lead quality", "form fill", "form submission", "qualified lead"]) > 0 },
  "measurement.matchback": {
    requires: (f, c) => f.dataReadiness.crmSeedList === true || f.dataReadiness.offlineSalesData === true || f.dataReadiness.leadOrRevenueExports === true || includesAny(c, ["crm", "point of sale", "pos data", "offline sales"]) > 0,
  },
  "measurement.crossview_linear_plus_ctv": {
    requires: (f, c) => f.existingChannelIds.some((id) => /linear/.test(id)) || f.requiredChannelIds.some((id) => /linear/.test(id)) || includesAny(c, ["linear tv", "linear television", "broadcast tv"]) > 0,
  },
  "measurement.firmographic_reporting_abm_octane11": { requires: (f) => f.audienceType === "B2B" || f.audienceType === "B2B2C" },
  "measurement.foot_traffic": { requires: (f) => includesAny([...f.kpis, f.primaryKpi].join(" "), ["store visit", "foot traffic", "in-store", "visits to store", "physical visit", "walk-in"]) > 0 },
  "measurement.in_store_sales_lift_pathformance": { requires: (f) => includesAny([...f.kpis, f.primaryKpi].join(" "), ["in-store sales", "store sales", "retail sales lift"]) > 0 },
  "measurement.consumer_panel_circana": { requires: (_f, c) => includesAny(c, ["cpg", "consumer packaged"]) > 0 },
  "measurement.cpg_sales_validation_circana_marketlift": { requires: (_f, c) => includesAny(c, ["cpg", "consumer packaged"]) > 0 },
  "measurement.online_booking_order_attribution": { serves: ["site visit", "online sale", "ecommerce", "e-commerce", "conversion", "purchase", "booking", "order", "traffic", "sign up", "signup", "subscription"] },
  "measurement.consumer_journey_analytics_opa": { serves: ["full-funnel", "full funnel", "conversion", "site visit"] },
  "measurement.reach_and_frequency": { serves: ["awareness", "reach", "frequency", "full-funnel", "full funnel"] },
  "measurement.brand_lift": { serves: ["awareness", "brand lift", "consideration", "perception"] },
  "measurement.incrementality": { serves: ["incremental", "lift", "causal"] },
  "measurement.halo_effect": { serves: ["search", "halo"] },
};

function measurementSettings(settings: PlanningSettings): Map<string, MeasurementPlanningSetting> {
  return new Map(mergeMeasurementSettings(settings?.measurement).map((row) => [row.measurementId, row]));
}

/** Data the brief says the client does not have, among what this product needs (Settings > Measurement). */
export function missingMeasurementData(setting: MeasurementPlanningSetting | undefined, facts: CampaignFacts): string[] {
  return (setting?.dataRequirements ?? []).filter((requirement) => facts.dataReadiness[requirement] === false);
}

export function measurementFitsCampaign(record: { id: string }, facts: CampaignFacts): boolean {
  if (missingMeasurementData(measurementSettings(facts.settings).get(record.id), facts).length > 0) return false;
  const requires = MEASUREMENT_FIT[record.id]?.requires;
  return requires ? requires(facts, triggerText(facts)) : true;
}

function measurementRelevance(record: { id: string; trigger: string }, facts: CampaignFacts, context: string): number {
  const goals = [...facts.kpis, facts.primaryKpi, ...facts.funnelStages].join(" ");
  const serves = MEASUREMENT_FIT[record.id]?.serves ?? [];
  // A KPI match outweighs any number of incidental trigger-phrase matches.
  return includesAny(goals, serves) * 10 + tacticRelevance(record.trigger, context);
}

function attachMeasurement(product: MediaProductRecord, facts: CampaignFacts): AttachedPlanningRecord[] {
  const context = triggerText(facts);
  const settings = measurementSettings(facts.settings);
  const eligible = planningKnowledgeBase.measurementCapabilities.filter((record) =>
    record.status === "live" &&
    settings.get(record.id)?.availability === "recommend" &&
    attachmentMatches(record.attachesTo, product) &&
    verticalAllowed(record.verticalGate, facts.vertical) &&
    measurementFitsCampaign(record, facts),
  );
  return eligible
    .sort((a, b) => measurementRelevance(b, facts, context) - measurementRelevance(a, facts, context))
    .slice(0, 2)
    .map(({ id, displayName, rationale, pricing, limitation }) => ({ id, displayName, rationale, pricing, limitation }));
}

export function buildMediaRecommendationPlan(
  facts: CampaignFacts,
  aiSignals: AiCandidateSignal[] = [],
): MediaRecommendationPlan {
  const allocationAudit: AllocationAuditEntry[] = [{ type: "mode", detail: `Planning mode: ${facts.planningMode}.` }];
  const nonMediaCosts = facts.existingPlacements
    .filter((placement) => {
      const raw = placement.mediaType || placement.productType || placement.placementName || placement.publisher || "";
      const canonical = normalizeRawChannel(raw).canonicalId;
      return isNonMediaItem(raw) || isNonMediaItem(canonical);
    })
    .map((placement, index) => ({
      id: `uploaded_non_media_${index + 1}`,
      displayName: placement.placementName || placement.mediaType || placement.productType || "Non-media line item",
      amount: Number(placement.budget) || 0,
      pricing: placement.pricingStructureDetails || placement.pricingStructureType || "Uploaded plan line item",
    }));
  const evaluatedCandidates = evaluateCandidates(facts, aiSignals);
  const selected = selectPortfolio(evaluatedCandidates, facts, allocationAudit);
  const requiredIds = new Set(facts.requiredChannelIds);
  const maximumCapacity = selected.reduce(
    (sum, candidate) => sum + allocationBoundsPercent(candidate.product, facts.totalWorkingMediaBudget, requiredIds.has(candidate.product.id)).maximum,
    0,
  );
  const minimumRequirement = selected.reduce(
    (sum, candidate) => sum + allocationBoundsPercent(candidate.product, facts.totalWorkingMediaBudget, requiredIds.has(candidate.product.id)).minimum,
    0,
  );
  const portfolioFeasible = selected.length > 0 && maximumCapacity >= 100 && minimumRequirement <= 100;
  if (selected.length > 0 && !portfolioFeasible) {
    allocationAudit.push({
      type: "exclusion",
      detail: `Selected portfolio cannot satisfy all allocation bounds (minimum ${minimumRequirement.toFixed(2)}%, maximum capacity ${maximumCapacity.toFixed(2)}%). No unvalidated allocation was returned.`,
    });
  }
  if (!portfolioFeasible) {
    return {
      catalogVersion: PLANNING_CATALOG_VERSION,
      settingsVersion: facts.settings.version,
      appliedBudgetTier: facts.appliedBudgetTier,
      normalized30DayBudget: facts.normalized30DayBudget,
      workingMediaBudget: facts.totalWorkingMediaBudget,
      flightDays: facts.campaignFlightDays,
      maxMediaTypes: facts.appliedBudgetTier.maxChannels,
      selectedMediaTypeCount: 0,
      planningMode: facts.planningMode,
      assumptions: facts.assumptions,
      channels: [],
      evaluatedCandidates,
      nonMediaCosts,
      allocationAudit,
    };
  }

  const basisPoints = allocateBasisPoints(selected, facts.totalWorkingMediaBudget, allocationAudit, new Set(facts.requiredChannelIds));
  const dollars = dollarsFromBasisPoints(facts.totalWorkingMediaBudget, basisPoints);
  allocationAudit.push({ type: "rounding", detail: "Applied stable basis-point rounding and distributed final budget cents deterministically." });

  const channels: ChannelPlanRecommendation[] = selected.map((candidate) => {
    const allocationDollars = dollars.get(candidate.product.id) || 0;
    const allocationPercent = (basisPoints.get(candidate.product.id) || 0) / 100;
    return {
      channelId: candidate.product.id,
      canonicalId: candidate.product.legacyCanonicalId,
      channelName: candidate.product.displayName,
      familyId: candidate.product.familyId,
      manuallyForced: facts.requiredChannelIds.includes(candidate.product.id),
      status: candidate.status === "ADD" ? "ADD" : "TEST",
      recommendationScore: candidate.recommendationScore,
      confidence: candidate.confidence,
      allocationPercent,
      allocationDollars,
      monthlyEquivalentSpend: facts.campaignFlightDays
        ? Math.round((allocationDollars / facts.campaignFlightDays) * 30 * 100) / 100
        : allocationDollars,
      role: candidate.product.funnelRoles.join(" / "),
      gapAddressed: candidate.gapAddressed,
      evidence: candidate.evidence,
      targetingTactics: candidate.targetingTactics,
      publishers: candidate.publishers,
      creativeEnhancements: candidate.creativeEnhancements,
      inventoryControls: candidate.inventoryControls,
      measurementCapabilities: candidate.measurementCapabilities,
      prerequisites: candidate.prerequisites,
      tradeoffs: candidate.tradeoffs,
      assumptions: facts.assumptions,
      allocationRationale: candidate.allocationRationale,
      decisionRule: candidate.decisionRule,
      minimumAllocationPercent: candidate.product.minimumAllocationPercent,
      maximumAllocationPercent: candidate.product.maximumAllocationPercent,
      minimumTotalSpend: candidate.product.minimumTotalSpend,
      typicalCpmLow: candidate.product.typicalCpmLow,
      typicalCpmHigh: candidate.product.typicalCpmHigh,
      fundingSource: facts.planningMode === "incremental"
        ? "Incremental working media budget"
        : facts.planningMode === "reallocation"
          ? "Reallocated uploaded-plan working media"
          : "New plan working media budget",
    };
  });

  return {
    catalogVersion: PLANNING_CATALOG_VERSION,
    settingsVersion: facts.settings.version,
    appliedBudgetTier: facts.appliedBudgetTier,
    normalized30DayBudget: facts.normalized30DayBudget,
    workingMediaBudget: facts.totalWorkingMediaBudget,
    flightDays: facts.campaignFlightDays,
    maxMediaTypes: facts.appliedBudgetTier.maxChannels,
    selectedMediaTypeCount: channels.length,
    planningMode: facts.planningMode,
    assumptions: facts.assumptions,
    channels,
    evaluatedCandidates,
    nonMediaCosts,
    allocationAudit,
  };
}

export function profileSignals(profile: AudienceProfile | null | undefined): { audienceDescriptions: string[]; audienceSignals: string[] } {
  if (!profile) return { audienceDescriptions: [], audienceSignals: [] };
  return {
    // The brief of record's business model is where retail partners are named ("sold through
    // Walmart, Chewy and Amazon"), which is what the retailer-data tactics check for.
    audienceDescriptions: [profile.briefOfRecord?.businessModel || "", profile.intro, profile.audienceAnalysis || "", profile.executiveSummary].filter(Boolean),
    audienceSignals: (profile.personas || []).flatMap((persona) => [persona.watch, persona.browse, persona.buy, persona.narrative]).filter(Boolean),
  };
}

export const CHANNEL_RECORD_TYPES = ["targetingTactics", "publishers", "creativeEnhancements", "inventoryControls", "measurementCapabilities"] as const;
export type ChannelRecordType = (typeof CHANNEL_RECORD_TYPES)[number];

/**
 * Every record a planner may attach to a media type: what the catalog marks as compatible with
 * the product and available to sell, without the campaign-fit ranking and caps the engine uses to
 * choose its defaults. A planner asking for a tactic overrides that ranking, as a manual channel
 * add overrides budget minimums; compatibility and availability are never overridden. CTV
 * publishers come from the plan's CTV publisher list instead, so none are offered here for CTV.
 */
export function channelRecordOptions(product: MediaProductRecord, settings: PlanningSettings): Record<ChannelRecordType, AttachedPlanningRecord[]> {
  const compatibleTactics = new Set(planningKnowledgeBase.compatibilityEdges
    .filter((edge) => edge.toId === product.id && edge.relationship === "compatible")
    .map((edge) => edge.fromId));
  return {
    targetingTactics: planningKnowledgeBase.targetingTactics
      .filter((record) => record.recommendationEligible && (compatibleTactics.has(record.id) || product.id === "channel.display_retargeting"))
      .map(({ id, displayName, rationale }) => ({ id, displayName, rationale })),
    publishers: isCtvOrPerformanceTvProduct(product)
      ? []
      : settings.publishers
        .filter((record) => record.recommendationEligible && attachmentMatches(record.attachesTo, product))
        .map((record) => ({ id: record.publisherId, displayName: record.displayName, rationale: record.notes || `${record.displayName} inventory for this media type.` })),
    creativeEnhancements: settings.enhancements
      .filter((record) => record.recommendationEligible && attachmentMatches(record.attachesTo, product))
      .map((record) => ({ id: record.enhancementId, displayName: record.displayName, rationale: `${record.trigger}. Format: ${record.formatType}.`, limitation: record.specificationNotes })),
    inventoryControls: planningKnowledgeBase.inventoryControls
      .filter((record) => attachmentMatches(record.attachesTo, product))
      .map(({ id, displayName, rationale }) => ({ id, displayName, rationale })),
    // "Manual add only" products stay offered here; only "Off" removes one.
    measurementCapabilities: planningKnowledgeBase.measurementCapabilities
      .filter((record) => record.status === "live" && (measurementSettings(settings).get(record.id)?.availability ?? "off") !== "off" && attachmentMatches(record.attachesTo, product))
      .map(({ id, displayName, rationale, pricing, limitation }) => ({ id, displayName, rationale, pricing, limitation })),
  };
}
