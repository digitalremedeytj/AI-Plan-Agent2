import type { ChannelStrategyData } from "../types";
import { normalizeRawChannel } from "../utils/mediaTaxonomy";
import { buildAllocationView } from "./allocationRows";
import type { ChannelPlanRecommendation, EvaluatedMediaCandidate } from "./types";

/**
 * The plan's media as every summary surface should read it: the overview, the executive brief,
 * slides, the QA audit and ScoutAI.
 *
 * "Add on top of RFP" keeps each RFP media type at its RFP dollars outside mediaPlan.channels,
 * and mediaPlan.workingMediaBudget is only the additional budget. A surface that reads those two
 * fields directly understates the plan the client is shown in Channel Allocation, so this reads
 * buildAllocationView and returns the combined plan. "Use the plan as is" can also carry uploaded
 * lines outside the catalog, which count toward the total but are no media type. Every other plan
 * comes back exactly as stored (same channel objects, same percents), so nothing derived from it moves.
 */
export interface CombinedPlan {
  /** What the plan spends: the allocated budget plus any RFP dollars kept outside it. */
  total: number;
  /** mediaPlan.workingMediaBudget: the additional budget alone for "Add on top of RFP". */
  allocatedBudget: number;
  /** RFP dollars kept outside the allocation; 0 unless the plan is "Add on top of RFP". */
  keptAtRfpBudget: number;
  /** "Use the plan as is": uploaded lines that matched no media type, by label. Not in `channels`. */
  outsideCatalog: Array<{ name: string; dollars: number }>;
  outsideCatalogBudget: number;
  /**
   * Allocated channels in plan order, then RFP media types kept at their RFP dollars. When any
   * are kept, allocationPercent is re-based on `total` so the list adds to 100%.
   */
  channels: ChannelPlanRecommendation[];
  /** The kept RFP media types alone (also in `channels`), flagged keptAtRfp. */
  keptChannels: ChannelPlanRecommendation[];
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function keptChannel(
  row: { channelId: string; channelName: string; dollars: number },
  candidate: EvaluatedMediaCandidate | undefined,
  total: number,
  flightDays: number | null,
): ChannelPlanRecommendation {
  const product = candidate?.product;
  return {
    channelId: row.channelId,
    canonicalId: product?.legacyCanonicalId || normalizeRawChannel(row.channelName).canonicalId,
    channelName: row.channelName,
    familyId: product?.familyId || "",
    status: candidate?.status === "TEST" ? "TEST" : "ADD",
    recommendationScore: candidate?.recommendationScore ?? 0,
    confidence: candidate?.confidence ?? "low",
    allocationPercent: total > 0 ? round2((row.dollars / total) * 100) : 0,
    allocationDollars: row.dollars,
    monthlyEquivalentSpend: flightDays ? round2((row.dollars / flightDays) * 30) : row.dollars,
    role: product?.funnelRoles.join(" / ") || "",
    gapAddressed: candidate?.gapAddressed || "",
    evidence: candidate?.evidence || [],
    targetingTactics: candidate?.targetingTactics || [],
    publishers: candidate?.publishers || [],
    creativeEnhancements: candidate?.creativeEnhancements || [],
    inventoryControls: candidate?.inventoryControls || [],
    measurementCapabilities: candidate?.measurementCapabilities || [],
    prerequisites: candidate?.prerequisites || [],
    tradeoffs: candidate?.tradeoffs || [],
    assumptions: [],
    allocationRationale: "Kept at its RFP budget; the additional budget funds the new media types.",
    decisionRule: candidate?.decisionRule || "",
    minimumAllocationPercent: product?.minimumAllocationPercent ?? 0,
    maximumAllocationPercent: product?.maximumAllocationPercent ?? 100,
    minimumTotalSpend: product?.minimumTotalSpend ?? 0,
    typicalCpmLow: product?.typicalCpmLow ?? null,
    typicalCpmHigh: product?.typicalCpmHigh ?? null,
    fundingSource: "RFP working media, kept at RFP dollars",
    keptAtRfp: true,
  };
}

export function combinedPlan(strategy: ChannelStrategyData | null | undefined): CombinedPlan {
  const plan = strategy?.mediaPlan;
  const allocated: ChannelPlanRecommendation[] = Array.isArray(plan?.channels) ? plan!.channels : [];
  const allocatedBudget = Number(plan?.workingMediaBudget) || 0;
  const asStored: CombinedPlan = { total: allocatedBudget, allocatedBudget, keptAtRfpBudget: 0, outsideCatalog: [], outsideCatalogBudget: 0, channels: allocated, keptChannels: [] };
  if (!strategy || !plan) return asStored;
  const rebase = (total: number) => allocated.map((channel) => ({
    ...channel,
    allocationPercent: total > 0 ? round2(((channel.allocationDollars || 0) / total) * 100) : 0,
  }));

  if (strategy.budgetStrategyMode === "asIs") {
    const outside = buildAllocationView(strategy).rfpRows.filter((row) => row.outsideCatalog);
    if (outside.length === 0) return asStored;
    const outsideCatalogBudget = round2(outside.reduce((sum, row) => sum + (row.dollars || 0), 0));
    const total = round2(allocatedBudget + outsideCatalogBudget);
    return {
      ...asStored,
      total,
      outsideCatalog: outside.map((row) => ({ name: row.channelName, dollars: row.dollars || 0 })),
      outsideCatalogBudget,
      channels: rebase(total),
    };
  }
  if (strategy.budgetStrategyMode !== "incremental") return asStored;

  // Older incremental plans have no RFP baseline, so their kept rows carry no dollars; they read
  // as stored rather than inventing a total. A $0 RFP line is still in the plan, at 0%.
  const view = buildAllocationView(strategy);
  const keptRows = view.rfpRows.filter((row): row is typeof row & { dollars: number } => row.keptAtRfp && row.dollars !== null);
  if (keptRows.length === 0) return asStored;

  const total = view.planTotal;
  const candidates = new Map((plan.evaluatedCandidates || []).map((candidate) => [candidate.product.id, candidate]));
  const keptChannels = keptRows.map((row) => keptChannel(row, candidates.get(row.channelId), total, plan.flightDays ?? null));
  return {
    total,
    allocatedBudget,
    keptAtRfpBudget: round2(total - allocatedBudget),
    outsideCatalog: [],
    outsideCatalogBudget: 0,
    channels: [...rebase(total), ...keptChannels],
    keptChannels,
  };
}
