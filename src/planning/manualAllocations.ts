import type {
  ChannelPlanRecommendation,
  EvaluatedMediaCandidate,
  MediaRecommendationPlan,
} from "./types";

export type AllocationBasisPoints = Record<string, number>;

const TOTAL_BASIS_POINTS = 10_000;

/**
 * Smallest whole-number allocation a manually forced media type can hold. Planner overrides
 * always win over the product allocation minimum, so a forced add can never be rejected for
 * lack of room; it is funded down to 1% if that is all the portfolio can spare.
 */
const MANUAL_FLOOR_BASIS_POINTS = 100;

function roundBasisPoints(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value / 100) * 100;
}

export function effectiveBounds(channel: ChannelPlanRecommendation, totalBudget: number) {
  if (channel.manuallyForced) {
    return { minimum: MANUAL_FLOOR_BASIS_POINTS, maximum: TOTAL_BASIS_POINTS };
  }
  const maximum = Math.floor(channel.maximumAllocationPercent) * 100;
  const spendMinimumPercent = totalBudget > 0
    ? (channel.minimumTotalSpend / totalBudget) * 100
    : 100;
  return {
    minimum: Math.ceil(Math.max(channel.minimumAllocationPercent, spendMinimumPercent)) * 100,
    maximum,
  };
}

/**
 * Per-channel allocation floors for a portfolio. Normally these are each channel's effective
 * minimum, but when those minimums cannot all fit inside 100% the unfixed floors are scaled
 * down proportionally (never below 1%) so the portfolio stays feasible. This is what lets a
 * planner force in a media type the budget tier would otherwise have no room for.
 */
function allocationFloors(
  channels: ChannelPlanRecommendation[],
  budget: number,
  fixedBasisPoints: AllocationBasisPoints,
): Map<string, number> {
  const floors = new Map<string, number>();
  const scalable: ChannelPlanRecommendation[] = [];
  let fixedTotal = 0;
  channels.forEach((channel) => {
    const fixed = fixedBasisPoints[channel.channelId];
    if (fixed !== undefined) {
      fixedTotal += roundBasisPoints(fixed);
      return;
    }
    floors.set(channel.channelId, effectiveBounds(channel, budget).minimum);
    scalable.push(channel);
  });

  const available = TOTAL_BASIS_POINTS - fixedTotal;
  const required = scalable.reduce((sum, channel) => sum + (floors.get(channel.channelId) || 0), 0);
  if (required <= available || scalable.length === 0) return floors;

  // Floors do not fit. Give every channel the 1% hard floor, then distribute what is left
  // proportionally to how large each channel's original minimum was.
  const hardFloorTotal = scalable.length * MANUAL_FLOOR_BASIS_POINTS;
  let distributable = Math.max(0, available - hardFloorTotal);
  const weights = scalable.map((channel) => Math.max(0, (floors.get(channel.channelId) || 0) - MANUAL_FLOOR_BASIS_POINTS));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  scalable.forEach((channel, index) => {
    const share = weightTotal > 0
      ? Math.floor(((distributable * weights[index]) / weightTotal) / 100) * 100
      : 0;
    const capped = Math.min(share, weights[index]);
    floors.set(channel.channelId, MANUAL_FLOOR_BASIS_POINTS + capped);
  });
  // Hand any rounding remainder back to the channels with the largest original minimums.
  let remainder = available - scalable.reduce((sum, channel) => sum + (floors.get(channel.channelId) || 0), 0);
  const byWeight = scalable
    .map((channel, index) => ({ channel, weight: weights[index] }))
    .sort((a, b) => b.weight - a.weight || a.channel.channelId.localeCompare(b.channel.channelId));
  for (let index = 0; remainder >= 100 && byWeight.length > 0; index = (index + 1) % byWeight.length) {
    const entry = byWeight[index];
    const current = floors.get(entry.channel.channelId) || 0;
    const ceiling = effectiveBounds(entry.channel, budget).minimum;
    if (current + 100 <= ceiling) {
      floors.set(entry.channel.channelId, current + 100);
      remainder -= 100;
    } else if (byWeight.every((item) => (floors.get(item.channel.channelId) || 0) >= effectiveBounds(item.channel, budget).minimum)) {
      break;
    }
  }
  return floors;
}

function rawAllocationBasisPoints(plan: MediaRecommendationPlan): AllocationBasisPoints {
  return Object.fromEntries(plan.channels.map((channel) => [channel.channelId, Math.round(channel.allocationPercent * 100)]));
}

export function allocationBasisPoints(plan: MediaRecommendationPlan): AllocationBasisPoints {
  const raw = rawAllocationBasisPoints(plan);
  const alreadyWhole = Object.values(raw).every((value) => value % 100 === 0);
  const totalsExactly = Object.values(raw).reduce((sum, value) => sum + value, 0) === TOTAL_BASIS_POINTS;
  return alreadyWhole && totalsExactly ? raw : rebalanceBasisPoints(plan, {});
}

function allocateDollars(totalBudget: number, basisPoints: AllocationBasisPoints): Record<string, number> {
  const totalCents = Math.round(totalBudget * 100);
  const ids = Object.keys(basisPoints).sort();
  if (ids.length === 0) return {};
  const exact = ids.map((id) => ({ id, cents: (totalCents * basisPoints[id]) / TOTAL_BASIS_POINTS }));
  const result = Object.fromEntries(exact.map(({ id, cents }) => [id, Math.floor(cents)]));
  let remainder = totalCents - Object.values(result).reduce((sum, cents) => sum + cents, 0);
  exact.sort((a, b) => (b.cents - Math.floor(b.cents)) - (a.cents - Math.floor(a.cents)) || a.id.localeCompare(b.id));
  for (let index = 0; remainder > 0; index = (index + 1) % exact.length) {
    result[exact[index].id] += 1;
    remainder -= 1;
  }
  return Object.fromEntries(ids.map((id) => [id, result[id] / 100]));
}

function formatPercent(basisPoints: number): string {
  return `${basisPoints / 100}%`;
}

/**
 * Rebalances a selected portfolio around fixed allocations. Every channel not in
 * fixedBasisPoints is adjusted proportionally to its current allocation while
 * respecting its effective minimum, maximum, and minimum-dollar requirements.
 */
export function rebalanceBasisPoints(
  plan: MediaRecommendationPlan,
  fixedBasisPoints: AllocationBasisPoints,
  budgetOverride?: number,
): AllocationBasisPoints {
  if (plan.channels.length === 0) return {};
  const budget = budgetOverride ?? plan.workingMediaBudget;
  const channelsById = new Map(plan.channels.map((channel) => [channel.channelId, channel]));
  const current = rawAllocationBasisPoints(plan);
  const next: AllocationBasisPoints = {};

  Object.entries(fixedBasisPoints).forEach(([channelId, rawValue]) => {
    const channel = channelsById.get(channelId);
    if (!channel) throw new Error("That media type is no longer part of the selected plan.");
    const value = roundBasisPoints(rawValue);
    const bounds = effectiveBounds(channel, budget);
    if (value < Math.min(bounds.minimum, MANUAL_FLOOR_BASIS_POINTS) || value > bounds.maximum) {
      throw new Error(
        `${channel.channelName} must stay between ${formatPercent(bounds.minimum)} and ${formatPercent(bounds.maximum)} for this budget.`,
      );
    }
    next[channelId] = value;
  });

  const adjustable = plan.channels.filter((channel) => fixedBasisPoints[channel.channelId] === undefined);
  const floors = allocationFloors(plan.channels, budget, fixedBasisPoints);
  adjustable.forEach((channel) => {
    next[channel.channelId] = floors.get(channel.channelId) ?? effectiveBounds(channel, budget).minimum;
  });

  let remaining = TOTAL_BASIS_POINTS - Object.values(next).reduce((sum, value) => sum + value, 0);
  if (remaining < 0) {
    throw new Error("The locked allocations exceed 100%. Unlock or reduce another media type, or increase the budget.");
  }

  const maximumCapacity = adjustable.reduce((sum, channel) => {
    const bounds = effectiveBounds(channel, budget);
    return sum + Math.max(0, bounds.maximum - next[channel.channelId]);
  }, 0);
  if (remaining > maximumCapacity) {
    throw new Error("The unlocked media types cannot absorb the remaining budget without exceeding their maximums.");
  }

  while (remaining > 0) {
    const active = adjustable
      .filter((channel) => next[channel.channelId] < effectiveBounds(channel, budget).maximum)
      .sort((a, b) => a.channelId.localeCompare(b.channelId));
    if (active.length === 0) throw new Error("No unlocked media type can absorb the remaining budget.");
    const totalWeight = active.reduce((sum, channel) => sum + Math.max(1, current[channel.channelId] || 1), 0);
    const startingRemainder = remaining;
    let distributed = 0;

    active.forEach((channel) => {
      if (remaining <= 0) return;
      const maximum = effectiveBounds(channel, budget).maximum;
      const capacity = maximum - next[channel.channelId];
      const proportional = Math.floor(((startingRemainder * Math.max(1, current[channel.channelId] || 1)) / totalWeight) / 100) * 100;
      const addition = Math.min(capacity, remaining, Math.max(0, proportional));
      if (addition > 0) {
        next[channel.channelId] += addition;
        remaining -= addition;
        distributed += addition;
      }
    });

    if (distributed === 0) {
      const channel = active[0];
      next[channel.channelId] += 100;
      remaining -= 100;
    }
  }

  return next;
}

export function rebalanceEditedAllocation(
  plan: MediaRecommendationPlan,
  channelId: string,
  targetBasisPoints: number,
  lockedChannelIds: string[] = [],
  budgetOverride?: number,
): AllocationBasisPoints {
  const current = allocationBasisPoints(plan);
  const fixed: AllocationBasisPoints = { [channelId]: roundBasisPoints(targetBasisPoints) };
  lockedChannelIds.forEach((lockedId) => {
    if (lockedId !== channelId && current[lockedId] !== undefined) fixed[lockedId] = current[lockedId];
  });
  return rebalanceBasisPoints(plan, fixed, budgetOverride);
}

export function applyBasisPointAllocations(
  plan: MediaRecommendationPlan,
  basisPoints: AllocationBasisPoints,
  auditDetail: string,
  budgetOverride?: number,
): MediaRecommendationPlan {
  const channelIds = new Set(plan.channels.map((channel) => channel.channelId));
  if (Object.keys(basisPoints).length !== channelIds.size || Object.keys(basisPoints).some((id) => !channelIds.has(id))) {
    throw new Error("The edited allocations do not match the selected media types.");
  }
  if (Object.values(basisPoints).some((value) => !Number.isFinite(value) || Math.abs(value - roundBasisPoints(value)) > 0.0001)) {
    throw new Error("Allocation percentages must be whole numbers.");
  }
  if (Object.values(basisPoints).reduce((sum, value) => sum + roundBasisPoints(value), 0) !== TOTAL_BASIS_POINTS) {
    throw new Error("Allocations must equal exactly 100%.");
  }

  const budget = budgetOverride ?? plan.workingMediaBudget;
  const dollars = allocateDollars(budget, basisPoints);
  const floors = allocationFloors(plan.channels, budget, {});
  const channels = plan.channels.map((channel) => {
    const value = roundBasisPoints(basisPoints[channel.channelId]);
    const bounds = effectiveBounds(channel, budget);
    const floor = Math.min(floors.get(channel.channelId) ?? bounds.minimum, bounds.minimum);
    if (value < floor || value > bounds.maximum) {
      throw new Error(`${channel.channelName} is outside its allowed allocation range for a $${budget.toLocaleString()} budget.`);
    }
    const allocationDollars = dollars[channel.channelId];
    return {
      ...channel,
      allocationPercent: value / 100,
      allocationDollars,
      monthlyEquivalentSpend: plan.flightDays
        ? Math.round((allocationDollars / plan.flightDays) * 30 * 100) / 100
        : allocationDollars,
      fundingSource: "Rebalanced within the working media budget",
    };
  });

  return {
    ...plan,
    workingMediaBudget: budget,
    normalized30DayBudget: plan.flightDays
      ? Math.round((budget / plan.flightDays) * 30 * 100) / 100
      : budget,
    channels,
    selectedMediaTypeCount: channels.length,
    allocationAudit: [
      ...plan.allocationAudit,
      { type: "rebalance", detail: auditDetail },
      { type: "rounding", detail: "Kept whole-number allocation percentages at exactly 100% and matched working-media dollars after cent rounding." },
    ],
  };
}

function recommendationFromCandidate(
  candidate: EvaluatedMediaCandidate,
  plan: MediaRecommendationPlan,
): ChannelPlanRecommendation {
  return {
    channelId: candidate.product.id,
    canonicalId: candidate.product.legacyCanonicalId,
    channelName: candidate.product.displayName,
    familyId: candidate.product.familyId,
    status: candidate.status === "ADD" ? "ADD" : "TEST",
    recommendationScore: candidate.recommendationScore,
    confidence: candidate.confidence,
    allocationPercent: 0,
    allocationDollars: 0,
    monthlyEquivalentSpend: 0,
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
    assumptions: plan.assumptions,
    allocationRationale: candidate.allocationRationale,
    decisionRule: candidate.decisionRule,
    minimumAllocationPercent: candidate.product.minimumAllocationPercent,
    maximumAllocationPercent: candidate.product.maximumAllocationPercent,
    minimumTotalSpend: candidate.product.minimumTotalSpend,
    typicalCpmLow: candidate.product.typicalCpmLow,
    typicalCpmHigh: candidate.product.typicalCpmHigh,
    fundingSource: "Rebalanced within the fixed working media budget",
  };
}

export function addMediaTypeAndRebalance(
  plan: MediaRecommendationPlan,
  channelId: string,
  lockedChannelIds: string[] = [],
): MediaRecommendationPlan {
  if (plan.channels.some((channel) => channel.channelId === channelId)) return plan;
  const candidate = plan.evaluatedCandidates.find((item) => item.product.id === channelId);
  if (!candidate) throw new Error("That media type is not available in the current planning catalog.");
  // A manual add is a planner override: eligibility failures (budget, flight, and readiness
  // minimums) are recorded on the candidate for display but never block the add itself.
  // Catalog availability is not overridable — a retired or unlaunched product cannot be sold.
  const { product } = candidate;
  if (!product.digitalRemedyExecutable || !product.recommendationEligible || product.status !== "live") {
    throw new Error(`${product.displayName} is not currently available in the Digital Remedy catalog and cannot be added.`);
  }
  const addedChannel = { ...recommendationFromCandidate(candidate, plan), manuallyForced: true };
  const withCandidate: MediaRecommendationPlan = {
    ...plan,
    channels: [...plan.channels, addedChannel],
    selectedMediaTypeCount: plan.channels.length + 1,
  };
  const current = allocationBasisPoints(plan);
  const lockedFixed: AllocationBasisPoints = {};
  lockedChannelIds.forEach((id) => {
    if (current[id] !== undefined) lockedFixed[id] = current[id];
  });
  const totalScore = withCandidate.channels.reduce((sum, channel) => sum + Math.max(1, channel.recommendationScore), 0);
  const bounds = effectiveBounds(addedChannel, plan.workingMediaBudget);
  const weightedTarget = Math.round((Math.max(1, addedChannel.recommendationScore) / totalScore) * 100) * 100;
  const unlockedExisting = plan.channels.filter((channel) => lockedFixed[channel.channelId] === undefined);
  const lockedTotal = Object.values(lockedFixed).reduce((sum, value) => sum + value, 0);
  const existingFloors = allocationFloors(withCandidate.channels, plan.workingMediaBudget, { ...lockedFixed, [channelId]: 0 });
  const otherMinimums = unlockedExisting.reduce(
    (sum, channel) => sum + (existingFloors.get(channel.channelId) ?? effectiveBounds(channel, plan.workingMediaBudget).minimum),
    0,
  );
  const otherMaximums = unlockedExisting.reduce(
    (sum, channel) => sum + effectiveBounds(channel, plan.workingMediaBudget).maximum,
    0,
  );
  const feasibleMinimum = Math.max(bounds.minimum, TOTAL_BASIS_POINTS - lockedTotal - otherMaximums);
  const feasibleMaximum = Math.max(bounds.minimum, Math.min(bounds.maximum, TOTAL_BASIS_POINTS - lockedTotal - otherMinimums));
  const target = Math.min(feasibleMaximum, Math.max(feasibleMinimum, weightedTarget));
  const next = rebalanceBasisPoints(withCandidate, { ...lockedFixed, [channelId]: target });
  const applied = applyBasisPointAllocations(
    withCandidate,
    next,
    `Planner added ${candidate.product.displayName} at ${formatPercent(next[channelId])}; other unlocked allocations funded it without changing the working-media budget.`,
  );
  return {
    ...applied,
    allocationAudit: [
      ...applied.allocationAudit,
      { type: "selection", channelId, detail: `Planner manually added ${candidate.product.displayName} and preserved the existing selected portfolio.` },
    ],
  };
}

export function removeMediaTypeAndRebalance(
  plan: MediaRecommendationPlan,
  channelId: string,
  lockedChannelIds: string[] = [],
): MediaRecommendationPlan {
  const removed = plan.channels.find((channel) => channel.channelId === channelId);
  if (!removed) return plan;
  const remainingChannels = plan.channels.filter((channel) => channel.channelId !== channelId);
  if (remainingChannels.length === 0) throw new Error("At least one media type must remain in the plan.");
  const withoutChannel: MediaRecommendationPlan = {
    ...plan,
    channels: remainingChannels,
    selectedMediaTypeCount: remainingChannels.length,
  };
  const current = allocationBasisPoints(withoutChannel);
  const fixed: AllocationBasisPoints = {};
  lockedChannelIds.forEach((id) => {
    if (current[id] !== undefined) fixed[id] = current[id];
  });
  const next = rebalanceBasisPoints(withoutChannel, fixed);
  const applied = applyBasisPointAllocations(
    withoutChannel,
    next,
    `Planner removed ${removed.channelName}; its allocation was redistributed across unlocked media types without changing the working-media budget.`,
  );
  return {
    ...applied,
    allocationAudit: [
      ...applied.allocationAudit,
      { type: "exclusion", channelId, detail: `Planner manually removed ${removed.channelName}.` },
    ],
  };
}

export function allocationsEqual(a: AllocationBasisPoints | undefined, b: AllocationBasisPoints | undefined): boolean {
  const left = a || {};
  const right = b || {};
  const ids = Array.from(new Set([...Object.keys(left), ...Object.keys(right)]));
  return ids.every((id) => roundBasisPoints(left[id]) === roundBasisPoints(right[id]));
}
