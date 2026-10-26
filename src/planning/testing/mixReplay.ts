import { buildCampaignFacts, buildMediaRecommendationPlan, profileSignals } from "../engine";
import { DEFAULT_PLANNING_SETTINGS, migrateStoredSettings, validatePlanningSettings } from "../settings";
import type { AiCandidateSignal, MediaRecommendationPlan } from "../types";

// Replays saved plans through the current engine, offline, so a change to channel selection or
// allocation can be judged on real briefs before it ships. The AI's scores are taken from the
// saved candidates rather than asked for again: a fresh model call would move the scores and hide
// what the engine change itself did.

export interface ReplayableInputs {
  facts: ReturnType<typeof buildCampaignFacts>;
  signals: AiCandidateSignal[];
}

export interface MixSummary {
  id: string;
  title: string;
  budget: number;
  flightDays: number | null;
  primaryKpi: string;
  cap: number;
  channels: Array<{ channelId: string; name: string; percent: number; score: number }>;
}

export type ReplayOutcome =
  | { ok: true; inputs: ReplayableInputs; stored: MixSummary }
  | { ok: false; id: string; title: string; reason: string };

function payloadOf(record: any): any {
  if (typeof record?.payload === "string") {
    try { return JSON.parse(record.payload); } catch { return null; }
  }
  return record?.payload ?? null;
}

export function summarizeMix(id: string, title: string, plan: MediaRecommendationPlan, primaryKpi: string): MixSummary {
  return {
    id,
    title,
    budget: plan.workingMediaBudget,
    flightDays: plan.flightDays,
    primaryKpi,
    cap: plan.maxMediaTypes,
    channels: plan.channels
      .filter((channel) => channel.allocationPercent > 0)
      .map((channel) => ({ channelId: channel.channelId, name: channel.channelName, percent: channel.allocationPercent, score: channel.recommendationScore }))
      .sort((a, b) => b.percent - a.percent || a.channelId.localeCompare(b.channelId)),
  };
}

/**
 * The engine inputs a saved plan was built from. Only new plans replay exactly: plans built on an
 * uploaded RFP do not keep the uploaded line items, and a planner's hand edits to allocation are
 * not something the engine produced, so both are reported as skipped rather than guessed at.
 */
export function replayInputsFromRecord(record: any): ReplayOutcome {
  const id = String(record?.id || "unknown");
  const title = String(record?.title || "Untitled plan");
  const payload = payloadOf(record);
  const strategy = payload?.profile?.channelStrategy;
  const mediaPlan: MediaRecommendationPlan | undefined = strategy?.mediaPlan;
  if (record?.archived) return { ok: false, id, title, reason: "archived" };
  if (!mediaPlan?.evaluatedCandidates?.length) return { ok: false, id, title, reason: "no channel plan saved" };
  if (mediaPlan.planningMode !== "greenfield") return { ok: false, id, title, reason: `built on an uploaded RFP (${mediaPlan.planningMode}); the line items are not saved` };
  if (strategy.hasManualAllocationChanges) return { ok: false, id, title, reason: "allocation was edited by hand" };

  const validated = validatePlanningSettings(migrateStoredSettings(payload.planningSettings));
  const planningSettings = validated.valid && validated.settings ? validated.settings : DEFAULT_PLANNING_SETTINGS;
  const signals = profileSignals(payload.profile);
  const facts = buildCampaignFacts({
    advertiserName: payload.profile?.briefOfRecord?.advertiser || "",
    audienceType: payload.profile?.briefOfRecord?.audienceType,
    kpis: Array.isArray(payload.kpis) ? payload.kpis : [],
    campaignFocus: payload.campaignFocus,
    additionalContext: payload.additionalContext,
    audienceDescriptions: signals.audienceDescriptions,
    audienceSignals: signals.audienceSignals,
    geography: payload.geography || "United States",
    workingMediaBudget: mediaPlan.workingMediaBudget,
    campaignFlightDays: mediaPlan.flightDays,
    planningMode: "greenfield",
    requiredChannelIds: strategy.manualIncludedChannelIds || [],
    excludedChannelIds: strategy.manualExcludedChannelIds || [],
    planningSettings,
    ctvPublishers: payload.profile?.ctvPublishers,
  });
  const aiSignals: AiCandidateSignal[] = mediaPlan.evaluatedCandidates
    .filter((candidate) => candidate.aiAssessed)
    .map((candidate) => ({
      channelId: candidate.product.id,
      role: candidate.aiRole,
      components: candidate.components,
      gapAddressed: candidate.gapAddressed,
      evidence: candidate.evidence,
      activationGuidance: candidate.activationGuidance,
      measurementApproach: candidate.measurementApproach,
      tradeoffs: candidate.tradeoffs,
      allocationRationale: candidate.allocationRationale,
      decisionRule: candidate.decisionRule,
    }));
  return { ok: true, inputs: { facts, signals: aiSignals }, stored: summarizeMix(id, title, mediaPlan, facts.primaryKpi) };
}

export function replayMix(id: string, title: string, inputs: ReplayableInputs): MixSummary {
  return summarizeMix(id, title, buildMediaRecommendationPlan(inputs.facts, inputs.signals), inputs.facts.primaryKpi);
}

/** 1 / sum of squared shares: 8 equal channels is 8.0; one channel with 70% of the budget pulls it toward 2. */
export function effectiveChannelCount(mix: MixSummary): number {
  const shares = mix.channels.map((channel) => channel.percent / 100);
  const sumOfSquares = shares.reduce((sum, share) => sum + share * share, 0);
  return sumOfSquares > 0 ? 1 / sumOfSquares : 0;
}

export function sameSelection(a: MixSummary, b: MixSummary): boolean {
  const ids = (mix: MixSummary) => mix.channels.map((channel) => channel.channelId).sort().join("|");
  return ids(a) === ids(b);
}
