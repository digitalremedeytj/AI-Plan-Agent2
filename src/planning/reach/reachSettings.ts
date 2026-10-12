/**
 * Planner-owned assumptions behind Estimated Reach and Avg Frequency.
 *
 * These live in PlanningSettings, not in code, for two reasons: Media Planning owns the
 * numbers and needs to adjust them without a deploy, and showing them in Settings is how
 * planners see the logic a plan's reach figure rests on. Being part of PlanningSettings
 * also means they are versioned per revision, so a saved plan keeps the assumptions it was
 * generated with.
 */
import type { CanonicalMediaType } from "../../types";
import { CANONICAL_MEDIA_TAXONOMY } from "../../utils/mediaTaxonomy";

/** Placements the taxonomy could not place get their own row instead of borrowing one. */
export const UNMAPPED_MEDIA_TYPE_ID = "unmapped" as const;
export type ReachMediaTypeId = CanonicalMediaType | typeof UNMAPPED_MEDIA_TYPE_ID;

export type ReachUnit = "households" | "people";

export interface ReachMediaTypeSetting {
  mediaTypeId: ReachMediaTypeId;
  label: string;
  /** Off for media that does not add incremental household reach (search, email, retargeting, fees). */
  countsTowardReach: boolean;
  /** Share of the geo's TV households this media type can reach at all: its penetration ceiling. */
  maxReachPercent: number;
  /**
   * How many impressions it takes to add a new household while reach is still low. Higher
   * means reach builds more slowly and frequency climbs sooner.
   */
  duplicationFactor: number;
  /** DOOH counts people, not households; its impressions are divided by peoplePerHousehold. */
  unit: ReachUnit;
  peoplePerHousehold: number;
  /**
   * Below this many households in the targeted geography the media type is treated as not
   * deliverable and left out of reach. 0 means no minimum. Exists now so ZIP targeting can
   * use it without another settings migration.
   */
  minimumTargetableHouseholds: number;
  /**
   * Whether this media type can be bought against the plan's target audience. When off it
   * reaches across the whole geography however narrow the audience is (DOOH screens, broad
   * linear, geofenced places).
   */
  appliesAudienceTargeting: boolean;
  rationale: string;
}

/**
 * One row of the audience share reference: the share of TV households matching a filter.
 * Filters in the same category are alternatives and add up; filters in different categories
 * are treated as independent and multiply.
 */
export interface AudienceShareFilter {
  id: string;
  category: string;
  label: string;
  sharePercent: number;
  source: string;
}

export interface ReachSettings {
  mediaTypes: ReachMediaTypeSetting[];
  /** Monthly frequency band planners aim for; values outside it are flagged, not hidden. */
  targetMonthlyFrequencyMin: number;
  targetMonthlyFrequencyMax: number;
  audienceShareReference: AudienceShareFilter[];
  /** Stacked filters never shrink the target below this share of the geography. */
  minimumAudienceSharePercent: number;
}

type ReachDefault = Omit<ReachMediaTypeSetting, "mediaTypeId" | "label" | "unit" | "peoplePerHousehold" | "minimumTargetableHouseholds" | "appliesAudienceTargeting">
  & Partial<Pick<ReachMediaTypeSetting, "unit" | "peoplePerHousehold" | "minimumTargetableHouseholds" | "appliesAudienceTargeting">>;

/**
 * Starting assumptions, accepted by Media Planning on 2026-10-12 for launch. They are
 * planning estimates, not measured figures; the rationale column says what each rests on.
 */
const MEDIA_TYPE_DEFAULTS: Record<ReachMediaTypeId, ReachDefault> = {
  ctv: { countsTowardReach: true, maxReachPercent: 80, duplicationFactor: 3.5, rationale: "Most TV households now stream on a connected TV." },
  youtube_tv: { countsTowardReach: true, maxReachPercent: 8, duplicationFactor: 3, rationale: "Limited to YouTube TV subscriber households (about 9M)." },
  sports_ott: { countsTowardReach: true, maxReachPercent: 35, duplicationFactor: 3, rationale: "Sports streaming audiences only." },
  amazon_ott: { countsTowardReach: true, maxReachPercent: 55, duplicationFactor: 3, rationale: "Prime Video ad-supported household footprint." },
  linear_tv: { countsTowardReach: true, maxReachPercent: 60, duplicationFactor: 3, appliesAudienceTargeting: false, rationale: "Pay TV plus over-the-air households." },
  programmatic_video: { countsTowardReach: true, maxReachPercent: 85, duplicationFactor: 4, rationale: "Open-web video across devices." },
  digital_video_blend: { countsTowardReach: true, maxReachPercent: 85, duplicationFactor: 4, rationale: "Open-web video across devices." },
  youtube: { countsTowardReach: true, maxReachPercent: 85, duplicationFactor: 4, rationale: "Near-universal video platform." },
  programmatic_display: { countsTowardReach: true, maxReachPercent: 90, duplicationFactor: 6, rationale: "Broadest inventory; high duplication across sites." },
  native: { countsTowardReach: true, maxReachPercent: 80, duplicationFactor: 5, rationale: "Content-site inventory." },
  digital_audio: { countsTowardReach: true, maxReachPercent: 60, duplicationFactor: 4, rationale: "Streaming audio and podcast listeners." },
  social_advertising: { countsTowardReach: true, maxReachPercent: 75, duplicationFactor: 5, rationale: "Major social platforms' household reach." },
  geofence_video: { countsTowardReach: true, maxReachPercent: 10, duplicationFactor: 6, appliesAudienceTargeting: false, rationale: "Fenced locations reach a small share of the geo." },
  geofence_display: { countsTowardReach: true, maxReachPercent: 10, duplicationFactor: 6, appliesAudienceTargeting: false, rationale: "Fenced locations reach a small share of the geo." },
  digital_out_of_home: { countsTowardReach: false, maxReachPercent: 50, duplicationFactor: 4, unit: "people", peoplePerHousehold: 2.5, appliesAudienceTargeting: false, rationale: "Measured in people, not households; off by default." },
  google_search: { countsTowardReach: false, maxReachPercent: 60, duplicationFactor: 5, rationale: "Reaches people already searching; not incremental reach." },
  email_marketing: { countsTowardReach: false, maxReachPercent: 20, duplicationFactor: 3, rationale: "Capped by list size; not incremental reach." },
  display_retargeting: { countsTowardReach: false, maxReachPercent: 5, duplicationFactor: 8, rationale: "Reaches prior site visitors; not incremental reach." },
  advanced_measurement: { countsTowardReach: false, maxReachPercent: 0, duplicationFactor: 1, rationale: "Does not deliver ads." },
  ad_serving: { countsTowardReach: false, maxReachPercent: 0, duplicationFactor: 1, rationale: "Does not deliver ads." },
  unmapped: { countsTowardReach: true, maxReachPercent: 80, duplicationFactor: 4, rationale: "Used when a placement does not map to a known media type." },
};

const labelFor = (id: ReachMediaTypeId): string =>
  id === UNMAPPED_MEDIA_TYPE_ID
    ? "Unmapped placements"
    : CANONICAL_MEDIA_TAXONOMY.find((item) => item.id === id)?.displayName || id;

/** Taxonomy order, with Unmapped last, so the Settings table reads like the rest of the app. */
export const REACH_MEDIA_TYPE_IDS: ReachMediaTypeId[] = [
  ...CANONICAL_MEDIA_TAXONOMY.map((item) => item.id),
  UNMAPPED_MEDIA_TYPE_ID,
];

const CENSUS = "U.S. Census Bureau ACS, approx.";

/**
 * Starting shares of U.S. households, rounded. Media Planning owns and should verify them;
 * a plan only uses the rows a planner picks, and the share is never generated by the AI.
 */
const DEFAULT_AUDIENCE_SHARE_REFERENCE: AudienceShareFilter[] = [
  { id: "hhi-under-50k", category: "Household income", label: "Under $50K", sharePercent: 35, source: CENSUS },
  { id: "hhi-50-100k", category: "Household income", label: "$50K–$100K", sharePercent: 28, source: CENSUS },
  { id: "hhi-100-150k", category: "Household income", label: "$100K–$150K", sharePercent: 16, source: CENSUS },
  { id: "hhi-150k-plus", category: "Household income", label: "$150K+", sharePercent: 21, source: CENSUS },
  { id: "age-under-35", category: "Householder age", label: "Under 35", sharePercent: 20, source: CENSUS },
  { id: "age-35-54", category: "Householder age", label: "35–54", sharePercent: 34, source: CENSUS },
  { id: "age-55-64", category: "Householder age", label: "55–64", sharePercent: 19, source: CENSUS },
  { id: "age-65-plus", category: "Householder age", label: "65+", sharePercent: 27, source: CENSUS },
  { id: "kids-yes", category: "Children", label: "Children under 18 at home", sharePercent: 27, source: CENSUS },
  { id: "kids-no", category: "Children", label: "No children under 18", sharePercent: 73, source: CENSUS },
  { id: "home-owner", category: "Home ownership", label: "Homeowners", sharePercent: 65, source: CENSUS },
  { id: "home-renter", category: "Home ownership", label: "Renters", sharePercent: 35, source: CENSUS },
  { id: "pets", category: "Pets", label: "Pet-owning households", sharePercent: 60, source: "Industry pet-ownership surveys, approx." },
];

export function buildDefaultAudienceShareReference(): AudienceShareFilter[] {
  return DEFAULT_AUDIENCE_SHARE_REFERENCE.map((filter) => ({ ...filter }));
}

export function buildDefaultReachSettings(): ReachSettings {
  return {
    mediaTypes: REACH_MEDIA_TYPE_IDS.map((mediaTypeId) => {
      const defaults = MEDIA_TYPE_DEFAULTS[mediaTypeId];
      return {
        mediaTypeId,
        label: labelFor(mediaTypeId),
        countsTowardReach: defaults.countsTowardReach,
        maxReachPercent: defaults.maxReachPercent,
        duplicationFactor: defaults.duplicationFactor,
        unit: defaults.unit ?? "households",
        peoplePerHousehold: defaults.peoplePerHousehold ?? 2.5,
        minimumTargetableHouseholds: defaults.minimumTargetableHouseholds ?? 0,
        appliesAudienceTargeting: defaults.appliesAudienceTargeting ?? true,
        rationale: defaults.rationale,
      };
    }),
    targetMonthlyFrequencyMin: 3,
    targetMonthlyFrequencyMax: 8,
    audienceShareReference: buildDefaultAudienceShareReference(),
    minimumAudienceSharePercent: 2,
  };
}

export const DEFAULT_REACH_SETTINGS: ReachSettings = buildDefaultReachSettings();

/**
 * Fills in anything a stored record lacks: older settings have no reach block, and a media
 * type added to the taxonomy later would otherwise have no row. Labels always come from the
 * taxonomy since they are not editable.
 */
export function mergeReachSettings(value: unknown): ReachSettings {
  const defaults = buildDefaultReachSettings();
  if (!value || typeof value !== "object") return defaults;
  const stored = value as Partial<ReachSettings>;
  const storedRows = new Map(
    (Array.isArray(stored.mediaTypes) ? stored.mediaTypes : [])
      .filter((row) => row && typeof row === "object")
      .map((row) => [row.mediaTypeId, row]),
  );
  return {
    mediaTypes: defaults.mediaTypes.map((row) => {
      const existing = storedRows.get(row.mediaTypeId);
      return existing ? { ...row, ...existing, mediaTypeId: row.mediaTypeId, label: row.label } : row;
    }),
    targetMonthlyFrequencyMin: typeof stored.targetMonthlyFrequencyMin === "number" ? stored.targetMonthlyFrequencyMin : defaults.targetMonthlyFrequencyMin,
    targetMonthlyFrequencyMax: typeof stored.targetMonthlyFrequencyMax === "number" ? stored.targetMonthlyFrequencyMax : defaults.targetMonthlyFrequencyMax,
    // Planners may delete reference rows, so a stored list is taken as-is, not backfilled.
    audienceShareReference: Array.isArray(stored.audienceShareReference)
      ? stored.audienceShareReference.filter((row) => row && typeof row === "object").map((row) => ({ ...row }))
      : defaults.audienceShareReference,
    minimumAudienceSharePercent: typeof stored.minimumAudienceSharePercent === "number" ? stored.minimumAudienceSharePercent : defaults.minimumAudienceSharePercent,
  };
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function validateReachSettings(value: ReachSettings, errors: string[]): void {
  const ids = new Set(value.mediaTypes.map((row) => row.mediaTypeId));
  const missing = REACH_MEDIA_TYPE_IDS.filter((id) => !ids.has(id));
  if (missing.length > 0 || value.mediaTypes.length !== REACH_MEDIA_TYPE_IDS.length) {
    errors.push("Reach settings must include one row for every media type.");
  }
  for (const row of value.mediaTypes) {
    const label = `Reach > ${row.label || row.mediaTypeId}`;
    if (typeof row.countsTowardReach !== "boolean") errors.push(`${label}: Counts toward reach must be true or false.`);
    if (!finite(row.maxReachPercent) || row.maxReachPercent < 0 || row.maxReachPercent > 100) errors.push(`${label}: max reachable % must be between 0 and 100.`);
    if (!finite(row.duplicationFactor) || row.duplicationFactor < 1 || row.duplicationFactor > 50) errors.push(`${label}: duplication factor must be between 1 and 50.`);
    if (row.unit !== "households" && row.unit !== "people") errors.push(`${label}: unit must be households or people.`);
    if (!finite(row.peoplePerHousehold) || row.peoplePerHousehold < 1 || row.peoplePerHousehold > 10) errors.push(`${label}: people per household must be between 1 and 10.`);
    if (!finite(row.minimumTargetableHouseholds) || row.minimumTargetableHouseholds < 0 || !Number.isInteger(row.minimumTargetableHouseholds)) errors.push(`${label}: minimum targetable households must be a whole number, 0 or more.`);
    // A counted media type with no ceiling would silently contribute nothing.
    if (typeof row.appliesAudienceTargeting !== "boolean") errors.push(`${label}: Applies audience targeting must be true or false.`);
    if (row.countsTowardReach && finite(row.maxReachPercent) && row.maxReachPercent <= 0) errors.push(`${label}: a media type that counts toward reach needs a max reachable % above 0.`);
  }
  const { targetMonthlyFrequencyMin: min, targetMonthlyFrequencyMax: max } = value;
  if (!finite(min) || min < 0) errors.push("Reach > Target monthly frequency minimum must be 0 or more.");
  if (!finite(max) || max <= 0) errors.push("Reach > Target monthly frequency maximum must be above 0.");
  if (finite(min) && finite(max) && max < min) errors.push("Reach > Target monthly frequency maximum must be at least the minimum.");

  const filterIds = new Set<string>();
  for (const filter of value.audienceShareReference) {
    const label = `Audience share > ${filter.label || filter.id || "row"}`;
    if (!filter.id?.trim()) errors.push(`${label}: ID is required.`);
    else if (filterIds.has(filter.id)) errors.push(`${label}: duplicate ID ${filter.id}.`);
    filterIds.add(filter.id);
    if (!filter.category?.trim()) errors.push(`${label}: category is required.`);
    if (!filter.label?.trim()) errors.push(`${label}: label is required.`);
    if (!finite(filter.sharePercent) || filter.sharePercent <= 0 || filter.sharePercent > 100) errors.push(`${label}: share must be above 0% and at most 100%.`);
  }
  const floor = value.minimumAudienceSharePercent;
  if (!finite(floor) || floor <= 0 || floor > 100) errors.push("Reach > Minimum audience share must be above 0% and at most 100%.");
}

export function cloneReachSettings(value: ReachSettings): ReachSettings {
  return {
    ...value,
    mediaTypes: value.mediaTypes.map((row) => ({ ...row })),
    audienceShareReference: value.audienceShareReference.map((filter) => ({ ...filter })),
  };
}
