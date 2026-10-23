import type { CanonicalMediaType } from "../types";
import { planningKnowledgeBase } from "./knowledge/normalizeWorkbook";
import { DIGITAL_REMEDY_PRODUCT_REGISTRY } from "./knowledge/registry";
import {
  buildDefaultReachSettings,
  cloneReachSettings,
  mergeReachSettings,
  validateReachSettings,
  type ReachSettings,
} from "./reach/reachSettings";

export const PLANNING_SETTINGS_STORAGE_KEY = "scoutai_planning_settings";
export const PLANNING_SETTINGS_VERSION = 7 as const;
export const MAX_REASONABLE_MEDIA_TYPES = 50;

export type OverviewMetricId =
  | "budget"
  | "ecpm"
  | "impressions"
  | "completedViews"
  | "costPerView"
  | "estimatedReach"
  | "avgFrequency";

export interface OverviewMetricSetting {
  id: OverviewMetricId;
  label: string;
  show: boolean;
}

export const DEFAULT_OVERVIEW_METRICS: OverviewMetricSetting[] = [
  { id: "budget", label: "Planned Budget", show: true },
  { id: "ecpm", label: "Estimated ECPM", show: false },
  { id: "impressions", label: "Estimated Impressions", show: true },
  { id: "completedViews", label: "Completed Views", show: true },
  { id: "costPerView", label: "Cost Per View", show: false },
  { id: "estimatedReach", label: "Estimated Reach", show: true },
  { id: "avgFrequency", label: "Avg Monthly Frequency", show: false },
];

/**
 * Detail that is useful to the Digital Remedy team but noise (or worse, internal
 * pricing) in front of a client. Each one is a straight show/hide switch so the
 * same plan can be screen-shared either way without re-generating it.
 */
export type InternalOnlySettingId =
  | "channelAllocationColumn"
  | "channelDollarsColumn"
  | "channelScoreColumn"
  | "channelFitScores"
  | "channelEvidence"
  | "channelRecommendationsNotInPlan"
  | "channelUploadedLineItems"
  | "channelLinePricing"
  | "planAlignment"
  | "channelConfidenceBadge"
  | "channelStatusTag"
  | "planningAssumptions"
  | "qaAudit"
  | "reachCalculationDetails";

export interface InternalOnlySetting {
  id: InternalOnlySettingId;
  label: string;
  description: string;
  show: boolean;
}

export const DEFAULT_INTERNAL_ONLY_SETTINGS: InternalOnlySetting[] = [
  {
    id: "channelAllocationColumn",
    label: "Channel > Allocation Column",
    description: "The percentage of working media budget assigned to each media type.",
    show: true,
  },
  {
    id: "channelDollarsColumn",
    label: "Channel > Dollars Column",
    description: "The dollar value behind each media type's allocation percentage.",
    show: false,
  },
  {
    id: "channelScoreColumn",
    label: "Channel > Score Column",
    description: "The 0-100 recommendation score ScoutAI assigned to each media type.",
    show: true,
  },
  {
    id: "channelFitScores",
    label: "Channel > Audience Fit & Goal Match",
    description: "The 0-100 audience fit and goal match scores behind each media type's recommendation score.",
    show: true,
  },
  {
    id: "channelEvidence",
    label: "Channel > Evidence & Why",
    description: "The media consumption evidence and the reason each media type earns its spot, under its name.",
    show: true,
  },
  {
    id: "channelRecommendationsNotInPlan",
    label: "Channel > Recommendations Not In Plan (Share Link)",
    description: "On the share link: RFP media types this plan does not fund and the media types ScoutAI recommends adding, each with why.",
    show: true,
  },
  {
    id: "channelUploadedLineItems",
    label: "Channel > Uploaded Line Items",
    description: "The uploaded media plan's own lines (publisher, audience, impressions) under each media type that came from it.",
    show: true,
  },
  {
    id: "channelLinePricing",
    label: "Channel > Uploaded Line Pricing",
    description: "The pricing (e.g. CPM) on each uploaded line. Line dollars follow the Dollars Column switch.",
    show: false,
  },
  {
    id: "planAlignment",
    label: "Channel > How This Plan Reaches Your Audience",
    description: "On a plan used as is: which channels reach each persona and which funnel stages the plan covers. Planners also see what it leaves out.",
    show: true,
  },
  {
    id: "channelConfidenceBadge",
    label: "Channel > Confidence Badges",
    description: "The low/medium/high confidence pill shown beside each media type name.",
    show: false,
  },
  {
    id: "channelStatusTag",
    label: "Channel > Status Tags",
    description: "The ADD / TEST / DO_NOT_ADD recommendation tag shown beside each media type name.",
    show: false,
  },
  {
    id: "planningAssumptions",
    label: "Planning Assumptions Notes / Banners",
    description: "Informational notes and callout banners detailing flight normalization and media planning assumptions.",
    show: false,
  },
  {
    id: "qaAudit",
    label: "Programmatic Media Buyer QA Audit",
    description: "The QA Audit & Scoring Center scorecard, media planning score, and auto-remediation details at the bottom of the plan.",
    show: false,
  },
  {
    id: "reachCalculationDetails",
    label: "Overview > Reach Calculation Details",
    description: "The expandable breakdown under the overview metrics: household universe, per-media-type reach and the assumptions behind Est. Monthly Reach.",
    show: true,
  },
];

export interface BudgetChannelTier {
  minBudget: number;
  maxBudgetExclusive: number | null;
  maxChannels: number;
}

export type PlanningProductStatus = "live" | "beta" | "future" | "retired";

export interface ProductPlanningSetting {
  productId: string;
  displayName: string;
  /**
   * Master on/off. A disabled product is dropped from the effective registry entirely,
   * so it is never scored, never offered for manual add, and never sent to the reasoning
   * layer. This is deliberately stronger than `recommendationEligible`, which keeps the
   * product visible and manually addable while stopping ScoutAI from recommending it.
   */
  enabled: boolean;
  digitalRemedyExecutable: boolean;
  status: PlanningProductStatus;
  recommendationEligible: boolean;
  supportedGeographies: string[];
  typicalCpmLow: number | null;
  typicalCpmHigh: number | null;
  minimumTotalSpend: number;
  minimumNormalized30DaySpend: number;
  minimumFlightDays: number;
  minimumAllocationPercent: number;
  maximumAllocationPercent: number;
}

/**
 * A media type added by an admin that is not in the Digital Remedy workbook registry.
 *
 * The planning fields mirror ProductPlanningSetting so the engine can treat a custom
 * product exactly like a registry one. The block below them is what makes the product
 * legible to the reasoning layer: the model only ever sees the candidate list we hand
 * it, so a custom product with empty funnel roles / KPIs / signals would be scored
 * blind and never earn a slot.
 */
export interface CustomProductSetting {
  productId: string;
  displayName: string;
  enabled: boolean;
  digitalRemedyExecutable: boolean;
  status: PlanningProductStatus;
  recommendationEligible: boolean;
  supportedGeographies: string[];
  typicalCpmLow: number | null;
  typicalCpmHigh: number | null;
  minimumTotalSpend: number;
  minimumNormalized30DaySpend: number;
  minimumFlightDays: number;
  minimumAllocationPercent: number;
  maximumAllocationPercent: number;
  /** Closest entry in the closed canonical taxonomy, so uploaded-plan parsing still maps. */
  canonicalId: CanonicalMediaType;
  aliases: string[];
  funnelRoles: string[];
  supportedKpis: string[];
  audienceSignals: string[];
  /** Free text handed to the reasoning layer verbatim, for nuance a keyword list cannot carry. */
  planningNotes: string;
}

export const CUSTOM_PRODUCT_ID_PREFIX = "custom.";

export interface PublisherPlanningSetting {
  publisherId: string;
  displayName: string;
  attachesTo: string[];
  tier: number;
  recommendationEligible: boolean;
  notes: string;
}

export interface EnhancementPlanningSetting {
  enhancementId: string;
  displayName: string;
  attachesTo: string[];
  recommendationEligible: boolean;
  trigger: string;
  formatType: string;
  specificationNotes: string;
}

/**
 * "recommend": ScoutAI may attach it when the campaign fits. "manual": never recommended, but a
 * planner can still add it to a media type. "off": gone from plans and from the manual-add list.
 */
export type MeasurementAvailability = "recommend" | "manual" | "off";
export const MEASUREMENT_AVAILABILITIES: MeasurementAvailability[] = ["recommend", "manual", "off"];

/** Client data a measurement product cannot report without. Keys of DataReadinessFacts. */
export type MeasurementDataRequirement =
  | "sitePixel"
  | "conversionEvents"
  | "crmSeedList"
  | "leadOrRevenueExports"
  | "offlineSalesData"
  | "locationData"
  | "productFeed";

export const MEASUREMENT_DATA_REQUIREMENTS: Array<{ id: MeasurementDataRequirement; label: string; description: string }> = [
  { id: "sitePixel", label: "Site pixel", description: "The client can place a tracking pixel on their site." },
  { id: "conversionEvents", label: "Conversion tracking", description: "Lower-funnel site actions (purchases, forms, bookings) can be tracked." },
  { id: "crmSeedList", label: "CRM / customer list", description: "The client can share a customer or CRM list." },
  { id: "leadOrRevenueExports", label: "Lead or revenue export", description: "The client can send recurring lead or revenue exports from their CRM." },
  { id: "offlineSalesData", label: "Offline sales data", description: "Point-of-sale or offline transaction data is available." },
  { id: "locationData", label: "Physical locations", description: "The client has stores, venues or other physical locations to measure visits to." },
  { id: "productFeed", label: "Product feed", description: "A product or SKU feed is available." },
];

export interface MeasurementPlanningSetting {
  measurementId: string;
  /** From the workbook; shown for reference, not editable. */
  displayName: string;
  availability: MeasurementAvailability;
  /**
   * When the brief says the client lacks any of these ("cannot place pixels"), ScoutAI does not
   * recommend the product. Unknown does not block: most briefs say nothing about data.
   */
  dataRequirements: MeasurementDataRequirement[];
}

export interface PlanningSettings {
  version: typeof PLANNING_SETTINGS_VERSION;
  overviewMetrics: OverviewMetricSetting[];
  internalOnly: InternalOnlySetting[];
  budgetChannelTiers: BudgetChannelTier[];
  products: ProductPlanningSetting[];
  customProducts: CustomProductSetting[];
  publishers: PublisherPlanningSetting[];
  enhancements: EnhancementPlanningSetting[];
  /** Target number of recommended CTV publishers (range 1-30, default 8). */
  ctvPublisherTargetCount?: number;
  /** CTV Publisher target percentage for Tier 1 (SVOD / Live Sports, default 35). */
  ctvTier1TargetPercent?: number;
  /** CTV Publisher target percentage for Tier 2 (Linear / Broadcast / Targeted, default 45). */
  ctvTier2TargetPercent?: number;
  /** CTV Publisher target percentage for Tier 3 (FAST / Device OS, default 20). */
  ctvTier3TargetPercent?: number;
  /** Assumptions behind Est. Monthly Reach and Avg Monthly Frequency. See src/planning/reach. */
  reach: ReachSettings;
  /** One row per live workbook measurement product. See mergeMeasurementSettings. */
  measurement: MeasurementPlanningSetting[];
}

export interface SettingsValidationResult {
  valid: boolean;
  errors: string[];
  settings?: PlanningSettings;
}

export interface BudgetNormalizationResult {
  workingMediaBudget: number;
  campaignFlightDays: number | null;
  normalized30DayBudget: number;
  assumptions: string[];
}

const DEFAULT_TIERS: BudgetChannelTier[] = [
  { minBudget: 0, maxBudgetExclusive: 5_000, maxChannels: 1 },
  { minBudget: 5_000, maxBudgetExclusive: 10_000, maxChannels: 3 },
  { minBudget: 10_000, maxBudgetExclusive: 25_000, maxChannels: 4 },
  { minBudget: 25_000, maxBudgetExclusive: 50_000, maxChannels: 5 },
  { minBudget: 50_000, maxBudgetExclusive: 100_000, maxChannels: 6 },
  { minBudget: 100_000, maxBudgetExclusive: 500_000, maxChannels: 8 },
  { minBudget: 500_000, maxBudgetExclusive: null, maxChannels: 10 },
];

function inferPublisherTier(notes: string): number {
  const normalized = notes.toLowerCase();
  if (normalized.includes("as often as possible")) return 1;
  if (normalized.includes("include often")) return 2;
  if (normalized.includes("include for")) return 3;
  return 2;
}

function inferEnhancementFormat(name: string, attachesTo: string[]): string {
  const context = `${name} ${attachesTo.join(" ")}`.toLowerCase();
  if (context.includes("ctv") || context.includes("pre-roll") || context.includes("video")) return "Interactive video / VAST-compatible unit";
  if (context.includes("audio")) return "Interactive or companion digital audio unit";
  if (context.includes("social")) return "Paid social enhancement";
  if (context.includes("dooh") || context.includes("out-of-home")) return "Digital out-of-home enhancement";
  if (context.includes("native")) return "Native content enhancement";
  return "High-impact HTML5 display / mobile unit";
}

function inferEnhancementTrigger(name: string, attachesTo: string[]): string {
  const context = `${name} ${attachesTo.join(" ")}`.toLowerCase();
  if (/wallet|shop|store|commerce|purchase|coupon/.test(context)) return "conversion engagement consideration sales";
  if (/interactive|expand|cube|game|quiz|play|swipe|carousel|deck/.test(context)) return "engagement consideration interaction";
  if (/ctv|video|pre-roll/.test(context)) return "awareness reach video completion engagement";
  return "awareness engagement consideration";
}

function inferEnhancementChannels(name: string, attachesTo: string[]): string[] {
  if (attachesTo.length > 0) return [...attachesTo];
  const normalized = name.toLowerCase();
  if (normalized.includes("gumgum")) return ["Display"];
  if (normalized.includes("ctv")) return ["CTV", "OTT"];
  if (normalized.includes("video")) return ["Online Video"];
  return ["Any Channel"];
}

// Starting requirements, from each product's outcome source in the workbook: anything that reads
// conversions off the client's site needs a pixel, and the rest need the data they match against.
const DEFAULT_MEASUREMENT_REQUIREMENTS: Record<string, MeasurementDataRequirement[]> = {
  "measurement.leadmatch": ["sitePixel", "conversionEvents", "leadOrRevenueExports"],
  "measurement.online_booking_order_attribution": ["sitePixel", "conversionEvents"],
  "measurement.consumer_journey_analytics_opa": ["sitePixel", "conversionEvents"],
  "measurement.halo_effect": ["sitePixel"],
  "measurement.foot_traffic": ["locationData"],
};

function defaultMeasurementSettings(): MeasurementPlanningSetting[] {
  return planningKnowledgeBase.measurementCapabilities
    .filter((record) => record.status === "live")
    .map((record) => ({
      measurementId: record.id,
      displayName: record.displayName,
      availability: record.recommendationEligible ? "recommend" : "manual",
      dataRequirements: [...(DEFAULT_MEASUREMENT_REQUIREMENTS[record.id] || [])],
    }));
}

/**
 * The workbook owns which measurement products exist; settings own how they are used. Stored rows
 * are matched to the catalog by id, so a product added to the workbook appears with its defaults
 * and one retired from it drops out, without a migration each time.
 */
export function mergeMeasurementSettings(stored: unknown): MeasurementPlanningSetting[] {
  const rows = Array.isArray(stored) ? stored.filter((row) => row && typeof row === "object") as Array<Partial<MeasurementPlanningSetting>> : [];
  const byId = new Map(rows.map((row) => [row.measurementId, row]));
  const knownRequirements = new Set(MEASUREMENT_DATA_REQUIREMENTS.map((requirement) => requirement.id));
  return defaultMeasurementSettings().map((def) => {
    const row = byId.get(def.measurementId);
    if (!row) return def;
    return {
      ...def,
      availability: MEASUREMENT_AVAILABILITIES.includes(row.availability as MeasurementAvailability) ? row.availability as MeasurementAvailability : def.availability,
      dataRequirements: Array.isArray(row.dataRequirements)
        ? [...new Set(row.dataRequirements.filter((id) => knownRequirements.has(id)))]
        : def.dataRequirements,
    };
  });
}

function buildDefaultSettings(): PlanningSettings {
  return {
    version: PLANNING_SETTINGS_VERSION,
    overviewMetrics: DEFAULT_OVERVIEW_METRICS.map((metric) => ({ ...metric })),
    internalOnly: DEFAULT_INTERNAL_ONLY_SETTINGS.map((setting) => ({ ...setting })),
    budgetChannelTiers: DEFAULT_TIERS.map((tier) => ({ ...tier })),
    products: DIGITAL_REMEDY_PRODUCT_REGISTRY.map((product) => ({
      productId: product.id,
      displayName: product.displayName,
      enabled: true,
      digitalRemedyExecutable: product.digitalRemedyExecutable,
      status: product.status,
      recommendationEligible: product.recommendationEligible,
      supportedGeographies: ["United States"],
      typicalCpmLow: product.typicalCpmLow,
      typicalCpmHigh: product.typicalCpmHigh,
      minimumTotalSpend: product.minimumTotalSpend,
      minimumNormalized30DaySpend: product.minimumNormalized30DaySpend,
      minimumFlightDays: product.minimumFlightDays,
      minimumAllocationPercent: product.minimumAllocationPercent,
      maximumAllocationPercent: product.maximumAllocationPercent,
    })),
    customProducts: [],
    publishers: planningKnowledgeBase.publishers.map((publisher) => ({
      publisherId: publisher.id,
      displayName: publisher.displayName,
      attachesTo: [...publisher.attachesTo],
      tier: inferPublisherTier(publisher.trigger),
      recommendationEligible: publisher.recommendationEligible,
      notes: publisher.trigger || "Workbook-approved publisher; validate audience fit before activation.",
    })),
    enhancements: planningKnowledgeBase.creativeEnhancements
      .filter((enhancement) => !enhancement.displayName.toLowerCase().startsWith("high impact units ="))
      .map((enhancement) => {
        const attachesTo = inferEnhancementChannels(enhancement.displayName, enhancement.attachesTo);
        return {
          enhancementId: enhancement.id,
          displayName: enhancement.displayName,
          attachesTo,
          recommendationEligible: true,
          trigger: enhancement.trigger || inferEnhancementTrigger(enhancement.displayName, attachesTo),
          formatType: String(enhancement.metadata["Format Type"] || "").trim() || inferEnhancementFormat(enhancement.displayName, attachesTo),
          specificationNotes: String(enhancement.metadata["Spec / Vendor Notes"] || "").trim() || "Best-guess starting specification: confirm dimensions, file weight, duration, click behavior, tracking, accessibility, production lead time, and final QA requirements with the selected vendor before launch.",
        };
      }),
    ctvPublisherTargetCount: 8,
    ctvTier1TargetPercent: 35,
    ctvTier2TargetPercent: 45,
    ctvTier3TargetPercent: 20,
    reach: buildDefaultReachSettings(),
    measurement: defaultMeasurementSettings(),
  };
}

export const DEFAULT_PLANNING_SETTINGS: PlanningSettings = buildDefaultSettings();

export function clonePlanningSettings(settings: PlanningSettings): PlanningSettings {
  if (!settings) return buildDefaultSettings();

  const rawInternalOnly = Array.isArray(settings.internalOnly) ? settings.internalOnly : [];
  const internalMap = new Map(rawInternalOnly.filter((s) => s && typeof s === "object").map((item) => [item.id, item]));
  const internalOnly = DEFAULT_INTERNAL_ONLY_SETTINGS.map((def) => {
    const existing = internalMap.get(def.id);
    return existing ? { ...def, ...existing } : { ...def };
  });

  const rawMetrics = Array.isArray(settings.overviewMetrics) ? settings.overviewMetrics : [];
  const metricsMap = new Map(rawMetrics.filter((m) => m && typeof m === "object").map((item) => [item.id, item]));
  const overviewMetrics = DEFAULT_OVERVIEW_METRICS.map((def) => {
    const existing = metricsMap.get(def.id);
    return existing ? { ...def, ...existing, label: def.label } : { ...def };
  });

  return {
    version: settings.version || PLANNING_SETTINGS_VERSION,
    overviewMetrics,
    internalOnly,
    budgetChannelTiers: (settings.budgetChannelTiers || []).map((tier) => ({ ...tier })),
    products: (settings.products || []).map((product) => ({
      ...product,
      supportedGeographies: [...(product.supportedGeographies || [])],
    })),
    customProducts: (settings.customProducts || []).map((product) => ({
      ...product,
      supportedGeographies: [...(product.supportedGeographies || [])],
      aliases: [...(product.aliases || [])],
      funnelRoles: [...(product.funnelRoles || [])],
      supportedKpis: [...(product.supportedKpis || [])],
      audienceSignals: [...(product.audienceSignals || [])],
    })),
    publishers: (settings.publishers || []).map((publisher) => ({
      ...publisher,
      attachesTo: [...(publisher.attachesTo || [])],
    })),
    enhancements: (settings.enhancements || []).map((enhancement) => ({
      ...enhancement,
      attachesTo: [...(enhancement.attachesTo || [])],
    })),
    ctvPublisherTargetCount: typeof settings.ctvPublisherTargetCount === "number" && Number.isFinite(settings.ctvPublisherTargetCount)
      ? Math.max(1, Math.min(30, Math.round(settings.ctvPublisherTargetCount)))
      : 8,
    ctvTier1TargetPercent: typeof settings.ctvTier1TargetPercent === "number" && Number.isFinite(settings.ctvTier1TargetPercent)
      ? Math.max(0, Math.min(100, Math.round(settings.ctvTier1TargetPercent)))
      : 35,
    ctvTier2TargetPercent: typeof settings.ctvTier2TargetPercent === "number" && Number.isFinite(settings.ctvTier2TargetPercent)
      ? Math.max(0, Math.min(100, Math.round(settings.ctvTier2TargetPercent)))
      : 45,
    ctvTier3TargetPercent: typeof settings.ctvTier3TargetPercent === "number" && Number.isFinite(settings.ctvTier3TargetPercent)
      ? Math.max(0, Math.min(100, Math.round(settings.ctvTier3TargetPercent)))
      : 20,
    reach: settings.reach ? cloneReachSettings(mergeReachSettings(settings.reach)) : buildDefaultReachSettings(),
    measurement: mergeMeasurementSettings(settings.measurement),
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nullableNonNegative(value: unknown): value is number | null {
  return value === null || (isFiniteNumber(value) && value >= 0);
}

function nonEmptyStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === "string" && entry.trim().length > 0);
}

function uniqueIds<T>(items: T[], id: (item: T) => string, label: string, errors: string[]): void {
  const seen = new Set<string>();
  items.forEach((item) => {
    const value = id(item);
    if (!value) errors.push(`${label} ID is required.`);
    else if (seen.has(value)) errors.push(`Duplicate ${label.toLowerCase()} ID: ${value}.`);
    seen.add(value);
  });
}

export function validatePlanningSettings(value: unknown): SettingsValidationResult {
  const errors: string[] = [];
  if (!value || typeof value !== "object") return { valid: false, errors: ["Settings must be an object."] };
  const candidate = value as Partial<PlanningSettings>;
  if (candidate.version !== PLANNING_SETTINGS_VERSION) errors.push(`Unsupported settings version. Expected version ${PLANNING_SETTINGS_VERSION}.`);
  const overviewMetrics = Array.isArray(candidate.overviewMetrics) ? candidate.overviewMetrics.map((metric) => ({ ...metric })) : [];
  const expectedOverviewMetricIds = new Set(DEFAULT_OVERVIEW_METRICS.map((metric) => metric.id));
  if (overviewMetrics.length !== DEFAULT_OVERVIEW_METRICS.length) {
    errors.push(`Overview settings must include all ${DEFAULT_OVERVIEW_METRICS.length} metrics.`);
  }
  uniqueIds(overviewMetrics, (metric) => metric.id, "Overview metric", errors);
  overviewMetrics.forEach((metric) => {
    if (!expectedOverviewMetricIds.has(metric.id)) errors.push(`Unknown overview metric ID: ${metric.id}.`);
    if (!metric.label?.trim()) errors.push(`${metric.id || "Overview metric"} requires a label.`);
    if (typeof metric.show !== "boolean") errors.push(`${metric.label || metric.id || "Overview metric"} Show must be true or false.`);
  });
  const internalOnly = Array.isArray(candidate.internalOnly) ? candidate.internalOnly.map((setting) => ({ ...setting })) : [];
  const expectedInternalOnlyIds = new Set(DEFAULT_INTERNAL_ONLY_SETTINGS.map((setting) => setting.id));
  if (internalOnly.length !== DEFAULT_INTERNAL_ONLY_SETTINGS.length) {
    errors.push(`Visibility settings must include all ${DEFAULT_INTERNAL_ONLY_SETTINGS.length} internal-only toggles.`);
  }
  uniqueIds(internalOnly, (setting) => setting.id, "Internal-only setting", errors);
  internalOnly.forEach((setting) => {
    if (!expectedInternalOnlyIds.has(setting.id)) errors.push(`Unknown internal-only setting ID: ${setting.id}.`);
    if (!setting.label?.trim()) errors.push(`${setting.id || "Internal-only setting"} requires a label.`);
    if (typeof setting.show !== "boolean") errors.push(`${setting.label || setting.id || "Internal-only setting"} Show must be true or false.`);
  });
  if (!Array.isArray(candidate.budgetChannelTiers) || candidate.budgetChannelTiers.length === 0) {
    errors.push("At least one budget tier is required.");
    return { valid: false, errors };
  }

  const tiers = candidate.budgetChannelTiers.map((tier) => ({ ...tier })).sort((a, b) => Number(a.minBudget) - Number(b.minBudget));
  tiers.forEach((tier, index) => {
    const label = `Tier ${index + 1}`;
    if (!isFiniteNumber(tier.minBudget) || tier.minBudget < 0) errors.push(`${label} minimum budget must be a non-negative number.`);
    if (tier.maxBudgetExclusive !== null && (!isFiniteNumber(tier.maxBudgetExclusive) || tier.maxBudgetExclusive < 0)) errors.push(`${label} maximum budget must be a non-negative number or left open-ended.`);
    if (isFiniteNumber(tier.minBudget) && isFiniteNumber(tier.maxBudgetExclusive) && tier.maxBudgetExclusive <= tier.minBudget) errors.push(`${label} maximum budget must be greater than its minimum.`);
    if (!isFiniteNumber(tier.maxChannels) || !Number.isInteger(tier.maxChannels) || tier.maxChannels < 1 || tier.maxChannels > MAX_REASONABLE_MEDIA_TYPES) errors.push(`${label} media-type cap must be a whole number from 1 to ${MAX_REASONABLE_MEDIA_TYPES}.`);
    if (tier.maxBudgetExclusive === null && index !== tiers.length - 1) errors.push(`${label} is open-ended but is not the final tier.`);
  });
  if (tiers[0]?.minBudget !== 0) errors.push("The first tier must begin at $0.");
  const openEndedCount = tiers.filter((tier) => tier.maxBudgetExclusive === null).length;
  if (openEndedCount !== 1 || tiers[tiers.length - 1]?.maxBudgetExclusive !== null) errors.push("Exactly one open-ended tier is required, and it must be last.");
  for (let index = 1; index < tiers.length; index += 1) {
    const previous = tiers[index - 1];
    const current = tiers[index];
    if (!isFiniteNumber(previous.maxBudgetExclusive) || !isFiniteNumber(current.minBudget)) continue;
    if (previous.maxBudgetExclusive < current.minBudget) errors.push(`There is a gap between tiers ${index} and ${index + 1}.`);
    else if (previous.maxBudgetExclusive > current.minBudget) errors.push(`Tiers ${index} and ${index + 1} overlap.`);
  }

  const products = Array.isArray(candidate.products) ? candidate.products.map((product) => ({ ...product, supportedGeographies: [...(product.supportedGeographies || [])] })) : [];
  if (products.length === 0) errors.push("At least one Digital Remedy product is required.");
  uniqueIds(products, (product) => product.productId, "Product", errors);
  products.forEach((product) => {
    const label = product.displayName || product.productId || "Product";
    if (!product.displayName?.trim()) errors.push(`${label} display name is required.`);
    if (!["live", "beta", "future", "retired"].includes(product.status)) errors.push(`${label} has an invalid status.`);
    if (typeof product.digitalRemedyExecutable !== "boolean" || typeof product.recommendationEligible !== "boolean") errors.push(`${label} availability must be true or false.`);
    if (typeof product.enabled !== "boolean") errors.push(`${label} Show must be true or false.`);
    if (!nonEmptyStrings(product.supportedGeographies)) errors.push(`${label} requires at least one geography.`);
    if (!nullableNonNegative(product.typicalCpmLow) || !nullableNonNegative(product.typicalCpmHigh)) errors.push(`${label} CPM values must be non-negative or blank.`);
    if (isFiniteNumber(product.typicalCpmLow) && isFiniteNumber(product.typicalCpmHigh) && product.typicalCpmHigh < product.typicalCpmLow) errors.push(`${label} maximum CPM must be at least the minimum CPM.`);
    if (![product.minimumTotalSpend, product.minimumNormalized30DaySpend, product.minimumFlightDays].every((entry) => isFiniteNumber(entry) && entry >= 0)) errors.push(`${label} minimums must be non-negative numbers.`);
    if (!Number.isInteger(product.minimumFlightDays) || product.minimumFlightDays < 1) errors.push(`${label} minimum flight must be a positive whole number of days.`);
    if (![product.minimumAllocationPercent, product.maximumAllocationPercent].every((entry) => isFiniteNumber(entry) && entry >= 0 && entry <= 100)) errors.push(`${label} allocation bounds must be between 0% and 100%.`);
    if (isFiniteNumber(product.minimumAllocationPercent) && isFiniteNumber(product.maximumAllocationPercent) && product.maximumAllocationPercent < product.minimumAllocationPercent) errors.push(`${label} maximum allocation must be at least its minimum allocation.`);
  });

  const customProducts = Array.isArray(candidate.customProducts)
    ? candidate.customProducts.map((product) => ({
        ...product,
        supportedGeographies: [...(product.supportedGeographies || [])],
        aliases: [...(product.aliases || [])],
        funnelRoles: [...(product.funnelRoles || [])],
        supportedKpis: [...(product.supportedKpis || [])],
        audienceSignals: [...(product.audienceSignals || [])],
      }))
    : [];
  uniqueIds(customProducts, (product) => product.productId, "Custom media type", errors);
  const registryProductIds = new Set(products.map((product) => product.productId));
  customProducts.forEach((product) => {
    const label = product.displayName || product.productId || "Custom media type";
    // The prefix is what every other layer uses to tell a custom product from a
    // workbook one, so it is enforced here rather than assumed.
    if (!product.productId?.startsWith(CUSTOM_PRODUCT_ID_PREFIX)) errors.push(`${label} ID must start with "${CUSTOM_PRODUCT_ID_PREFIX}".`);
    if (registryProductIds.has(product.productId)) errors.push(`${label} ID collides with a Digital Remedy registry product.`);
    if (!product.displayName?.trim()) errors.push(`${label} display name is required.`);
    if (!product.canonicalId?.trim()) errors.push(`${label} requires a closest-match media type.`);
    if (!["live", "beta", "future", "retired"].includes(product.status)) errors.push(`${label} has an invalid status.`);
    if (typeof product.enabled !== "boolean" || typeof product.digitalRemedyExecutable !== "boolean" || typeof product.recommendationEligible !== "boolean") errors.push(`${label} availability must be true or false.`);
    if (!nonEmptyStrings(product.supportedGeographies)) errors.push(`${label} requires at least one geography.`);
    // Without these the reasoning layer has nothing to score the product on.
    if (!nonEmptyStrings(product.funnelRoles)) errors.push(`${label} requires at least one funnel role.`);
    if (!nonEmptyStrings(product.supportedKpis)) errors.push(`${label} requires at least one supported KPI.`);
    if (!nullableNonNegative(product.typicalCpmLow) || !nullableNonNegative(product.typicalCpmHigh)) errors.push(`${label} CPM values must be non-negative or blank.`);
    if (isFiniteNumber(product.typicalCpmLow) && isFiniteNumber(product.typicalCpmHigh) && product.typicalCpmHigh < product.typicalCpmLow) errors.push(`${label} maximum CPM must be at least the minimum CPM.`);
    if (![product.minimumTotalSpend, product.minimumNormalized30DaySpend, product.minimumFlightDays].every((entry) => isFiniteNumber(entry) && entry >= 0)) errors.push(`${label} minimums must be non-negative numbers.`);
    if (!Number.isInteger(product.minimumFlightDays) || product.minimumFlightDays < 1) errors.push(`${label} minimum flight must be a positive whole number of days.`);
    if (![product.minimumAllocationPercent, product.maximumAllocationPercent].every((entry) => isFiniteNumber(entry) && entry >= 0 && entry <= 100)) errors.push(`${label} allocation bounds must be between 0% and 100%.`);
    if (isFiniteNumber(product.minimumAllocationPercent) && isFiniteNumber(product.maximumAllocationPercent) && product.maximumAllocationPercent < product.minimumAllocationPercent) errors.push(`${label} maximum allocation must be at least its minimum allocation.`);
  });

  const publishers = Array.isArray(candidate.publishers) ? candidate.publishers.map((publisher) => ({ ...publisher, attachesTo: [...(publisher.attachesTo || [])] })) : [];
  if (publishers.length === 0) errors.push("At least one publisher is required.");
  uniqueIds(publishers, (publisher) => publisher.publisherId, "Publisher", errors);
  publishers.forEach((publisher) => {
    const label = publisher.displayName || publisher.publisherId || "Publisher";
    if (!publisher.displayName?.trim() || !nonEmptyStrings(publisher.attachesTo)) errors.push(`${label} requires a name and at least one channel.`);
    if (!Number.isInteger(publisher.tier) || publisher.tier < 1 || publisher.tier > 4) errors.push(`${label} tier must be a whole number from 1 to 4.`);
    if (typeof publisher.recommendationEligible !== "boolean") errors.push(`${label} availability must be true or false.`);
  });

  const enhancements = Array.isArray(candidate.enhancements) ? candidate.enhancements.map((enhancement) => ({ ...enhancement, attachesTo: [...(enhancement.attachesTo || [])] })) : [];
  if (enhancements.length === 0) errors.push("At least one creative enhancement is required.");
  uniqueIds(enhancements, (enhancement) => enhancement.enhancementId, "Enhancement", errors);
  enhancements.forEach((enhancement) => {
    const label = enhancement.displayName || enhancement.enhancementId || "Enhancement";
    if (!enhancement.displayName?.trim() || !nonEmptyStrings(enhancement.attachesTo)) errors.push(`${label} requires a name and at least one channel.`);
    if (!enhancement.trigger?.trim() || !enhancement.formatType?.trim() || !enhancement.specificationNotes?.trim()) errors.push(`${label} requires a trigger, format type, and specification notes.`);
    if (typeof enhancement.recommendationEligible !== "boolean") errors.push(`${label} availability must be true or false.`);
  });

  const ctvPublisherTargetCount = typeof candidate.ctvPublisherTargetCount === "number" && Number.isFinite(candidate.ctvPublisherTargetCount)
    ? Math.max(1, Math.min(30, Math.round(candidate.ctvPublisherTargetCount)))
    : 8;

  const ctvTier1TargetPercent = typeof candidate.ctvTier1TargetPercent === "number" && Number.isFinite(candidate.ctvTier1TargetPercent)
    ? Math.max(0, Math.min(100, Math.round(candidate.ctvTier1TargetPercent)))
    : 35;
  const ctvTier2TargetPercent = typeof candidate.ctvTier2TargetPercent === "number" && Number.isFinite(candidate.ctvTier2TargetPercent)
    ? Math.max(0, Math.min(100, Math.round(candidate.ctvTier2TargetPercent)))
    : 45;
  const ctvTier3TargetPercent = typeof candidate.ctvTier3TargetPercent === "number" && Number.isFinite(candidate.ctvTier3TargetPercent)
    ? Math.max(0, Math.min(100, Math.round(candidate.ctvTier3TargetPercent)))
    : 20;

  const reach = mergeReachSettings(candidate.reach);
  if (candidate.reach) validateReachSettings(reach, errors);
  else errors.push("Reach settings are required.");

  if (!Array.isArray(candidate.measurement)) errors.push("Measurement settings are required.");
  else {
    candidate.measurement.forEach((row) => {
      const label = row?.displayName || row?.measurementId || "Measurement product";
      if (!MEASUREMENT_AVAILABILITIES.includes(row?.availability)) errors.push(`${label} availability must be Recommend, Manual add only, or Off.`);
      if (!Array.isArray(row?.dataRequirements)) errors.push(`${label} data requirements must be a list.`);
    });
  }
  const measurement = mergeMeasurementSettings(candidate.measurement);

  if (errors.length > 0) return { valid: false, errors };
  return {
    valid: true,
    errors: [],
    settings: {
      version: PLANNING_SETTINGS_VERSION,
      overviewMetrics,
      internalOnly,
      budgetChannelTiers: tiers,
      products,
      customProducts,
      publishers,
      enhancements,
      ctvPublisherTargetCount,
      ctvTier1TargetPercent,
      ctvTier2TargetPercent,
      ctvTier3TargetPercent,
      reach,
      measurement,
    },
  };
}

/**
 * Every stored settings record passes through here before validation, including the
 * server-side ones. A record that fails validation is reseeded from defaults, so an
 * unmigrated record would silently discard the team's shared catalog edits.
 */
export function migrateStoredSettings(value: unknown, defaults: PlanningSettings = DEFAULT_PLANNING_SETTINGS): unknown {
  if (!value || typeof value !== "object") return clonePlanningSettings(defaults);
  return withVersion7Defaults(withVersion6Defaults(migrateToVersion5Shape(value, defaults)));
}

/**
 * Version 7 made measurement products configurable. Older records get the workbook's live
 * products with their default data requirements, which is what the engine applied before.
 */
function withVersion7Defaults(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const stored = value as Record<string, unknown>;
  return { ...stored, version: PLANNING_SETTINGS_VERSION, measurement: mergeMeasurementSettings(stored.measurement) };
}

/**
 * Version 6 added the reach assumptions. Every older record predates them, so each one gets
 * the defaults Media Planning signed off on; a version 6 record keeps its edits and only
 * gains rows for media types added since.
 */
function withVersion6Defaults(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const stored = value as Record<string, unknown>;
  return { ...stored, version: PLANNING_SETTINGS_VERSION, reach: mergeReachSettings(stored.reach) };
}

function migrateToVersion5Shape(value: object, defaults: PlanningSettings): unknown {
  const stored = value as Record<string, unknown> & { version?: number; budgetChannelTiers?: BudgetChannelTier[] };
  if (stored.version === 1 && Array.isArray(stored.budgetChannelTiers)) {
    return { ...clonePlanningSettings(defaults), budgetChannelTiers: stored.budgetChannelTiers.map((tier) => ({ ...tier })) };
  }
  if (stored.version === 2) {
    return withMergedInternalOnly(withMergedOverviewMetrics(withVersion5Defaults({
      ...stored,
      overviewMetrics: DEFAULT_OVERVIEW_METRICS.map((metric) => ({ ...metric })),
      internalOnly: DEFAULT_INTERNAL_ONLY_SETTINGS.map((setting) => ({ ...setting })),
    }) as Record<string, unknown>));
  }
  if (stored.version === 3) {
    return withMergedInternalOnly(withMergedOverviewMetrics(withVersion5Defaults({
      ...stored,
      internalOnly: DEFAULT_INTERNAL_ONLY_SETTINGS.map((setting) => ({ ...setting })),
    }) as Record<string, unknown>));
  }
  if (stored.version === 4) {
    return withMergedInternalOnly(withMergedOverviewMetrics(withVersion5Defaults(stored) as Record<string, unknown>));
  }
  return withMergedInternalOnly(withMergedOverviewMetrics(withVersion5Defaults(stored) as Record<string, unknown>));
}

function withMergedInternalOnly(stored: Record<string, unknown>): Record<string, unknown> {
  const rawList = Array.isArray(stored.internalOnly) ? (stored.internalOnly as any[]) : [];
  const existingMap = new Map(rawList.filter((s) => s && typeof s === "object").map((s: any) => [s.id, s]));
  const merged = DEFAULT_INTERNAL_ONLY_SETTINGS.map((def) => {
    const existing = existingMap.get(def.id);
    return existing ? { ...def, ...existing } : { ...def };
  });
  return {
    ...stored,
    internalOnly: merged,
  };
}

function withMergedOverviewMetrics(stored: Record<string, unknown>): Record<string, unknown> {
  const rawList = Array.isArray(stored.overviewMetrics) ? (stored.overviewMetrics as any[]) : [];
  const existingMap = new Map(rawList.filter((m) => m && typeof m === "object").map((m: any) => [m.id, m]));
  const merged = DEFAULT_OVERVIEW_METRICS.map((def) => {
    const existing = existingMap.get(def.id);
    // Labels are not editable, so a renamed metric takes its new label.
    return existing ? { ...def, ...existing, label: def.label } : { ...def };
  });
  return {
    ...stored,
    overviewMetrics: merged,
  };
}

/**
 * Version 5 added the per-product `enabled` switch and admin-authored custom media
 * types. Existing products predate the switch and were all in play, so they migrate on.
 */
function withVersion5Defaults(stored: Record<string, unknown>): unknown {
  const products = Array.isArray(stored.products)
    ? stored.products.map((product) => ({ enabled: true, ...(product as Record<string, unknown>) }))
    : stored.products;
  const ctvPublisherTargetCount = typeof stored.ctvPublisherTargetCount === "number" && Number.isFinite(stored.ctvPublisherTargetCount)
    ? Math.max(1, Math.min(30, Math.round(stored.ctvPublisherTargetCount)))
    : 8;
  const ctvTier1TargetPercent = typeof stored.ctvTier1TargetPercent === "number" && Number.isFinite(stored.ctvTier1TargetPercent)
    ? Math.max(0, Math.min(100, Math.round(stored.ctvTier1TargetPercent as number)))
    : 35;
  const ctvTier2TargetPercent = typeof stored.ctvTier2TargetPercent === "number" && Number.isFinite(stored.ctvTier2TargetPercent)
    ? Math.max(0, Math.min(100, Math.round(stored.ctvTier2TargetPercent as number)))
    : 45;
  const ctvTier3TargetPercent = typeof stored.ctvTier3TargetPercent === "number" && Number.isFinite(stored.ctvTier3TargetPercent)
    ? Math.max(0, Math.min(100, Math.round(stored.ctvTier3TargetPercent as number)))
    : 20;
  return {
    ...stored,
    version: PLANNING_SETTINGS_VERSION,
    products,
    customProducts: stored.customProducts ?? [],
    ctvPublisherTargetCount,
    ctvTier1TargetPercent,
    ctvTier2TargetPercent,
    ctvTier3TargetPercent,
  };
}

export function loadPlanningSettings(storage: Pick<Storage, "getItem"> | null | undefined, defaults: PlanningSettings = DEFAULT_PLANNING_SETTINGS): PlanningSettings {
  if (!storage) return clonePlanningSettings(defaults);
  try {
    const raw = storage.getItem(PLANNING_SETTINGS_STORAGE_KEY);
    if (!raw) return clonePlanningSettings(defaults);
    const result = validatePlanningSettings(migrateStoredSettings(JSON.parse(raw), defaults));
    return result.valid && result.settings ? clonePlanningSettings(result.settings) : clonePlanningSettings(defaults);
  } catch {
    return clonePlanningSettings(defaults);
  }
}

export function savePlanningSettings(storage: Pick<Storage, "setItem"> | null | undefined, settings: PlanningSettings): SettingsValidationResult {
  const result = validatePlanningSettings(settings);
  if (!result.valid || !result.settings) return result;
  if (storage) storage.setItem(PLANNING_SETTINGS_STORAGE_KEY, JSON.stringify(result.settings));
  return result;
}

export function findBudgetChannelTier(normalized30DayBudget: number, settings: PlanningSettings): BudgetChannelTier {
  const safeBudget = Math.max(0, Number.isFinite(normalized30DayBudget) ? normalized30DayBudget : 0);
  const sorted = [...settings.budgetChannelTiers].sort((a, b) => a.minBudget - b.minBudget);
  return sorted.find((tier) => safeBudget >= tier.minBudget && (tier.maxBudgetExclusive === null || safeBudget < tier.maxBudgetExclusive)) || sorted[sorted.length - 1];
}

export function parseCurrencyInput(value: string | number | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : 0;
  if (!value) return 0;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function normalizeCampaignBudget(totalWorkingMediaBudget: number, campaignFlightDays?: number | null): BudgetNormalizationResult {
  const workingMediaBudget = Math.max(0, Number(totalWorkingMediaBudget) || 0);
  const parsedDays = Number(campaignFlightDays);
  const hasKnownDuration = Number.isFinite(parsedDays) && parsedDays >= 1;
  if (!hasKnownDuration) return { workingMediaBudget, campaignFlightDays: null, normalized30DayBudget: workingMediaBudget, assumptions: ["Campaign length was not supplied; budget was treated as a 30-day budget."] };
  return { workingMediaBudget, campaignFlightDays: Math.max(1, Math.round(parsedDays)), normalized30DayBudget: (workingMediaBudget / Math.max(1, Math.round(parsedDays))) * 30, assumptions: [] };
}
