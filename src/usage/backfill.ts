import type { StorageAdapter, UsageEvent } from "../storage/types";
import { planBudgetFields } from "./dashboard";

/**
 * One-time import of history from saved plans, so the dashboard is not empty before the usage
 * log has built up. Every finished run has been saved as a plan, so each plan stands for one
 * generation, dated and attributed as the plan was. A plan with a share token was shared at
 * some point; when is not recorded, so its last update stands in.
 *
 * Safe to run again: ids are derived from the plan, the store refuses duplicates, and plans
 * the live log already covers are skipped.
 */
export async function backfillUsageFromPlans(storage: StorageAdapter): Promise<{ plansScanned: number; generations: number; shares: number; skipped: number }> {
  const events = await storage.listUsageEvents("");
  const live = (action: string) => new Set(events.filter((e) => e.action === action && e.planId && !e.id.startsWith("backfill-")).map((e) => e.planId));
  const liveGenerated = live("plan_generate");
  const liveShared = live("share_create");
  const existingIds = new Set(events.map((e) => e.id));
  const plans = await storage.listPlans({ includeArchived: true });

  let generations = 0;
  let shares = 0;
  let skipped = 0;
  const record = async (event: UsageEvent) => {
    if (existingIds.has(event.id)) {
      skipped += 1;
      return false;
    }
    try {
      await storage.recordUsageEvent(event);
      existingIds.add(event.id);
      return true;
    } catch {
      skipped += 1;
      return false;
    }
  };

  for (let i = 0; i < plans.length; i += 8) {
    await Promise.all(plans.slice(i, i + 8).map(async (summary) => {
      if (!liveGenerated.has(summary.id)) {
        const plan = await storage.getPlan(summary.id);
        const profile = (plan?.payload as any)?.profile;
        if (plan && profile && typeof profile === "object") {
          if (await record({
            id: `backfill-gen-${plan.id}`,
            at: plan.createdAt,
            actor: plan.createdBy || "unknown",
            action: "plan_generate",
            planId: plan.id,
            advertiserName: plan.advertiserName || undefined,
            ok: true,
            detail: "backfilled",
            ...planBudgetFields(profile),
          })) generations += 1;
        }
      }
      if (summary.shareToken && !liveShared.has(summary.id)) {
        if (await record({
          id: `backfill-share-${summary.id}`,
          at: summary.updatedAt,
          actor: summary.createdBy || "unknown",
          action: "share_create",
          planId: summary.id,
          advertiserName: summary.advertiserName || undefined,
          detail: "backfilled",
        })) shares += 1;
      }
    }));
  }
  return { plansScanned: plans.length, generations, shares, skipped };
}
