import { resolveEffectiveProducts } from "./effectiveProducts";
import type { PlanningSettings } from "./settings";
import type { MediaRecommendationPlan } from "./types";

/**
 * The brief-level media-type picker. Campaign Focus only sets emphasis, so before this a
 * planner who wanted "CTV and Retargeting, nothing else" had no way to say so until after
 * generation. Picks become planner-required channels (which the engine funds even below
 * product minimums); "use only these" additionally excludes every other media type, so the
 * engine's automatic fill up to the budget tier's cap has nothing else to add.
 */

export interface BriefMediaTypeOption {
  id: string;
  displayName: string;
  minimumTotalSpend: number;
  minimumNormalized30DaySpend: number;
}

/** Media types a planner can pick: the live, sellable catalog the engine would plan from. */
export function briefMediaTypeOptions(settings: PlanningSettings): BriefMediaTypeOption[] {
  return resolveEffectiveProducts(settings)
    .filter((product) => product.digitalRemedyExecutable && product.recommendationEligible && product.status === "live")
    .map((product) => ({
      id: product.id,
      displayName: product.displayName,
      minimumTotalSpend: product.minimumTotalSpend,
      minimumNormalized30DaySpend: product.minimumNormalized30DaySpend,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Every catalog media type the planner did not pick, for "use only these". */
export function exclusionsForOnlyThese(settings: PlanningSettings, pickedIds: string[]): string[] {
  const picked = new Set(pickedIds);
  return resolveEffectiveProducts(settings).map((product) => product.id).filter((id) => !picked.has(id));
}

/**
 * Picks the budget could not fund as asked. The engine never drops a required media type for
 * budget reasons - it funds it below the product minimum instead - so without this the
 * planner would get a plan that looks normal but cannot be executed at those amounts.
 */
export function plannerPickAlerts(plan: MediaRecommendationPlan, pickedIds: string[]): string[] {
  if (pickedIds.length === 0) return [];
  const alerts: string[] = [];
  const nameFor = (id: string) =>
    plan.evaluatedCandidates.find((candidate) => candidate.product.id === id)?.product.displayName || id;
  const missing = pickedIds.filter((id) => !plan.channels.some((channel) => channel.channelId === id));
  if (plan.channels.length === 0) {
    alerts.push(`No media plan could be built for the media types you picked (${pickedIds.map(nameFor).join(", ")}). Check the allocation notes, then adjust the picks or the budget.`);
    return alerts;
  }
  if (missing.length > 0) {
    alerts.push(`${missing.map(nameFor).join(", ")} could not be planned (not currently sellable in this catalog), so ${missing.length === 1 ? "it was" : "they were"} left out.`);
  }
  for (const channel of plan.channels) {
    if (!pickedIds.includes(channel.channelId)) continue;
    const candidate = plan.evaluatedCandidates.find((item) => item.product.id === channel.channelId);
    const minimumTotal = candidate?.product.minimumTotalSpend ?? channel.minimumTotalSpend;
    const minimumMonthly = candidate?.product.minimumNormalized30DaySpend ?? 0;
    const shortfalls: string[] = [];
    if (channel.allocationDollars < minimumTotal) {
      shortfalls.push(`$${Math.round(channel.allocationDollars).toLocaleString()} against a $${minimumTotal.toLocaleString()} minimum`);
    }
    if (channel.monthlyEquivalentSpend < minimumMonthly) {
      shortfalls.push(`$${Math.round(channel.monthlyEquivalentSpend).toLocaleString()}/30 days against a $${minimumMonthly.toLocaleString()} monthly minimum`);
    }
    if (shortfalls.length > 0) {
      alerts.push(`${channel.channelName} was kept because you picked it, but the budget only funds it at ${shortfalls.join(" and ")}. Raise the budget or drop a media type before this goes to trafficking.`);
    }
  }
  return alerts;
}
