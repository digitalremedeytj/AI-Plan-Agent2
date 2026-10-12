/**
 * Reach and frequency, per month and over the whole flight, from impressions, a household
 * universe and planner settings.
 *
 * Reach is estimated per media type on a saturating curve, then combined across media types:
 *
 *   target    = universe × audienceShare%                        (100% unless narrowed)
 *   base_i    = target if the media type applies audience targeting, else universe
 *   ceiling_i = base_i × maxReach%_i
 *   x_i       = impressions_i / (ceiling_i × s_i)
 *   reach_i   = ceiling_i × (1 − (1 + x_i / k_i)^(−k_i))         (NBD reach curve)
 *   targeted  = target × (1 − Π(1 − reach_i / target))           (Sainsbury: random overlap)
 *   reach     = universe × (1 − (1 − targeted / universe) × Π(1 − reach_j / universe))
 *   frequency = Σ monthlyImpressions_i / reach
 *
 * Audience-targeted media types all fish in the same pool, so they are combined within the
 * target first; combining them across the whole geography would understate their overlap.
 *
 * At low volume reach_i ≈ impressions / s, so s is roughly the impressions it takes to find a
 * new household; as volume grows each media type flattens toward its ceiling and frequency
 * climbs instead. Frequency is therefore an output, never an assumption.
 *
 * The NBD (negative binomial) curve is the standard TV reach-build model. k captures how
 * unevenly delivery falls across households: heavy users are reached early and light users
 * trickle in for months, so over a long flight reach keeps creeping up rather than stopping
 * dead at the ceiling, which is what the plain exponential curve (k → ∞) does.
 *
 * The same curve gives both views: one month's impressions give monthly reach (planning
 * flights monthly), the whole flight's give unique reach over the campaign. Multiplying
 * monthly reach by the number of months would count the same households again each month.
 */
import type { HouseholdUniverse } from "./universe";
import type { AudienceShare } from "./audienceShare";
import type { ReachMediaTypeId, ReachMediaTypeSetting, ReachSettings } from "./reachSettings";
import { UNMAPPED_MEDIA_TYPE_ID } from "./reachSettings";

const DAYS_PER_MONTH = 30;

export interface ReachChannelInput {
  mediaTypeId: ReachMediaTypeId;
  /** Impressions over the whole flight. */
  impressions: number;
}

export interface ChannelReach {
  mediaTypeId: ReachMediaTypeId;
  label: string;
  /** Household-equivalent impressions per month (people-based media are converted). */
  monthlyImpressions: number;
  /** Household-equivalent impressions over the whole flight. */
  flightImpressions: number;
  maxReachPercent: number;
  duplicationFactor: number;
  concentrationK: number;
  reachableHouseholds: number;
  monthlyReach: number;
  /** Unique households over the whole flight; equals monthlyReach for flights of a month or less. */
  flightReach: number;
  /** True when this media type was measured against the target audience, not the whole geo. */
  audienceTargeted: boolean;
  included: boolean;
  excludedReason?: string;
}

export interface ReachEstimate {
  universe: HouseholdUniverse;
  audience: AudienceShare | null;
  /** Households in the target audience: the universe × audience share. */
  targetHouseholds: number;
  /** monthlyReach as a share of the target, 0-100. Can pass 100 when untargeted media types count. */
  reachPercentOfTarget: number;
  /** The flight length used, or null when unknown (then treated as one month). */
  flightDays: number | null;
  /** Monthly impressions from media types that count toward reach. */
  monthlyImpressions: number;
  monthlyReach: number;
  monthlyFrequency: number;
  /** monthlyReach as a share of the universe, 0-100. */
  reachPercentOfUniverse: number;
  frequencyBand: { min: number; max: number; withinBand: boolean };
  /** Unique reach over the whole flight; null when the flight is a month or less (or unknown). */
  flight: FlightReach | null;
  channels: ChannelReach[];
  assumptions: string[];
}

export interface FlightReach {
  days: number;
  impressions: number;
  reach: number;
  /** Average exposures per reached household over the whole flight. */
  frequency: number;
  reachPercentOfUniverse: number;
  reachPercentOfTarget: number;
}

/** NBD reach as a share of the ceiling. Large k tends to the exponential curve 1 − e^(−x). */
export function reachShareOfCeiling(x: number, k: number): number {
  if (!(x > 0)) return 0;
  if (!(k > 0) || k > 1e6) return 1 - Math.exp(-x);
  return 1 - Math.pow(1 + x / k, -k);
}

function monthlyShare(flightDays: number | null): number {
  if (flightDays === null || flightDays <= DAYS_PER_MONTH) return 1;
  return DAYS_PER_MONTH / flightDays;
}

function settingFor(settings: ReachSettings, id: ReachMediaTypeId): ReachMediaTypeSetting {
  return settings.mediaTypes.find((row) => row.mediaTypeId === id)
    || settings.mediaTypes.find((row) => row.mediaTypeId === UNMAPPED_MEDIA_TYPE_ID)
    || {
      mediaTypeId: id,
      label: id,
      countsTowardReach: true,
      maxReachPercent: 80,
      duplicationFactor: 4,
      concentrationK: 1.5,
      unit: "households",
      peoplePerHousehold: 2.5,
      minimumTargetableHouseholds: 0,
      appliesAudienceTargeting: true,
      rationale: "",
    };
}

export function estimateReach(input: {
  channels: ReachChannelInput[];
  universe: HouseholdUniverse;
  flightDays: number | null | undefined;
  settings: ReachSettings;
  audience?: AudienceShare | null;
}): ReachEstimate {
  const { universe, settings } = input;
  const audience = input.audience ?? null;
  const sharePercent = audience ? Math.max(0, Math.min(100, audience.sharePercent)) : 100;
  const targetHouseholds = universe.households * (sharePercent / 100);
  const flightDays = Number.isFinite(input.flightDays) && Number(input.flightDays) >= 1 ? Math.round(Number(input.flightDays)) : null;
  const share = monthlyShare(flightDays);
  const assumptions: string[] = [];
  if (flightDays === null) assumptions.push("Flight length unknown; impressions treated as one month.");
  if (universe.unresolved.length > 0) assumptions.push(`Could not size ${universe.unresolved.join(", ")}; left out of the household universe.`);
  if (audience?.flooredFrom !== null && audience?.flooredFrom !== undefined) {
    assumptions.push(`Audience filters multiply to ${audience.flooredFrom.toFixed(1)}%; raised to the ${sharePercent}% minimum in Settings.`);
  }
  if (audience && audience.unknownFilterIds.length > 0) {
    assumptions.push(`Audience filters no longer in Settings were ignored: ${audience.unknownFilterIds.join(", ")}.`);
  }

  // Two placements of the same media type are one audience pool, not two independent ones;
  // combining them with Sainsbury would overstate reach.
  const impressionsByType = new Map<ReachMediaTypeId, number>();
  for (const channel of input.channels) {
    const impressions = Number.isFinite(channel.impressions) ? Math.max(0, channel.impressions) : 0;
    if (impressions <= 0) continue;
    impressionsByType.set(channel.mediaTypeId, (impressionsByType.get(channel.mediaTypeId) || 0) + impressions);
  }

  const channels: ChannelReach[] = [];
  for (const [mediaTypeId, impressions] of impressionsByType) {
    const row = settingFor(settings, mediaTypeId);
    const householdImpressions = row.unit === "people" ? impressions / Math.max(1, row.peoplePerHousehold) : impressions;
    const monthlyImpressions = householdImpressions * share;
    const flightImpressions = householdImpressions;
    const audienceTargeted = row.appliesAudienceTargeting !== false && sharePercent < 100;
    const baseHouseholds = audienceTargeted ? targetHouseholds : universe.households;
    const reachableHouseholds = baseHouseholds * (Math.max(0, Math.min(100, row.maxReachPercent)) / 100);
    const base = {
      mediaTypeId,
      label: row.label,
      monthlyImpressions,
      flightImpressions,
      maxReachPercent: row.maxReachPercent,
      duplicationFactor: row.duplicationFactor,
      concentrationK: row.concentrationK,
      reachableHouseholds,
      audienceTargeted,
    };

    let excludedReason: string | undefined;
    if (!row.countsTowardReach) excludedReason = "Does not count toward reach (Settings).";
    else if (row.minimumTargetableHouseholds > 0 && universe.households < row.minimumTargetableHouseholds) {
      excludedReason = `Not targetable below ${row.minimumTargetableHouseholds.toLocaleString("en-US")} households.`;
    } else if (reachableHouseholds <= 0) excludedReason = "Max reachable % is 0.";

    if (excludedReason) {
      channels.push({ ...base, monthlyReach: 0, flightReach: 0, included: false, excludedReason });
      continue;
    }

    const curve = (impressionsInWindow: number) =>
      reachableHouseholds * reachShareOfCeiling(impressionsInWindow / (reachableHouseholds * Math.max(1, row.duplicationFactor)), row.concentrationK);
    const monthlyReach = curve(monthlyImpressions);
    channels.push({ ...base, monthlyReach, flightReach: share < 1 ? curve(flightImpressions) : monthlyReach, included: true });
  }

  const included = channels.filter((channel) => channel.included);
  // Targeted media share one pool, so they combine within the target before the rest join.
  const combine = (reachOf: (channel: ChannelReach) => number): number => {
    if (universe.households <= 0) return 0;
    let targetUnreached = 1;
    for (const channel of included.filter((entry) => entry.audienceTargeted)) {
      targetUnreached *= 1 - Math.min(1, reachOf(channel) / targetHouseholds);
    }
    const targetedReach = targetHouseholds > 0 ? targetHouseholds * (1 - targetUnreached) : 0;
    let unreachedShare = 1 - Math.min(1, targetedReach / universe.households);
    for (const channel of included.filter((entry) => !entry.audienceTargeted)) {
      unreachedShare *= 1 - Math.min(1, reachOf(channel) / universe.households);
    }
    return universe.households * (1 - unreachedShare);
  };
  const percentOf = (reach: number, base: number) => (base > 0 ? (reach / base) * 100 : 0);

  const monthlyReach = combine((channel) => channel.monthlyReach);
  const monthlyImpressions = included.reduce((total, channel) => total + channel.monthlyImpressions, 0);
  const monthlyFrequency = monthlyReach > 0 ? monthlyImpressions / monthlyReach : 0;

  let flight: FlightReach | null = null;
  if (flightDays !== null && share < 1) {
    const reach = combine((channel) => channel.flightReach);
    const impressions = included.reduce((total, channel) => total + channel.flightImpressions, 0);
    flight = {
      days: flightDays,
      impressions,
      reach,
      frequency: reach > 0 ? impressions / reach : 0,
      reachPercentOfUniverse: percentOf(reach, universe.households),
      reachPercentOfTarget: percentOf(reach, targetHouseholds),
    };
  }

  const min = settings.targetMonthlyFrequencyMin;
  const max = settings.targetMonthlyFrequencyMax;
  return {
    universe,
    audience,
    targetHouseholds,
    reachPercentOfTarget: percentOf(monthlyReach, targetHouseholds),
    flightDays,
    monthlyImpressions,
    monthlyReach,
    monthlyFrequency,
    reachPercentOfUniverse: percentOf(monthlyReach, universe.households),
    frequencyBand: { min, max, withinBand: monthlyFrequency >= min && monthlyFrequency <= max },
    flight,
    channels: channels.sort((a, b) => b.monthlyImpressions - a.monthlyImpressions),
    assumptions,
  };
}
