import type {
  ChannelPlanRecommendation,
  EvaluatedMediaCandidate,
  MediaRecommendationPlan,
} from "./types";

export type AllocationBasisPoints = Record<string, number>;

const TOTAL_BASIS_POINTS = 10_000;

function roundBasisPoints(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value / 100) * 100;
}

function effectiveBounds(channel: ChannelPlanRecommendation, totalBudget: number) {
  const spendMinimumPercent = totalBudget > 0
    ? (channel.minimumTotalSpend / totalBudget) * 100
    : 100;
  return {
    minimum: Math.ceil(Math.max(channel.minimumAllocationPercent, spendMinimumPercent)) * 100,
    maximum: Math.floor(channel.maximumAllocationPercent) * 100,
  };
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
): AllocationBasisPoints {
  if (plan.channels.length === 0) return {};
  const channelsById = new Map(plan.channels.map((channel) => [channel.channelId, channel]));
  const current = rawAllocationBasisPoints(plan);
  const next: AllocationBasisPoints = {};

  Object.entries(fixedBasisPoints).forEach(([channelId, rawValue]) => {
    const channel = channelsById.get(channelId);
    if (!channel) throw new Error("That media type is no longer part of the selected plan.");
    const value = roundBasisPoints(rawValue);
    const bounds = effectiveBounds(channel, plan.workingMediaBudget);
    if (value < bounds.minimum || value > bounds.maximum) {
      throw new Error(
        `${channel.channelName} must stay between ${formatPercent(bounds.minimum)} and ${formatPercent(bounds.maximum)} for this budget.`,
      );
    }
    next[channelId] = value;
  });

  const adjustable = plan.channels.filter((channel) => fixedBasisPoints[channel.channelId] === undefined);
  adjustable.forEach((channel) => {
    next[channel.channelId] = effectiveBounds(channel, plan.workingMediaBudget).minimum;
  });

  let remaining = TOTAL_BASIS_POINTS - Object.values(next).reduce((sum, value) => sum + value, 0);
  if (remaining < 0) {
    throw new Error("The locked and minimum allocations exceed 100%. Unlock or reduce another media type.");
  }

  const maximumCapacity = adjustable.reduce((sum, channel) => {
    const bounds = effectiveBounds(channel, plan.workingMediaBudget);
    return sum + Math.max(0, bounds.maximum - next[channel.channelId]);
  }, 0);
  if (remaining > maximumCapacity) {
    throw new Error("The unlocked media types cannot absorb the remaining budget without exceeding their maximums.");
  }

  while (remaining > 0) {
    const active = adjustable
      .filter((channel) => next[channel.channelId] < effectiveBounds(channel, plan.workingMediaBudget).maximum)
      .sort((a, b) => a.channelId.localeCompare(b.channelId));
    if (active.length === 0) throw new Error("No unlocked media type can absorb the remaining budget.");
    const totalWeight = active.reduce((sum, channel) => sum + Math.max(1, current[channel.channelId] || 1), 0);
    const startingRemainder = remaining;
    let distributed = 0;

    active.forEach((channel) => {
      if (remaining <= 0) return;
      const maximum = effectiveBounds(channel, plan.workingMediaBudget).maximum;
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
): AllocationBasisPoints {
  const current = allocationBasisPoints(plan);
  const fixed: AllocationBasisPoints = { [channelId]: roundBasisPoints(targetBasisPoints) };
  lockedChannelIds.forEach((lockedId) => {
    if (lockedId !== channelId && current[lockedId] !== undefined) fixed[lockedId] = current[lockedId];
  });
  return rebalanceBasisPoints(plan, fixed);
}

export function applyBasisPointAllocations(
  plan: MediaRecommendationPlan,
  basisPoints: AllocationBasisPoints,
  auditDetail: string,
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

  const dollars = allocateDollars(plan.workingMediaBudget, basisPoints);
  const channels = plan.channels.map((channel) => {
    const value = roundBasisPoints(basisPoints[channel.channelId]);
    const bounds = effectiveBounds(channel, plan.workingMediaBudget);
    if (value < bounds.minimum || value > bounds.maximum) {
      throw new Error(`${channel.channelName} is outside its allowed allocation range.`);
    }
    const allocationDollars = dollars[channel.channelId];
    return {
      ...channel,
      allocationPercent: value / 100,
      allocationDollars,
      monthlyEquivalentSpend: plan.flightDays
        ? Math.round((allocationDollars / plan.flightDays) * 30 * 100) / 100
        : allocationDollars,
      fundingSource: "Rebalanced within the fixed working media budget",
    };
  });

  return {
    ...plan,
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
  const blockingFailures = candidate.eligibilityFailures.filter((failure) => !failure.includes("explicitly excluded by the planner"));
  if (blockingFailures.length > 0) throw new Error(blockingFailures[0]);
  const conflict = plan.channels.find((channel) => {
    const selectedCandidate = plan.evaluatedCandidates.find((item) => item.product.id === channel.channelId);
    return selectedCandidate && (
      selectedCandidate.product.familyId === candidate.product.familyId ||
      selectedCandidate.product.overlapFamilyIds.includes(candidate.product.familyId) ||
      candidate.product.overlapFamilyIds.includes(selectedCandidate.product.familyId)
    );
  });
  if (conflict) throw new Error(`${candidate.product.displayName} overlaps with ${conflict.channelName}. Remove the conflicting media type first.`);

  const addedChannel = recommendationFromCandidate(candidate, plan);
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
  const otherMinimums = unlockedExisting.reduce(
    (sum, channel) => sum + effectiveBounds(channel, plan.workingMediaBudget).minimum,
    0,
  );
  const otherMaximums = unlockedExisting.reduce(
    (sum, channel) => sum + effectiveBounds(channel, plan.workingMediaBudget).maximum,
    0,
  );
  const feasibleMinimum = Math.max(bounds.minimum, TOTAL_BASIS_POINTS - lockedTotal - otherMaximums);
  const feasibleMaximum = Math.min(bounds.maximum, TOTAL_BASIS_POINTS - lockedTotal - otherMinimums);
  if (feasibleMinimum > feasibleMaximum) {
    throw new Error(`${candidate.product.displayName} cannot be funded without violating the selected media types' minimums or locked allocations.`);
  }
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
