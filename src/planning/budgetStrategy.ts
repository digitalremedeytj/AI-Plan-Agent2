import { findBudgetChannelTier, normalizeCampaignBudget, type PlanningSettings } from "./settings";

/**
 * How an uploaded RFP's budget is planned. The ids are stored on saved plans, so
 * "incremental" keeps its old id: plans saved in the earlier incremental mode read as
 * "Add on top of RFP", with the budget they were given treated as the additional amount.
 */
export type BudgetStrategyMode = "reallocation" | "incremental" | "grow";

export const BUDGET_STRATEGY_MODES: BudgetStrategyMode[] = ["reallocation", "incremental", "grow"];

export const BUDGET_STRATEGY_LABELS: Record<BudgetStrategyMode, string> = {
  reallocation: "Optimize RFP budget",
  incremental: "Add on top of RFP",
  grow: "Optimize total increased budget",
};

export const BUDGET_STRATEGY_DESCRIPTIONS: Record<BudgetStrategyMode, string> = {
  reallocation: "Keep the RFP's budget and re-spread it across RFP and new media types for the goal.",
  incremental: "Keep every RFP media type at its RFP dollars and spend an additional budget on new media types.",
  grow: "Add budget and re-spread the combined total across RFP and new media types for the goal.",
};

export function normalizeBudgetStrategyMode(value: unknown): BudgetStrategyMode {
  return BUDGET_STRATEGY_MODES.includes(value as BudgetStrategyMode) ? (value as BudgetStrategyMode) : "reallocation";
}

export function modeNeedsAdditionalBudget(mode: BudgetStrategyMode): boolean {
  return mode !== "reallocation";
}

export interface StrategyBudget {
  /** What the plan allocates: the RFP budget, the additional budget alone, or both together. */
  allocatedBudget: number;
  /** The additional budget the planner entered; 0 for "Optimize RFP budget". */
  additionalBudget: number;
}

/**
 * The working media budget the engine allocates for a budget choice. `rfpBudget` is the RFP's
 * media total. "Add on top of RFP" allocates only the additional budget because the RFP media
 * types keep their own dollars outside the allocation; the other two allocate one total.
 */
export function resolveStrategyBudget(mode: BudgetStrategyMode, rfpBudget: number, additionalBudget: number | undefined): StrategyBudget {
  const additional = Number(additionalBudget) > 0 ? Math.round(Number(additionalBudget) * 100) / 100 : 0;
  if (mode === "reallocation") return { allocatedBudget: rfpBudget, additionalBudget: 0 };
  if (additional <= 0) {
    throw new Error(`"${BUDGET_STRATEGY_LABELS[mode]}" needs an additional budget greater than $0.`);
  }
  return mode === "incremental"
    ? { allocatedBudget: additional, additionalBudget: additional }
    : { allocatedBudget: rfpBudget + additional, additionalBudget: additional };
}

/** The most media types the settings' budget tiers allow for a budget over a flight. */
export function mediaTypeCapFor(budget: number, flightDays: number | null | undefined, settings: PlanningSettings): number {
  if (!(budget > 0)) return 0;
  return findBudgetChannelTier(normalizeCampaignBudget(budget, flightDays ?? null).normalized30DayBudget, settings).maxChannels;
}
