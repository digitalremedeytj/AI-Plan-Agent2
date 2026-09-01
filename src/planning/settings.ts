import { planningKnowledgeBase } from "./knowledge/normalizeWorkbook";
import { DIGITAL_REMEDY_PRODUCT_REGISTRY } from "./knowledge/registry";

export const PLANNING_SETTINGS_STORAGE_KEY = "scoutai_planning_settings";
export const PLANNING_SETTINGS_VERSION = 3 as const;
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
  { id: "avgFrequency", label: "Avg Frequency", show: false },
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

export interface PlanningSettings {
  version: typeof PLANNING_SETTINGS_VERSION;
  overviewMetrics: OverviewMetricSetting[];
  budgetChannelTiers: BudgetChannelTier[];
  products: ProductPlanningSetting[];
  publishers: PublisherPlanningSetting[];
  enhancements: EnhancementPlanningSetting[];
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

function buildDefaultSettings(): PlanningSettings {
  return {
    version: PLANNING_SETTINGS_VERSION,
    overviewMetrics: DEFAULT_OVERVIEW_METRICS.map((metric) => ({ ...metric })),
    budgetChannelTiers: DEFAULT_TIERS.map((tier) => ({ ...tier })),
    products: DIGITAL_REMEDY_PRODUCT_REGISTRY.map((product) => ({
      productId: product.id,
      displayName: product.displayName,
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
  };
}

export const DEFAULT_PLANNING_SETTINGS: PlanningSettings = buildDefaultSettings();

export function clonePlanningSettings(settings: PlanningSettings): PlanningSettings {
  return {
    version: PLANNING_SETTINGS_VERSION,
    overviewMetrics: settings.overviewMetrics.map((metric) => ({ ...metric })),
    budgetChannelTiers: settings.budgetChannelTiers.map((tier) => ({ ...tier })),
    products: settings.products.map((product) => ({ ...product, supportedGeographies: [...product.supportedGeographies] })),
    publishers: settings.publishers.map((publisher) => ({ ...publisher, attachesTo: [...publisher.attachesTo] })),
    enhancements: settings.enhancements.map((enhancement) => ({ ...enhancement, attachesTo: [...enhancement.attachesTo] })),
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
    if (!nonEmptyStrings(product.supportedGeographies)) errors.push(`${label} requires at least one geography.`);
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

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, errors: [], settings: { version: PLANNING_SETTINGS_VERSION, overviewMetrics, budgetChannelTiers: tiers, products, publishers, enhancements } };
}

function migrateStoredSettings(value: unknown, defaults: PlanningSettings): unknown {
  if (!value || typeof value !== "object") return value;
  const stored = value as { version?: number; budgetChannelTiers?: BudgetChannelTier[] };
  if (stored.version === 1 && Array.isArray(stored.budgetChannelTiers)) return { ...clonePlanningSettings(defaults), budgetChannelTiers: stored.budgetChannelTiers.map((tier) => ({ ...tier })) };
  if (stored.version === 2) return { ...stored, version: PLANNING_SETTINGS_VERSION, overviewMetrics: DEFAULT_OVERVIEW_METRICS.map((metric) => ({ ...metric })) };
  return value;
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
