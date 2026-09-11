import { DIGITAL_REMEDY_PRODUCT_REGISTRY } from "./knowledge/registry";
import type { CustomProductSetting, PlanningSettings } from "./settings";
import type { MediaProductRecord } from "./types";

/**
 * The product catalog a plan is actually built against: the Digital Remedy workbook
 * registry with settings overrides applied, disabled products removed, and any
 * admin-authored custom media types appended.
 *
 * Everything that needs to know "what media types exist right now" goes through here —
 * the planning engine, the reasoning-layer candidate list, and the id whitelist that
 * guards what comes back from it. Reading the raw registry in those places is what
 * previously let a settings change fail to reach the model.
 */

/** Custom products are marked as unverified so the reasoning layer weights them honestly. */
export function customProductToRecord(setting: CustomProductSetting): MediaProductRecord {
  return {
    id: setting.productId,
    displayName: setting.displayName,
    aliases: [...setting.aliases],
    familyId: `family.${setting.productId}`,
    legacyCanonicalId: setting.canonicalId,
    digitalRemedyExecutable: setting.digitalRemedyExecutable,
    status: setting.status,
    recommendationEligible: setting.recommendationEligible,
    defaultPriority: "triggered",
    funnelRoles: [...setting.funnelRoles],
    supportedKpis: [...setting.supportedKpis],
    audienceSignals: [...setting.audienceSignals],
    verticalExclusions: [],
    supportedGeographies: [...setting.supportedGeographies],
    // A custom product declares no readiness gates of its own. The admin expresses
    // those through the spend/flight minimums instead, which the engine already checks.
    creativeRequirements: [],
    dataRequirements: [],
    minimumTotalSpend: setting.minimumTotalSpend,
    minimumNormalized30DaySpend: setting.minimumNormalized30DaySpend,
    minimumFlightDays: setting.minimumFlightDays,
    typicalCpmLow: setting.typicalCpmLow,
    typicalCpmHigh: setting.typicalCpmHigh,
    minimumAllocationPercent: setting.minimumAllocationPercent,
    maximumAllocationPercent: setting.maximumAllocationPercent,
    scaleRating: 3,
    complementaryChannelIds: [],
    sourceMetadata: {
      sourceWorkbookVersion: "custom",
      sourceLabels: ["Custom media type added in Settings"],
      lastVerifiedDate: "",
      businessOwner: "Digital Remedy planning team",
      reviewStatus: "provisional",
    },
  };
}

export function resolveEffectiveProducts(settings: PlanningSettings): MediaProductRecord[] {
  const configured = new Map((settings.products || []).map((product) => [product.productId, product]));
  const registry = DIGITAL_REMEDY_PRODUCT_REGISTRY.filter((product) => configured.get(product.id)?.enabled !== false).map((product) => {
    const setting = configured.get(product.id);
    if (!setting) return product;
    return {
      ...product,
      displayName: setting.displayName,
      // A browser override can disable an executable product, but it cannot promote one
      // the Digital Remedy-controlled registry says is not executable.
      digitalRemedyExecutable: product.digitalRemedyExecutable && setting.digitalRemedyExecutable,
      status: setting.status,
      recommendationEligible: setting.recommendationEligible,
      supportedGeographies: [...setting.supportedGeographies],
      typicalCpmLow: setting.typicalCpmLow,
      typicalCpmHigh: setting.typicalCpmHigh,
      minimumTotalSpend: setting.minimumTotalSpend,
      minimumNormalized30DaySpend: setting.minimumNormalized30DaySpend,
      minimumFlightDays: setting.minimumFlightDays,
      minimumAllocationPercent: setting.minimumAllocationPercent,
      maximumAllocationPercent: setting.maximumAllocationPercent,
    };
  });

  const custom = (settings.customProducts || [])
    .filter((product) => product.enabled)
    .map(customProductToRecord);

  return [...registry, ...custom];
}

export function isCustomProductId(productId: string): boolean {
  return productId.startsWith("custom.");
}

/** Resolve a free-text channel label against the effective catalog, ids and aliases alike. */
export function findEffectiveProduct(products: MediaProductRecord[], value: string): MediaProductRecord | undefined {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  return products.find((record) =>
    record.id.toLowerCase() === normalized ||
    record.legacyCanonicalId === normalized ||
    record.displayName.toLowerCase() === normalized ||
    record.aliases.some((alias) => alias.toLowerCase() === normalized),
  );
}
