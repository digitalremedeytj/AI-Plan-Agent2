// Deterministic checks on the CTV publisher picks. The model chooses publishers from the
// enabled pool; code makes sure what it chose is actually in that pool, appears once, and
// carries the category the admin assigned - a live run listed the same publisher twice, and
// another blended networks, apps and an OS in one taxonomy.
//
// The selection is settled before QA, like the charts. The channel strategy snapshots the
// publisher list when it is built, so a remediation that added, removed or renamed a publisher
// afterwards left the plan showing two different lists. Remediation may rewrite the 'why'.

import type { GenerationAlert } from "../types";

export interface PoolPublisher {
  name: string;
  category?: string;
  enabled?: boolean;
}

export interface PublisherPick {
  publisher: string;
  category?: string;
  why?: string;
}

/** "Discovery+" and "discovery plus" are the same publisher; so are "A&E" and "A and E". */
export function publisherKey(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/\+/g, " plus ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "");
}

/** Mutates profile.ctvPublishers in place and returns what the plan should tell the planner. */
export function settlePublisherSelection(profile: any, pool: PoolPublisher[], targetCount: number): GenerationAlert[] {
  const alerts: GenerationAlert[] = [];
  const byKey = new Map(pool.filter((p) => p && p.name && p.enabled !== false).map((p) => [publisherKey(p.name), p]));
  const picks: PublisherPick[] = Array.isArray(profile?.ctvPublishers) ? profile.ctvPublishers : [];
  const seen = new Set<string>();
  const kept: PublisherPick[] = [];
  const outsidePool: string[] = [];
  const duplicates: string[] = [];

  for (const pick of picks) {
    const key = publisherKey(pick?.publisher);
    if (!key) continue;
    const record = byKey.get(key);
    if (!record) {
      outsidePool.push(String(pick.publisher));
      continue;
    }
    if (seen.has(key)) {
      duplicates.push(record.name);
      continue;
    }
    seen.add(key);
    kept.push({ ...pick, publisher: record.name, ...(record.category ? { category: record.category } : {}) });
  }

  if (profile && typeof profile === "object") profile.ctvPublishers = kept;
  if (outsidePool.length > 0) {
    alerts.push({
      section: "ctvPublishers",
      severity: "flagged",
      message: `Removed ${outsidePool.length} CTV publisher pick${outsidePool.length === 1 ? "" : "s"} that ${outsidePool.length === 1 ? "is" : "are"} not in the enabled publisher list: ${outsidePool.join(", ")}.`,
    });
  }
  if (duplicates.length > 0) {
    alerts.push({
      section: "ctvPublishers",
      severity: "flagged",
      message: `Removed duplicate CTV publisher pick${duplicates.length === 1 ? "" : "s"}: ${[...new Set(duplicates)].join(", ")}.`,
    });
  }
  if (kept.length < targetCount && picks.length > 0) {
    alerts.push({
      section: "ctvPublishers",
      severity: "flagged",
      message: `${kept.length} of the ${targetCount} requested CTV publishers remain after removing picks outside the enabled list or repeated.`,
    });
  }
  return alerts;
}

/**
 * Puts the settled selection back after remediation: same publishers, same order, same
 * categories. A rewritten 'why' for a publisher that is still selected is kept.
 */
export function restorePublisherSelection(target: any, settled: PublisherPick[]): { changed: boolean } {
  const rewritten: PublisherPick[] = Array.isArray(target?.ctvPublishers) ? target.ctvPublishers : [];
  const whyByKey = new Map(rewritten.map((p) => [publisherKey(p?.publisher), typeof p?.why === "string" ? p.why.trim() : ""]));
  const restored = settled.map((pick) => {
    const why = whyByKey.get(publisherKey(pick.publisher));
    return why ? { ...pick, why } : { ...pick };
  });
  const changed = rewritten.length !== settled.length
    || rewritten.some((p, i) => publisherKey(p?.publisher) !== publisherKey(settled[i]?.publisher) || p?.category !== settled[i]?.category);
  if (target && typeof target === "object") target.ctvPublishers = restored;
  return { changed };
}

/**
 * A client's media plan that names CTV publishers: those in the enabled pool lead the plan's list,
 * marked as the client's, followed by the picks already there, up to the target count. Uploaded
 * publishers are never dropped to fit. Returns the picks unchanged when the upload names none.
 */
export function withUploadedPublishers(
  picks: PublisherPick[],
  uploadedNames: string[],
  pool: PoolPublisher[],
  targetCount: number,
): PublisherPick[] {
  const byKey = new Map(pool.filter((p) => p && p.name && p.enabled !== false).map((p) => [publisherKey(p.name), p]));
  const seen = new Set<string>();
  const uploaded: PublisherPick[] = [];
  for (const name of uploadedNames) {
    const record = byKey.get(publisherKey(name));
    if (!record || seen.has(publisherKey(record.name))) continue;
    seen.add(publisherKey(record.name));
    uploaded.push({ publisher: record.name, ...(record.category ? { category: record.category } : {}), why: "Part of your media plan." });
  }
  if (uploaded.length === 0) return picks;
  const rest = picks.filter((pick) => !seen.has(publisherKey(pick?.publisher)));
  return [...uploaded, ...rest.slice(0, Math.max(0, targetCount - uploaded.length))];
}
