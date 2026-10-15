import crypto from "crypto";
import type { PlanVersion, PlanVersionReason, PlanVersionSummary, StorageAdapter, StoredPlan } from "./types";

/**
 * Plan version history: when to take a checkpoint and how many to keep.
 *
 * Plans auto-save a couple of seconds after every edit, so "not saving" is no longer a way to
 * back out of a mistake. Checkpoints are that way back. A checkpoint always holds the plan as it
 * stood *before* the write that prompted it, so restoring one undoes everything after it.
 *
 * - "editing": at most one per CHECKPOINT_INTERVAL_MS of saves, so a long editing session leaves
 *   a checkpoint every ~15 minutes rather than one per auto-save.
 * - Before a big change (ScoutAI, QA fixes, a Campaign Recap, a restore): always, because those
 *   rewrite a lot of the plan at once and are the edits a planner most often wants to undo.
 * - "original": the plan as generation (or a first save) wrote it, taken when it is created.
 *
 * Retention keeps the oldest checkpoint (the original, for any plan made since history began)
 * plus the newest MAX_CHECKPOINTS. A plan version is about 0.4-0.5 MB, the size of the plan.
 *
 * Checkpointing never blocks the save it precedes: a failure is logged and the save goes ahead.
 */

export const CHECKPOINT_INTERVAL_MS = 15 * 60_000;
export const MAX_CHECKPOINTS = 20;

/** Whether a write for `reason` on a plan at `currentRevision` should checkpoint it first. */
export function needsCheckpoint(
  latest: Pick<PlanVersionSummary, "createdAt" | "planRevision"> | undefined,
  currentRevision: number,
  reason: PlanVersionReason,
  now: number,
): boolean {
  // This exact state is already kept.
  if (latest && latest.planRevision === currentRevision) return false;
  if (reason !== "editing") return true;
  return !latest || now - Date.parse(latest.createdAt) >= CHECKPOINT_INTERVAL_MS;
}

/** Ids to delete so that only the oldest checkpoint and the newest `max` remain. */
export function versionsToPrune(versions: Array<Pick<PlanVersionSummary, "id" | "createdAt">>, max = MAX_CHECKPOINTS): string[] {
  if (versions.length <= max + 1) return [];
  const oldestFirst = [...versions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return oldestFirst.slice(1, oldestFirst.length - max).map((v) => v.id);
}

function versionFromPlan(plan: StoredPlan, reason: PlanVersionReason, actor: string, now: Date): PlanVersion {
  // Ids sort by time, so a listing in id order is already chronological.
  const id = `${now.toISOString().replace(/[^0-9]/g, "")}-${crypto.randomBytes(3).toString("hex")}`;
  return {
    id,
    planId: plan.id,
    reason,
    createdAt: now.toISOString(),
    createdBy: actor,
    planRevision: plan.revision,
    savedAt: plan.updatedAt,
    savedBy: plan.updatedBy,
    title: plan.title,
    advertiserName: plan.advertiserName,
    settingsRevision: plan.settingsRevision,
    audienceDescription: plan.audienceDescription,
    geography: plan.geography,
    campaignFocus: plan.campaignFocus,
    url: plan.url,
    payload: plan.payload,
  };
}

/** Keeps a newly created plan as its "original" checkpoint. */
export async function recordOriginal(storage: StorageAdapter, plan: StoredPlan, actor: string, now = new Date()): Promise<void> {
  try {
    await storage.savePlanVersion(versionFromPlan(plan, "original", actor, now));
  } catch (err: any) {
    console.error(`[HISTORY] Could not keep the original of plan ${plan.id}:`, err?.message || err);
  }
}

/**
 * Call before writing a plan. `existing` is the plan as it stands, when the caller already has
 * it; otherwise it is read only if a checkpoint is actually due, so most auto-saves cost one
 * small listing.
 */
export async function checkpointBeforeWrite(
  storage: StorageAdapter,
  planId: string,
  reason: PlanVersionReason,
  actor: string,
  options: { existing?: StoredPlan; now?: Date } = {},
): Promise<void> {
  const now = options.now ?? new Date();
  try {
    const versions = await storage.listPlanVersions(planId);
    const latest = versions[0];
    // Decide on time first, so a recent checkpoint skips reading the whole plan.
    if (reason === "editing" && latest && now.getTime() - Date.parse(latest.createdAt) < CHECKPOINT_INTERVAL_MS) return;
    const existing = options.existing ?? (await storage.getPlan(planId));
    if (!existing || !needsCheckpoint(latest, existing.revision, reason, now.getTime())) return;
    const version = versionFromPlan(existing, reason, actor, now);
    await storage.savePlanVersion(version);
    for (const id of versionsToPrune([version, ...versions])) await storage.deletePlanVersion(planId, id);
  } catch (err: any) {
    console.error(`[HISTORY] Could not checkpoint plan ${planId} before a ${reason} write:`, err?.message || err);
  }
}
