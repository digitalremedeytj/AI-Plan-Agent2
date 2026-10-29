import { SHARE_VIEWER_ACTOR } from "../storage/types";
import { toPersonKey } from "../usage/usageSummary";

/**
 * The people directory: who someone is (their Google email) and every name they have been
 * recorded under.
 *
 * Before Google sign-in, a person was whatever name they typed, so one planner drifted into
 * "TJ", "tj" and "T.J. Pascal" and their plans and dashboard counts split with them. Stored
 * records are never rewritten to fix that. Instead each person lists their old names as
 * aliases, and records are resolved to the person's current display name when they are read.
 * A wrong merge is undone by removing the alias, and nothing is lost either way.
 */

export interface Person {
  /** Lowercased Google email; the person's identity. */
  email: string;
  /** The name recorded on everything they do from now on. Unique across the directory. */
  displayName: string;
  /** Older names whose records belong to this person. */
  aliases: string[];
  firstSignInAt?: string;
}

export interface PeopleRecord {
  /** Compare-and-swap counter; 0 means nobody has been saved yet. */
  revision: number;
  people: Person[];
  updatedAt: string;
  updatedBy: string;
}

export const EMPTY_PEOPLE: PeopleRecord = { revision: 0, people: [], updatedAt: "", updatedBy: "" };

const MAX_NAME_LENGTH = 60;
const MAX_ALIASES = 30;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

const cleanName = (raw: unknown) => (typeof raw === "string" ? raw.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, MAX_NAME_LENGTH) : "");

/** Names that are never a person, so they can never be claimed as an alias. */
const NOT_PEOPLE = new Set(["unknown", "system", toPersonKey(SHARE_VIEWER_ACTOR)]);

export interface PeopleIndex {
  byEmail: Map<string, Person>;
  byName: Map<string, Person>;
}

export function indexPeople(people: Person[]): PeopleIndex {
  const byEmail = new Map<string, Person>();
  const byName = new Map<string, Person>();
  for (const person of people) {
    byEmail.set(normalizeEmail(person.email), person);
    for (const name of [person.displayName, ...person.aliases]) {
      const key = toPersonKey(name);
      if (key && !byName.has(key)) byName.set(key, person);
    }
  }
  return { byEmail, byName };
}

/** The person's current display name for a recorded name, or the name itself if nobody claims it. */
export function canonicalName(index: PeopleIndex, name: string): string {
  if (!name) return name;
  return index.byName.get(toPersonKey(name))?.displayName ?? name;
}

/** Records with their actor resolved, for anything that groups or filters by person. */
export function withCanonicalActors<T extends { actor: string }>(records: T[], index: PeopleIndex): T[] {
  if (index.byName.size === 0) return records;
  return records.map((r) => {
    const actor = canonicalName(index, r.actor);
    return actor === r.actor ? r : { ...r, actor };
  });
}

export function withCanonicalAuthors<T extends { createdBy: string; updatedBy: string }>(records: T[], index: PeopleIndex): T[] {
  if (index.byName.size === 0) return records;
  return records.map((r) => ({ ...r, createdBy: canonicalName(index, r.createdBy), updatedBy: canonicalName(index, r.updatedBy) }));
}

export function isAllowedEmail(email: string, allowedDomains: string[]): boolean {
  const domain = normalizeEmail(email).split("@")[1] || "";
  return allowedDomains.includes(domain);
}

/**
 * Records someone signing in with Google for the first time. An admin may have added them ahead
 * of time, with their old names already linked; then that entry is theirs as it stands. Otherwise
 * their display name is their Google name, made unique if another person already uses it. If that
 * name was only ever typed at the old sign-in and nobody claims it, it becomes theirs, which merges
 * their old records.
 */
export function ensurePerson(
  people: Person[],
  email: string,
  googleName: string,
  now: string,
): { people: Person[]; person: Person; changed: boolean } {
  const key = normalizeEmail(email);
  const existing = people.find((p) => normalizeEmail(p.email) === key);
  if (existing?.firstSignInAt) return { people, person: existing, changed: false };
  if (existing) {
    const person = { ...existing, firstSignInAt: now };
    return { people: people.map((p) => (p === existing ? person : p)), person, changed: true };
  }

  const index = indexPeople(people);
  const localPart = key.split("@")[0];
  const base = cleanName(googleName) || localPart;
  const displayName = index.byName.has(toPersonKey(base)) ? cleanName(`${base} (${localPart})`) : base;
  const person: Person = { email: key, displayName, aliases: [], firstSignInAt: now };
  return { people: [...people, person], person, changed: true };
}

/**
 * Reads a pasted list of people to add ahead of their first sign-in, one per line, as
 * "Jane Doe, jane@x.com", "Jane Doe <jane@x.com>" or a bare email (named after its local part).
 */
export function parsePeopleList(text: string): { people: Array<{ email: string; displayName: string }>; invalid: string[] } {
  const people: Array<{ email: string; displayName: string }> = [];
  const invalid: string[] = [];
  for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const match = /[^\s<>,;"']+@[^\s<>,;"']+\.[^\s<>,;"']+/.exec(line);
    if (!match) {
      invalid.push(line);
      continue;
    }
    const email = normalizeEmail(match[0]);
    const name = cleanName(line.replace(match[0], " ").replace(/[<>,;"()\t]/g, " ").replace(/\s+/g, " "));
    people.push({ email, displayName: name || email.split("@")[0] });
  }
  return { people, invalid };
}

/**
 * Validates an admin's edit of the directory against what is stored. An admin may add people ahead
 * of their first Google sign-in (in an allowed domain), and remove them again until they sign in;
 * someone who has signed in is never removed here. A renamed person who has signed in keeps their
 * old display name as an alias, because their past records were written under it.
 */
export function applyPeopleEdit(stored: Person[], edited: unknown, allowedDomains: string[]): { people: Person[] } | { error: string } {
  if (!Array.isArray(edited)) return { error: "The people list is missing." };
  const byEmail = new Map(stored.map((p) => [normalizeEmail(p.email), p]));
  const people: Person[] = [];
  const claimedBy = new Map<string, string>();
  const seen = new Set<string>();

  for (const raw of edited as any[]) {
    const email = typeof raw?.email === "string" ? normalizeEmail(raw.email) : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: `"${email || "(blank)"}" is not an email address.` };
    if (seen.has(email)) return { error: `${email} is listed twice.` };
    seen.add(email);
    const current = byEmail.get(email) ?? { email, displayName: "", aliases: [] };
    if (!byEmail.has(email) && !isAllowedEmail(email, allowedDomains)) {
      return { error: `${email} cannot sign in: only ${allowedDomains.map((d) => `@${d}`).join(" or ")} accounts can.` };
    }
    const displayName = cleanName(raw.displayName);
    if (!displayName) return { error: `${email} needs a display name.` };

    const aliases = (Array.isArray(raw.aliases) ? raw.aliases : []).map(cleanName).filter(Boolean);
    if (current.firstSignInAt && toPersonKey(current.displayName) !== toPersonKey(displayName)) aliases.push(current.displayName);
    const unique = new Map<string, string>();
    for (const alias of aliases) {
      const key = toPersonKey(alias);
      if (key !== toPersonKey(displayName) && !unique.has(key)) unique.set(key, alias);
    }
    if (unique.size > MAX_ALIASES) return { error: `${email} has more than ${MAX_ALIASES} other names.` };

    for (const name of [displayName, ...unique.values()]) {
      const key = toPersonKey(name);
      if (NOT_PEOPLE.has(key)) return { error: `"${name}" is a placeholder the app writes, not a person's name.` };
      const owner = claimedBy.get(key);
      if (owner && owner !== email) return { error: `"${name}" is given to both ${owner} and ${email}. A name can belong to one person.` };
      claimedBy.set(key, email);
    }
    people.push({ ...current, displayName, aliases: [...unique.values()] });
    byEmail.delete(email);
  }
  // Someone who has signed in is kept even if the edit left them out; their records are theirs.
  for (const person of byEmail.values()) {
    if (!person.firstSignInAt) continue;
    for (const name of [person.displayName, ...person.aliases]) {
      const owner = claimedBy.get(toPersonKey(name));
      if (owner) return { error: `"${name}" already belongs to ${person.email}.` };
    }
    people.push(person);
  }
  return { people };
}
