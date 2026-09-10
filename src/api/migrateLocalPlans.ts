import type { SavedProfile } from "../types";
import type { PlanPayload, StoredPlan } from "./client";

/**
 * One-time import of plans saved in the browser before plans became server-side.
 *
 * Runs once per browser after sign-in. The original localStorage entry is never
 * deleted - it is copied to a backup key - so a failed or partial import can always
 * be retried or inspected. Nothing here overwrites server state: every local plan
 * becomes a new server plan attributed to whoever is signed in.
 */

export const LEGACY_PLANS_KEY = "audience_builder_saved_profiles";
export const MIGRATION_FLAG_KEY = "audience_builder_plans_migrated_v1";
export const LEGACY_BACKUP_KEY = "audience_builder_saved_profiles_backup_v1";

export interface MigrationResult {
  attempted: number;
  migrated: number;
  failed: number;
  skipped: boolean;
  errors: string[];
}

type CreatePlanFn = (input: {
  title: string;
  advertiserName?: string;
  settingsRevision: number | null;
  payload: PlanPayload;
}) => Promise<StoredPlan>;

/** Splits a legacy SavedProfile into the server-owned metadata and the opaque payload. */
export function toCreateInput(saved: SavedProfile, settingsRevision: number | null) {
  const { id, savedAt, title, advertiserName, ...payload } = saved;
  return {
    title: title?.trim() || "Untitled Plan",
    advertiserName: advertiserName?.trim() || undefined,
    settingsRevision,
    payload: payload as PlanPayload,
  };
}

export function readLegacyPlans(storage: Storage): SavedProfile[] {
  try {
    const raw = storage.getItem(LEGACY_PLANS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p) => p && typeof p === "object") : [];
  } catch {
    return [];
  }
}

export function hasMigrated(storage: Storage): boolean {
  try {
    return storage.getItem(MIGRATION_FLAG_KEY) === "true";
  } catch {
    return false;
  }
}

export async function migrateLocalPlans(
  storage: Storage,
  createPlan: CreatePlanFn,
  settingsRevision: number | null,
): Promise<MigrationResult> {
  const result: MigrationResult = { attempted: 0, migrated: 0, failed: 0, skipped: false, errors: [] };

  if (hasMigrated(storage)) {
    result.skipped = true;
    return result;
  }

  const legacy = readLegacyPlans(storage);
  if (legacy.length === 0) {
    // Nothing to import, but still flag it so we do not re-scan on every load.
    safeSet(storage, MIGRATION_FLAG_KEY, "true");
    result.skipped = true;
    return result;
  }

  result.attempted = legacy.length;

  // Oldest first, so the shared list ends up in the same order the user saved them.
  for (const saved of [...legacy].reverse()) {
    try {
      await createPlan(toCreateInput(saved, settingsRevision));
      result.migrated += 1;
    } catch (err: any) {
      result.failed += 1;
      result.errors.push(`${saved.title || saved.id || "untitled"}: ${err?.message || String(err)}`);
    }
  }

  // Only claim the migration is done if nothing failed; otherwise the user can retry
  // on the next load rather than losing the plans that did not make it.
  if (result.failed === 0) {
    safeSet(storage, LEGACY_BACKUP_KEY, storage.getItem(LEGACY_PLANS_KEY) || "[]");
    safeSet(storage, MIGRATION_FLAG_KEY, "true");
  }

  return result;
}

function safeSet(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch (err) {
    console.warn(`[MIGRATION] Could not write ${key} to localStorage:`, err);
  }
}
