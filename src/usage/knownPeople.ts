import { SHARE_VIEWER_ACTOR, type PlanSummary, type UsageEvent } from "../storage/types";
import { toPersonKey } from "./usageSummary";

/**
 * The names people have signed in with, for the sign-in form's suggestions.
 *
 * Display names are typed freely, so the same person drifts into "TJ", "tj" and "T.J. Pascal",
 * and every plan and dashboard count splits with them. Suggesting the names already in use,
 * with how many plans each has, steers people back to the spelling they used before.
 */

export interface KnownPerson {
  name: string;
  plans: number;
  lastSeenAt: string;
}

/** Placeholders the app writes when it has no real person. */
const NOT_PEOPLE = new Set(["unknown", "system", toPersonKey(SHARE_VIEWER_ACTOR)]);

export function knownPeople(plans: Pick<PlanSummary, "createdBy" | "createdAt">[], events: Pick<UsageEvent, "actor" | "at">[], excludedNames: string[] = []): KnownPerson[] {
  const excluded = new Set([...NOT_PEOPLE, ...excludedNames.map(toPersonKey)]);
  const people = new Map<string, KnownPerson>();
  const see = (rawName: string | undefined, at: string, isPlan: boolean) => {
    const name = rawName?.trim();
    const key = name ? toPersonKey(name) : "";
    if (!name || excluded.has(key)) return;
    const person = people.get(key) ?? { name, plans: 0, lastSeenAt: at };
    if (isPlan) person.plans += 1;
    // The spelling used most recently wins, so a corrected name replaces an old one.
    if (at >= person.lastSeenAt) {
      person.lastSeenAt = at;
      person.name = name;
    }
    people.set(key, person);
  };
  for (const plan of plans) see(plan.createdBy, plan.createdAt, true);
  for (const event of events) see(event.actor, event.at, false);
  return [...people.values()];
}

export const MIN_SUGGESTION_CHARS = 2;
const MAX_SUGGESTIONS = 6;

/**
 * People whose name, or any word of it, starts with what was typed. Whole-name matches come
 * first, then the busiest names, so the spelling a person mostly uses is the top suggestion.
 */
export function suggestNames(people: KnownPerson[], typed: string): KnownPerson[] {
  const query = toPersonKey(typed).replace(/[^\p{L}\p{N} ]/gu, "");
  if (query.length < MIN_SUGGESTION_CHARS) return [];
  const words = (name: string) => toPersonKey(name).replace(/[^\p{L}\p{N} ]/gu, "").split(" ");
  return people
    .map((person) => {
      const key = words(person.name).join(" ");
      const rank = key.startsWith(query) ? 0 : words(person.name).some((w) => w.startsWith(query)) ? 1 : -1;
      return { person, rank };
    })
    .filter((m) => m.rank >= 0)
    .sort((a, b) => a.rank - b.rank || b.person.plans - a.person.plans || (a.person.lastSeenAt < b.person.lastSeenAt ? 1 : -1))
    .slice(0, MAX_SUGGESTIONS)
    .map((m) => m.person);
}
