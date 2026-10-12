/**
 * Monthly reach and frequency from impressions, a household universe and planner settings.
 *
 * Reach is estimated per media type on a saturating curve, then combined across media types:
 *
 *   target    = universe × audienceShare%                        (100% unless narrowed)
 *   base_i    = target if the media type applies audience targeting, else universe
 *   ceiling_i = base_i × maxReach%_i
 *   reach_i   = ceiling_i × (1 − e^(−monthlyImpressions_i / (ceiling_i × s_i)))
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
 * Everything is per month because the planning team flights campaigns monthly. A flight of
 * 30 days or less is its own month.
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
  maxReachPercent: number;
  duplicationFactor: number;
  reachableHouseholds: number;
  monthlyReach: number;
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
  channels: ChannelReach[];
  assumptions: string[];
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
      unit: "households",
      peoplePerHousehold: 2.5,
      minimumTargetableHouseholds: 0,
      appliesAudienceTargeting: true,
      rationale: "",
    };
}

export function estimateMonthlyReach(input: {
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
    const audienceTargeted = row.appliesAudienceTargeting !== false && sharePercent < 100;
    const baseHouseholds = audienceTargeted ? targetHouseholds : universe.households;
    const reachableHouseholds = baseHouseholds * (Math.max(0, Math.min(100, row.maxReachPercent)) / 100);
    const base = {
      mediaTypeId,
      label: row.label,
      monthlyImpressions,
      maxReachPercent: row.maxReachPercent,
      duplicationFactor: row.duplicationFactor,
      reachableHouseholds,
      audienceTargeted,
    };

    let excludedReason: string | undefined;
    if (!row.countsTowardReach) excludedReason = "Does not count toward reach (Settings).";
    else if (row.minimumTargetableHouseholds > 0 && universe.households < row.minimumTargetableHouseholds) {
      excludedReason = `Not targetable below ${row.minimumTargetableHouseholds.toLocaleString("en-US")} households.`;
    } else if (reachableHouseholds <= 0) excludedReason = "Max reachable % is 0.";

    if (excludedReason) {
      channels.push({ ...base, monthlyReach: 0, included: false, excludedReason });
      continue;
    }

    const saturation = monthlyImpressions / (reachableHouseholds * Math.max(1, row.duplicationFactor));
    channels.push({ ...base, monthlyReach: reachableHouseholds * (1 - Math.exp(-saturation)), included: true });
  }

  const included = channels.filter((channel) => channel.included);
  let targetUnreached = 1;
  for (const channel of included.filter((entry) => entry.audienceTargeted)) {
    targetUnreached *= 1 - Math.min(1, channel.monthlyReach / targetHouseholds);
  }
  const targetedReach = targetHouseholds > 0 ? targetHouseholds * (1 - targetUnreached) : 0;
  let unreachedShare = universe.households > 0 ? 1 - Math.min(1, targetedReach / universe.households) : 1;
  for (const channel of included.filter((entry) => !entry.audienceTargeted)) {
    unreachedShare *= 1 - Math.min(1, channel.monthlyReach / universe.households);
  }
  const monthlyReach = universe.households > 0 ? universe.households * (1 - unreachedShare) : 0;
  const monthlyImpressions = included.reduce((total, channel) => total + channel.monthlyImpressions, 0);
  const monthlyFrequency = monthlyReach > 0 ? monthlyImpressions / monthlyReach : 0;

  const min = settings.targetMonthlyFrequencyMin;
  const max = settings.targetMonthlyFrequencyMax;
  return {
    universe,
    audience,
    targetHouseholds,
    reachPercentOfTarget: targetHouseholds > 0 ? (monthlyReach / targetHouseholds) * 100 : 0,
    flightDays,
    monthlyImpressions,
    monthlyReach,
    monthlyFrequency,
    reachPercentOfUniverse: universe.households > 0 ? (monthlyReach / universe.households) * 100 : 0,
    frequencyBand: { min, max, withinBand: monthlyFrequency >= min && monthlyFrequency <= max },
    channels: channels.sort((a, b) => b.monthlyImpressions - a.monthlyImpressions),
    assumptions,
  };
}
