import { SHARE_VIEWER_ACTOR, type UsageEvent } from "../storage/types";

/**
 * The admin Usage report, computed from the server-side usage log.
 *
 * Pure so it can be tested without a store. Display names are typed freely at login, so
 * "TJ", "tj " and "Tj" are grouped as one person (under the spelling they used last).
 */

/** Actions the server records itself, at the route that performs them. */
export const SERVER_USAGE_ACTIONS = [
  "login",
  "plan_generate",
  "plan_create",
  "plan_archive",
  "share_create",
  "share_revoke",
  "share_view",
  "qa_audit",
  "scout_chat",
  "scout_apply",
  "exec_brief",
  "segments_generate",
  "slide_generate",
  "campaign_recap",
  "performance_upload",
  "settings_save",
] as const;

/**
 * Actions only the browser sees (nothing reaches the server for a download), reported by the
 * client. The server accepts nothing else from the client, so the log cannot be filled with
 * arbitrary action names.
 */
export const CLIENT_USAGE_ACTIONS = ["plan_open", "plan_save", "export"] as const;

export type UsageAction = (typeof SERVER_USAGE_ACTIONS)[number] | (typeof CLIENT_USAGE_ACTIONS)[number];

export const USAGE_ACTION_LABELS: Record<UsageAction, string> = {
  login: "Sign-ins",
  plan_generate: "Plans generated",
  plan_create: "Plans created",
  plan_archive: "Plans deleted",
  share_create: "Share links created",
  share_revoke: "Share links revoked",
  share_view: "Share link views",
  qa_audit: "QA audits",
  scout_chat: "ScoutAI questions",
  scout_apply: "ScoutAI changes applied or undone",
  exec_brief: "Executive briefs",
  segments_generate: "Segment recommendations",
  slide_generate: "Slides generated",
  campaign_recap: "Campaign recaps",
  performance_upload: "Performance uploads",
  settings_save: "Settings saves",
  plan_open: "Plans opened",
  plan_save: "Plans saved",
  export: "Exports",
};

export const isClientUsageAction = (value: unknown): value is (typeof CLIENT_USAGE_ACTIONS)[number] =>
  typeof value === "string" && (CLIENT_USAGE_ACTIONS as readonly string[]).includes(value);

export const toPersonKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

export interface UsagePerson {
  name: string;
  lastActiveAt: string;
  activeDays: number;
  generated: number;
  failedGenerations: number;
  shared: number;
  exports: number;
  total: number;
  actions: Record<string, number>;
}

export interface UsageAdvertiser {
  name: string;
  generated: number;
  shareViews: number;
  people: string[];
}

export interface UsageWeek {
  /** Monday of the week, YYYY-MM-DD (UTC). */
  weekStart: string;
  activePeople: number;
  generated: number;
  shareViews: number;
}

export interface UsageSummary {
  since: string;
  until: string;
  totals: Record<string, number>;
  activePeople: number;
  generation: { count: number; failed: number; medianMinutes: number | null };
  people: UsagePerson[];
  advertisers: UsageAdvertiser[];
  weeks: UsageWeek[];
}

function mondayOf(iso: string): string {
  const day = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const offset = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - offset);
  return day.toISOString().slice(0, 10);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function summarizeUsage(events: UsageEvent[], since: string, until: string): UsageSummary {
  const totals: Record<string, number> = {};
  const people = new Map<string, UsagePerson & { days: Set<string> }>();
  const advertisers = new Map<string, UsageAdvertiser & { peopleKeys: Map<string, string> }>();
  const weeks = new Map<string, { people: Set<string>; generated: number; shareViews: number }>();
  const durations: number[] = [];
  let failed = 0;

  for (const event of [...events].sort((a, b) => (a.at < b.at ? -1 : 1))) {
    if (event.at < since || event.at > until) continue;
    totals[event.action] = (totals[event.action] || 0) + 1;
    const isClient = event.actor === SHARE_VIEWER_ACTOR;
    const key = toPersonKey(event.actor);
    const generated = event.action === "plan_generate" && event.ok !== false;

    if (event.action === "plan_generate") {
      if (event.ok === false) failed += 1;
      else if (typeof event.durationMs === "number") durations.push(event.durationMs);
    }

    const weekStart = mondayOf(event.at);
    const week = weeks.get(weekStart) ?? { people: new Set<string>(), generated: 0, shareViews: 0 };
    if (!isClient) week.people.add(key);
    if (generated) week.generated += 1;
    if (event.action === "share_view") week.shareViews += 1;
    weeks.set(weekStart, week);

    if (!isClient && key) {
      const person = people.get(key) ?? {
        name: event.actor.trim(), lastActiveAt: event.at, activeDays: 0, generated: 0, failedGenerations: 0,
        shared: 0, exports: 0, total: 0, actions: {}, days: new Set<string>(),
      };
      person.name = event.actor.trim();
      person.lastActiveAt = event.at;
      person.days.add(event.at.slice(0, 10));
      person.total += 1;
      person.actions[event.action] = (person.actions[event.action] || 0) + 1;
      if (generated) person.generated += 1;
      if (event.action === "plan_generate" && event.ok === false) person.failedGenerations += 1;
      if (event.action === "share_create") person.shared += 1;
      if (event.action === "export") person.exports += 1;
      people.set(key, person);
    }

    const advertiserName = event.advertiserName?.trim();
    if (advertiserName && (generated || event.action === "share_view")) {
      const advertiserKey = toPersonKey(advertiserName);
      const advertiser = advertisers.get(advertiserKey) ?? { name: advertiserName, generated: 0, shareViews: 0, people: [], peopleKeys: new Map() };
      if (generated) {
        advertiser.generated += 1;
        advertiser.peopleKeys.set(key, event.actor.trim());
      }
      if (event.action === "share_view") advertiser.shareViews += 1;
      advertisers.set(advertiserKey, advertiser);
    }
  }

  const medianMs = median(durations);
  return {
    since,
    until,
    totals,
    activePeople: people.size,
    generation: { count: totals.plan_generate || 0, failed, medianMinutes: medianMs === null ? null : Math.round(medianMs / 6000) / 10 },
    people: [...people.values()]
      .map(({ days, ...person }) => ({ ...person, activeDays: days.size }))
      .sort((a, b) => b.generated - a.generated || b.total - a.total),
    advertisers: [...advertisers.values()]
      .map(({ peopleKeys, ...advertiser }) => ({ ...advertiser, people: [...peopleKeys.values()] }))
      .sort((a, b) => b.generated - a.generated || b.shareViews - a.shareViews),
    weeks: [...weeks.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([weekStart, week]) => ({ weekStart, activePeople: week.people.size, generated: week.generated, shareViews: week.shareViews })),
  };
}
