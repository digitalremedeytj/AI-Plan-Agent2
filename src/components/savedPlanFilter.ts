import { toPersonKey } from "../usage/usageSummary";

/**
 * Which saved plans the Saved tab lists.
 *
 * A plan belongs to the person who created it. The last person to save it is not its owner:
 * opening a colleague's plan and saving a tweak must not move it into your list.
 *
 * The list opens on "My plans". Search is the way to find anyone else's plan, so a search of
 * three or more characters looks across every plan whatever the person filter says.
 */

export type SavedOwnerFilter = "MINE" | "ALL" | { person: string };

export const MIN_SEARCH_CHARS = 3;

export interface FilterablePlan {
  title?: string;
  audienceDescription?: string;
  advertiserName?: string;
  geography?: string;
  campaignFocus?: string;
  url?: string;
  createdBy?: string;
}

export const isSearching = (query: string) => query.trim().length >= MIN_SEARCH_CHARS;

/** Everyone who has created a plan, A-Z, one entry per person however they capitalised it. */
export function planCreators(plans: FilterablePlan[]): string[] {
  const names = new Map<string, string>();
  for (const plan of plans) {
    const name = plan.createdBy?.trim();
    if (name && !names.has(toPersonKey(name))) names.set(toPersonKey(name), name);
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function filterSavedPlans<T extends FilterablePlan>(plans: T[], filter: SavedOwnerFilter, me: string | null, query: string): T[] {
  const q = query.trim().toLowerCase();
  if (q.length >= MIN_SEARCH_CHARS) {
    return plans.filter((p) =>
      [p.title, p.audienceDescription, p.advertiserName, p.geography, p.campaignFocus, p.url, p.createdBy]
        .some((field) => field?.toLowerCase().includes(q)),
    );
  }
  if (filter === "ALL") return plans;
  const owner = filter === "MINE" ? me : filter.person;
  if (!owner) return plans;
  const key = toPersonKey(owner);
  return plans.filter((p) => toPersonKey(p.createdBy || "") === key);
}
