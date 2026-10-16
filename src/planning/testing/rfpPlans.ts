import type { ChannelStrategyData, ParsedPlanOption } from "../../types";
import { resolveStrategyBudget, type BudgetStrategyMode } from "../budgetStrategy";
import { buildCampaignFacts, buildMediaRecommendationPlan } from "../engine";
import { clonePlanningSettings, DEFAULT_PLANNING_SETTINGS } from "../settings";

// Test fixtures only: an engine-built plan for a $50,000 RFP (CTV $30,000, DOOH $20,000) in
// each budget approach, shared by the tests that check every surface reads the same total.

export const RFP_OPTIONS: ParsedPlanOption[] = [{
  id: "rfp",
  name: "RFP",
  selected: true,
  budget: 50_000,
  rawChannels: [],
  lineItemsCount: 2,
  placements: [
    { mediaType: "Video", productType: "OTT", budget: 30_000 },
    { mediaType: "Digital Out of Home", productType: "DOOH", budget: 20_000 },
  ],
}];

export function rfpStrategy(mode: BudgetStrategyMode, additional = 0): ChannelStrategyData {
  const budget = resolveStrategyBudget(mode, 50_000, additional);
  const mediaPlan = buildMediaRecommendationPlan(buildCampaignFacts({
    kpis: ["awareness", "reach"],
    audienceDescriptions: ["Streaming and out-of-home audiences"],
    workingMediaBudget: budget.allocatedBudget,
    campaignFlightDays: 30,
    geography: "United States",
    planningMode: mode,
    selectedPlanOptions: RFP_OPTIONS,
    planningSettings: clonePlanningSettings(DEFAULT_PLANNING_SETTINGS),
  }));
  // A real plan's candidates all carry AI reasoning; these engine-only plans are marked to match.
  mediaPlan.evaluatedCandidates = mediaPlan.evaluatedCandidates.map((candidate) => ({ ...candidate, aiAssessed: true }));
  return {
    rfpChannels: [],
    scoutAiRecommendedChannels: [],
    executiveInsight: "",
    budgetStrategyMode: mode,
    additionalBudget: budget.additionalBudget,
    rfpMediaBudget: 50_000,
    totalRfpBudget: mediaPlan.workingMediaBudget,
    analyzedPlanNames: ["RFP"],
    generatedAt: "2026-10-15T00:00:00.000Z",
    mediaPlan,
  };
}
