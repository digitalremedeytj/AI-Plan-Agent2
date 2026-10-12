/**
 * The share of the geography's TV households that make up the campaign's target audience.
 *
 * Precedence, highest first:
 *   1. A planner's own percentage, typed on the plan.
 *   2. Filters a planner picked from the audience share reference in Settings.
 *   3. Nothing: the whole geography (100%).
 *
 * Segment sizes would slot in between 1 and 2 once a real source exists (third-party segment
 * counts). The AI is deliberately not a source: a generated share would read exactly like a
 * measured one.
 *
 * Filters in one category are alternatives and add up (HHI $100-150K + $150K+ = 37%);
 * categories multiply as if independent (37% × 27% with kids = 10%). Real demographics are
 * correlated, so this is an estimate, which is why the result is floored.
 */
import type { AudienceNarrowing } from "../../types";
import type { ReachSettings } from "./reachSettings";

export interface AudienceShareGroup {
  category: string;
  labels: string[];
  sharePercent: number;
}

export interface AudienceShare {
  sharePercent: number;
  method: "override" | "filters" | "none";
  groups: AudienceShareGroup[];
  /** Set when the filters multiplied out below the floor and were raised to it. */
  flooredFrom: number | null;
  /** Picked filters the settings revision no longer has; they are ignored. */
  unknownFilterIds: string[];
}

const NONE: AudienceShare = { sharePercent: 100, method: "none", groups: [], flooredFrom: null, unknownFilterIds: [] };

export const MIN_OVERRIDE_PERCENT = 0.1;

export function resolveAudienceShare(narrowing: AudienceNarrowing | null | undefined, settings: ReachSettings): AudienceShare {
  if (!narrowing) return { ...NONE };

  const override = narrowing.overridePercent;
  if (typeof override === "number" && Number.isFinite(override) && override >= MIN_OVERRIDE_PERCENT) {
    return { ...NONE, sharePercent: Math.min(100, override), method: "override" };
  }

  const reference = new Map(settings.audienceShareReference.map((filter) => [filter.id, filter]));
  const ids = Array.from(new Set(Array.isArray(narrowing.filterIds) ? narrowing.filterIds : []));
  const unknownFilterIds = ids.filter((id) => !reference.has(id));
  const byCategory = new Map<string, AudienceShareGroup>();
  for (const id of ids) {
    const filter = reference.get(id);
    if (!filter) continue;
    const group = byCategory.get(filter.category) || { category: filter.category, labels: [], sharePercent: 0 };
    group.labels.push(filter.label);
    group.sharePercent = Math.min(100, group.sharePercent + filter.sharePercent);
    byCategory.set(filter.category, group);
  }

  const groups = Array.from(byCategory.values());
  if (groups.length === 0) return { ...NONE, unknownFilterIds };

  const multiplied = groups.reduce((share, group) => share * (group.sharePercent / 100), 1) * 100;
  const floor = settings.minimumAudienceSharePercent;
  return {
    sharePercent: Math.max(multiplied, floor),
    method: "filters",
    groups,
    flooredFrom: multiplied < floor ? multiplied : null,
    unknownFilterIds,
  };
}

/** One line for the overview and its breakdown, e.g. "HHI $150K+ × Children under 18 at home". */
export function describeAudienceShare(share: AudienceShare): string {
  if (share.method === "override") return "Planner-set audience share";
  if (share.method === "none") return "Whole geography";
  return share.groups.map((group) => group.labels.join(" or ")).join(" × ");
}
