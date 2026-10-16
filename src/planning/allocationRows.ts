import type { ChannelStrategyData } from "../types";
import type { EvaluatedMediaCandidate, EvidenceItem, RfpBaselineLine } from "./types";

/**
 * The Channel Allocation table's rows, built once from a saved channel strategy so the page,
 * the share link, Copy Summary and the Markdown export all say the same thing.
 *
 * Every RFP media type always lands somewhere: funded in the allocation, kept at its RFP
 * dollars ("Add on top of RFP"), or listed as not funded with the reason. A client's channel
 * never quietly disappears from the page.
 */

export type ChannelSource = "rfp" | "scoutai" | "planner";

export interface AllocationRow {
  channelId: string;
  channelName: string;
  source: ChannelSource;
  /** Funded in the plan's allocation (mediaPlan.channels). */
  inAllocation: boolean;
  /** "Add on top of RFP": an RFP media type held at its RFP dollars, outside the allocated budget. */
  keptAtRfp: boolean;
  /** Plan dollars. For a kept RFP media type, its RFP dollars; null when an older plan never recorded them. */
  dollars: number | null;
  /** Share of the plan total the table shows (allocated budget plus any kept RFP dollars). */
  percentOfTotal: number | null;
  /** The RFP's dollars for this media type; null for new media types or plans without a baseline. */
  rfpDollars: number | null;
  /** dollars - rfpDollars, for RFP media types whose RFP dollars are known. */
  changeDollars: number | null;
  /** 0-100. Null when the engine scored the media type without AI reasoning. */
  score: number | null;
  audienceFit: number | null;
  goalMatch: number | null;
  evidence: string;
  why: string;
  whyLabel: string;
  minimumSpend: number;
}

export interface AllocationView {
  hasRfp: boolean;
  /** What the table totals to: the allocated budget plus RFP dollars kept outside it. */
  planTotal: number;
  allocatedBudget: number;
  /** RFP media types in the plan, funded or kept at their RFP dollars. */
  rfpRows: AllocationRow[];
  /** Media types the plan added beyond the RFP, by ScoutAI or the planner. */
  addedRows: AllocationRow[];
  /** RFP media types the plan does not fund, with why. */
  rfpNotFunded: AllocationRow[];
  /** Qualified media types ScoutAI would add, best first. The share link's upsell list. */
  recommendedAdditions: AllocationRow[];
  summary: { rfpCount: number; rfpFunded: number; scoutAdded: number; plannerAdded: number };
  unmatchedLines: RfpBaselineLine[];
}

export const WHY_LABELS = {
  funded: "Why it earns a spot",
  notFunded: "Why ScoutAI moved this budget",
  addition: "Why add it",
} as const;

// Evidence the reasoning layer found, ahead of the engine's own stock lines ("X is live",
// "appears in the uploaded baseline"), which say nothing about the audience.
const STOCK_EVIDENCE: Array<EvidenceItem["sourceType"]> = ["digital_remedy_rule", "brief", "uploaded_plan", "assumption"];

function leadEvidence(evidence: EvidenceItem[] | undefined): string {
  const items = evidence || [];
  return (items.find((item) => !STOCK_EVIDENCE.includes(item.sourceType)) || items[0])?.detail || "";
}

// Reasons are written for whoever reads the plan, often the client, so the engine's internal
// phrasing of a planner removal is replaced with what happened.
function notFundedReason(candidate: EvaluatedMediaCandidate | undefined): string {
  const failure = candidate?.eligibilityFailures[0];
  if (failure === "Product was explicitly excluded by the planner.") return "Removed from this plan by your Digital Remedy planner.";
  return failure
    || candidate?.prerequisites[0]
    || "The budget does more for the campaign goal in the media types this plan funds.";
}

function rfpChannelIds(strategy: ChannelStrategyData): string[] {
  const baseline = strategy.mediaPlan?.rfpBaseline;
  if (baseline) return baseline.channels.map((channel) => channel.channelId);
  // Plans saved before the baseline existed only recorded which media types the RFP had.
  return (strategy.rfpChannels || []).map((channel) => channel.channelId).filter((id): id is string => Boolean(id));
}

export function buildAllocationView(strategy: ChannelStrategyData): AllocationView {
  const plan = strategy.mediaPlan;
  const candidates = plan?.evaluatedCandidates || [];
  const candidateById = new Map(candidates.map((candidate) => [candidate.product.id, candidate]));
  const rfpIds = rfpChannelIds(strategy);
  const rfpIdSet = new Set(rfpIds);
  const baselineById = new Map((plan?.rfpBaseline?.channels || []).map((channel) => [channel.channelId, channel]));
  const plannerIds = new Set(strategy.manualIncludedChannelIds || []);
  const allocatedIds = new Set((plan?.channels || []).map((channel) => channel.channelId));
  const isIncremental = strategy.budgetStrategyMode === "incremental";
  const allocatedBudget = plan?.workingMediaBudget || 0;

  const kept = isIncremental ? rfpIds.filter((id) => !allocatedIds.has(id)) : [];
  const keptTotal = kept.reduce((sum, id) => sum + (baselineById.get(id)?.dollars || 0), 0);
  const planTotal = allocatedBudget + keptTotal;

  const scores = (candidate: EvaluatedMediaCandidate | undefined) => candidate && candidate.aiAssessed !== false
    ? { score: candidate.recommendationScore, audienceFit: Math.round(candidate.components.audienceAndPersonaFit), goalMatch: Math.round(candidate.components.kpiAndFunnelFit) }
    : { score: null, audienceFit: null, goalMatch: null };
  const sourceOf = (id: string): ChannelSource => rfpIdSet.has(id) ? "rfp" : plannerIds.has(id) ? "planner" : "scoutai";
  const rfpDollarsOf = (id: string) => rfpIdSet.has(id) && plan?.rfpBaseline ? (baselineById.get(id)?.dollars ?? 0) : null;
  const nameOf = (id: string) => candidateById.get(id)?.product.displayName || baselineById.get(id)?.channelName
    || (strategy.rfpChannels || []).find((channel) => channel.channelId === id)?.channelName || id;

  const allocatedRows: AllocationRow[] = (plan?.channels || []).map((channel) => {
    const candidate = candidateById.get(channel.channelId);
    const rfpDollars = rfpDollarsOf(channel.channelId);
    return {
      channelId: channel.channelId,
      channelName: channel.channelName,
      source: sourceOf(channel.channelId),
      inAllocation: true,
      keptAtRfp: false,
      dollars: channel.allocationDollars,
      percentOfTotal: planTotal > 0 ? (channel.allocationDollars / planTotal) * 100 : channel.allocationPercent,
      rfpDollars,
      changeDollars: rfpDollars === null ? null : Math.round((channel.allocationDollars - rfpDollars) * 100) / 100,
      ...scores(candidate),
      evidence: leadEvidence(candidate?.evidence || channel.evidence),
      why: candidate?.gapAddressed || channel.gapAddressed,
      whyLabel: WHY_LABELS.funded,
      minimumSpend: channel.minimumTotalSpend,
    };
  });

  const keptRows: AllocationRow[] = kept.map((id) => {
    const candidate = candidateById.get(id);
    const dollars = plan?.rfpBaseline ? (baselineById.get(id)?.dollars ?? 0) : null;
    return {
      channelId: id,
      channelName: nameOf(id),
      source: "rfp",
      inAllocation: false,
      keptAtRfp: true,
      dollars,
      percentOfTotal: dollars !== null && planTotal > 0 ? (dollars / planTotal) * 100 : null,
      rfpDollars: dollars,
      changeDollars: dollars === null ? null : 0,
      ...scores(candidate),
      evidence: leadEvidence(candidate?.evidence),
      why: candidate?.gapAddressed || "",
      whyLabel: WHY_LABELS.funded,
      minimumSpend: candidate?.product.minimumTotalSpend || 0,
    };
  });

  const unfundedRow = (candidate: EvaluatedMediaCandidate, whyLabel: string, why: string): AllocationRow => {
    const rfpDollars = rfpDollarsOf(candidate.product.id);
    return {
      channelId: candidate.product.id,
      channelName: candidate.product.displayName,
      source: sourceOf(candidate.product.id),
      inAllocation: false,
      keptAtRfp: false,
      dollars: 0,
      percentOfTotal: 0,
      rfpDollars,
      changeDollars: rfpDollars === null ? null : -rfpDollars,
      ...scores(candidate),
      evidence: leadEvidence(candidate.evidence),
      why,
      whyLabel,
      minimumSpend: candidate.product.minimumTotalSpend,
    };
  };

  const byDollars = (a: AllocationRow, b: AllocationRow) => (b.dollars ?? 0) - (a.dollars ?? 0) || a.channelName.localeCompare(b.channelName);
  const rfpRows = [...allocatedRows.filter((row) => row.source === "rfp"), ...keptRows].sort(byDollars);
  const addedRows = allocatedRows.filter((row) => row.source !== "rfp").sort(byDollars);
  const placed = new Set([...allocatedIds, ...kept]);

  const rfpNotFunded = rfpIds
    .filter((id) => !placed.has(id))
    .map((id) => {
      const candidate = candidateById.get(id);
      if (candidate) return unfundedRow(candidate, WHY_LABELS.notFunded, notFundedReason(candidate));
      // An RFP media type the catalog no longer offers still shows, without scores.
      return {
        channelId: id, channelName: nameOf(id), source: "rfp" as const, inAllocation: false, keptAtRfp: false,
        dollars: 0, percentOfTotal: 0, rfpDollars: rfpDollarsOf(id), changeDollars: null,
        score: null, audienceFit: null, goalMatch: null, evidence: "",
        why: "This media type is not in the current Digital Remedy catalog.", whyLabel: WHY_LABELS.notFunded, minimumSpend: 0,
      };
    });

  const recommendedAdditions = candidates
    .filter((candidate) =>
      !placed.has(candidate.product.id)
      && !rfpIdSet.has(candidate.product.id)
      && (candidate.status === "ADD" || candidate.status === "TEST")
      && candidate.eligibilityFailures.length === 0
      && candidate.aiAssessed !== false)
    .sort((a, b) => b.recommendationScore - a.recommendationScore || a.product.displayName.localeCompare(b.product.displayName))
    .map((candidate) => unfundedRow(candidate, WHY_LABELS.addition, candidate.gapAddressed));

  return {
    hasRfp: rfpIds.length > 0,
    planTotal,
    allocatedBudget,
    rfpRows,
    addedRows,
    rfpNotFunded,
    recommendedAdditions,
    summary: {
      rfpCount: rfpIds.length,
      rfpFunded: rfpRows.length,
      scoutAdded: addedRows.filter((row) => row.source === "scoutai").length,
      plannerAdded: addedRows.filter((row) => row.source === "planner").length,
    },
    unmatchedLines: plan?.rfpBaseline?.unmatchedLines || [],
  };
}
