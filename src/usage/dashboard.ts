import { SHARE_VIEWER_ACTOR, type DashboardConfig, type UsageEvent } from "../storage/types";
import { toPersonKey } from "./usageSummary";

/**
 * The leadership dashboard, computed from the usage log.
 *
 * Pure so every number on the page can be tested. Definitions that matter:
 *  - A "plan" is one successful generation run. Regenerations count, since each is work done.
 *  - "Media budget planned" counts a brief once: the same person re-running the same
 *    advertiser at the same budget within a day is iteration, not new media planned.
 *  - The funnel follows the plans generated in the period (a cohort), whenever they were
 *    later shared or opened, so a slow week cannot show more shares than plans.
 *  - Client views of a share link are credited to whoever created the link.
 *  - Excluded names (test accounts) are dropped before anything is counted.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const BRIEF_REPEAT_WINDOW_MS = DAY_MS;

/** Usage actions shown as feature adoption, in display order. */
export const ADOPTION_FEATURES: Array<{ action: string; label: string }> = [
  { action: "export", label: "Exports" },
  { action: "scout_chat", label: "ScoutAI" },
  { action: "slide_generate", label: "Slide studio" },
  { action: "qa_audit", label: "QA audit" },
  { action: "exec_brief", label: "Executive brief" },
  { action: "segments_generate", label: "Segments" },
  { action: "campaign_recap", label: "Campaign recap" },
];

export interface Kpi {
  value: number;
  previous: number;
}

export interface DashboardSeriesPoint {
  /** First day of the bucket, YYYY-MM-DD. */
  start: string;
  plans: number;
  activeUsers: number;
  shareViews: number;
  budget: number;
}

export interface DashboardUser {
  name: string;
  plans: number;
  shareLinks: number;
  shareViews: number;
  budget: number;
  lastActiveAt: string;
}

export interface DashboardData {
  from: string;
  to: string;
  previousFrom: string;
  bucket: "day" | "week";
  hoursPerPlan: number;
  kpis: {
    activeUsers: Kpi;
    plans: Kpi;
    advertisers: Kpi;
    shareLinks: Kpi;
    shareViews: Kpi;
    budget: Kpi;
  };
  /** Everyone who has ever used the app, up to the end of the period. */
  totalUsers: number;
  reliability: { runs: number; failed: number; successRate: number | null; medianMinutes: number | null };
  series: DashboardSeriesPoint[];
  funnel: { generated: number; shared: number; viewed: number };
  users: DashboardUser[];
  advertisers: Array<{ name: string; plans: number; budget: number }>;
  channels: Array<{ name: string; budget: number; plans: number }>;
  adoption: Array<{ action: string; label: string; uses: number; people: number }>;
  /** True when part of the data was imported from saved plans rather than recorded live. */
  includesBackfill: boolean;
}

/** The fields a generation event carries about the plan's media budget. */
export function planBudgetFields(profile: any): { budget?: number; channels?: Record<string, number> } {
  const mediaPlan = profile?.channelStrategy?.mediaPlan;
  const budget = Number(mediaPlan?.workingMediaBudget);
  if (!Number.isFinite(budget) || budget <= 0) return {};
  const channels: Record<string, number> = {};
  for (const channel of Array.isArray(mediaPlan?.channels) ? mediaPlan.channels : []) {
    const name = String(channel?.channelName || channel?.channelId || "").trim();
    const dollars = Number(channel?.allocationDollars);
    if (!name || !Number.isFinite(dollars) || dollars <= 0) continue;
    channels[name] = Math.round((channels[name] || 0) + dollars);
  }
  return { budget: Math.round(budget), ...(Object.keys(channels).length ? { channels } : {}) };
}

/**
 * The calendar day an instant falls on for the viewer. `tzOffsetMinutes` is the browser's
 * getTimezoneOffset() (minutes behind UTC), so a 9pm plan in New York lands on that day and
 * not the next one, as it would in UTC.
 */
const localDay = (iso: string, tzOffsetMinutes: number) => new Date(Date.parse(iso) - tzOffsetMinutes * 60_000).toISOString().slice(0, 10);

function bucketStart(iso: string, bucket: "day" | "week", tzOffsetMinutes: number): string {
  const dayStr = localDay(iso, tzOffsetMinutes);
  if (bucket === "day") return dayStr;
  const day = new Date(`${dayStr}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const isGenerated = (e: UsageEvent) => e.action === "plan_generate" && e.ok !== false;
const isClientView = (e: UsageEvent) => e.action === "share_view" && e.detail !== "staff_preview";

/** Generations that add media budget: the first run of each brief in a rolling day. */
function budgetCountingRuns(generations: UsageEvent[]): Set<string> {
  const lastSeen = new Map<string, number>();
  const counted = new Set<string>();
  for (const e of generations) {
    if (!e.budget) continue;
    const key = `${toPersonKey(e.actor)}|${toPersonKey(e.advertiserName || "")}|${e.budget}`;
    const at = Date.parse(e.at);
    const previous = lastSeen.get(key);
    if (previous === undefined || at - previous > BRIEF_REPEAT_WINDOW_MS) counted.add(e.id);
    lastSeen.set(key, at);
  }
  return counted;
}

export function buildDashboard(allEvents: UsageEvent[], fromIso: string, toIso: string, config: DashboardConfig, tzOffsetMinutes = 0): DashboardData {
  const excluded = new Set(config.excludedNames.map(toPersonKey));
  const events = allEvents
    .filter((e) => !excluded.has(toPersonKey(e.actor)))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  const span = Math.max(DAY_MS, to - from);
  const previousFromIso = new Date(from - span).toISOString();
  const inRange = (e: UsageEvent, start: string, end: string) => e.at >= start && e.at <= end;
  const current = events.filter((e) => inRange(e, fromIso, toIso));
  const previous = events.filter((e) => e.at >= previousFromIso && e.at < fromIso);

  // Budget dedupe needs the run before the period too, or a brief re-run on the first morning
  // of the period would count again.
  const countedForBudget = budgetCountingRuns(events.filter(isGenerated));

  // Who created each plan's share link, so client views can be credited to them.
  const sharerByPlan = new Map<string, string>();
  const generatorByPlan = new Map<string, string>();
  for (const e of events) {
    if (e.action === "share_create" && e.planId && !sharerByPlan.has(e.planId)) sharerByPlan.set(e.planId, e.actor.trim());
    if (isGenerated(e) && e.planId && !generatorByPlan.has(e.planId)) generatorByPlan.set(e.planId, e.actor.trim());
  }

  const measure = (list: UsageEvent[]) => {
    const people = new Set<string>();
    const advertisers = new Set<string>();
    let plans = 0;
    let shareLinks = 0;
    let shareViews = 0;
    let budget = 0;
    for (const e of list) {
      if (e.actor !== SHARE_VIEWER_ACTOR) people.add(toPersonKey(e.actor));
      if (isGenerated(e)) {
        plans += 1;
        if (e.advertiserName?.trim()) advertisers.add(toPersonKey(e.advertiserName));
        if (countedForBudget.has(e.id)) budget += e.budget || 0;
      }
      if (e.action === "share_create") shareLinks += 1;
      if (isClientView(e)) shareViews += 1;
    }
    return { activeUsers: people.size, plans, advertisers: advertisers.size, shareLinks, shareViews, budget };
  };
  const now = measure(current);
  const before = measure(previous);
  const kpi = (key: keyof typeof now): Kpi => ({ value: now[key], previous: before[key] });

  const totalUsers = new Set(events.filter((e) => e.at <= toIso && e.actor !== SHARE_VIEWER_ACTOR).map((e) => toPersonKey(e.actor))).size;

  // Reliability: every run in the period, including failures and abandoned runs.
  const runs = current.filter((e) => e.action === "plan_generate");
  const failed = runs.filter((e) => e.ok === false).length;
  const durations = runs.filter((e) => e.ok !== false && typeof e.durationMs === "number").map((e) => e.durationMs as number);
  const medianMs = median(durations);

  // Series: daily up to ~5 weeks, weekly beyond, with empty buckets filled so the chart's
  // x-axis is continuous.
  const bucket: "day" | "week" = span <= 35 * DAY_MS ? "day" : "week";
  const series = new Map<string, DashboardSeriesPoint & { people: Set<string> }>();
  const lastDay = Date.parse(`${localDay(toIso, tzOffsetMinutes)}T00:00:00Z`);
  for (let t = Date.parse(`${bucketStart(fromIso, bucket, tzOffsetMinutes)}T00:00:00Z`); t <= lastDay; t += (bucket === "day" ? 1 : 7) * DAY_MS) {
    const start = new Date(t).toISOString().slice(0, 10);
    series.set(start, { start, plans: 0, activeUsers: 0, shareViews: 0, budget: 0, people: new Set() });
  }
  for (const e of current) {
    const point = series.get(bucketStart(e.at, bucket, tzOffsetMinutes));
    if (!point) continue;
    if (e.actor !== SHARE_VIEWER_ACTOR) point.people.add(toPersonKey(e.actor));
    if (isGenerated(e)) {
      point.plans += 1;
      if (countedForBudget.has(e.id)) point.budget += e.budget || 0;
    }
    if (isClientView(e)) point.shareViews += 1;
  }

  // Funnel over the period's plans.
  const cohort = new Set(current.filter((e) => isGenerated(e) && e.planId).map((e) => e.planId as string));
  const sharedPlans = new Set(events.filter((e) => e.action === "share_create" && e.planId && cohort.has(e.planId)).map((e) => e.planId as string));
  const viewedPlans = new Set(events.filter((e) => isClientView(e) && e.planId && sharedPlans.has(e.planId)).map((e) => e.planId as string));

  // Per person.
  const users = new Map<string, DashboardUser>();
  const userFor = (name: string, at: string) => {
    const key = toPersonKey(name);
    const user = users.get(key) ?? { name: name.trim(), plans: 0, shareLinks: 0, shareViews: 0, budget: 0, lastActiveAt: at };
    users.set(key, user);
    return user;
  };
  for (const e of current) {
    if (e.actor !== SHARE_VIEWER_ACTOR) {
      const user = userFor(e.actor, e.at);
      user.name = e.actor.trim();
      user.lastActiveAt = e.at;
      if (isGenerated(e)) {
        user.plans += 1;
        if (countedForBudget.has(e.id)) user.budget += e.budget || 0;
      }
      if (e.action === "share_create") user.shareLinks += 1;
    }
    if (isClientView(e) && e.planId) {
      const owner = sharerByPlan.get(e.planId) || generatorByPlan.get(e.planId);
      if (owner && !excluded.has(toPersonKey(owner))) userFor(owner, e.at).shareViews += 1;
    }
  }

  // Per advertiser and per media type.
  const advertisers = new Map<string, { name: string; plans: number; budget: number }>();
  const channels = new Map<string, { name: string; budget: number; plans: number }>();
  for (const e of current.filter(isGenerated)) {
    const name = e.advertiserName?.trim();
    if (name) {
      const advertiser = advertisers.get(toPersonKey(name)) ?? { name, plans: 0, budget: 0 };
      advertiser.plans += 1;
      if (countedForBudget.has(e.id)) advertiser.budget += e.budget || 0;
      advertisers.set(toPersonKey(name), advertiser);
    }
    for (const [channelName, dollars] of Object.entries(e.channels || {})) {
      const channel = channels.get(channelName) ?? { name: channelName, budget: 0, plans: 0 };
      channel.plans += 1;
      if (countedForBudget.has(e.id)) channel.budget += dollars;
      channels.set(channelName, channel);
    }
  }

  const adoption = ADOPTION_FEATURES.map(({ action, label }) => {
    const uses = current.filter((e) => e.action === action && e.actor !== SHARE_VIEWER_ACTOR);
    return { action, label, uses: uses.length, people: new Set(uses.map((e) => toPersonKey(e.actor))).size };
  });

  return {
    from: fromIso,
    to: toIso,
    previousFrom: previousFromIso,
    bucket,
    hoursPerPlan: config.hoursPerPlan,
    kpis: {
      activeUsers: kpi("activeUsers"),
      plans: kpi("plans"),
      advertisers: kpi("advertisers"),
      shareLinks: kpi("shareLinks"),
      shareViews: kpi("shareViews"),
      budget: kpi("budget"),
    },
    totalUsers,
    reliability: {
      runs: runs.length,
      failed,
      successRate: runs.length ? (runs.length - failed) / runs.length : null,
      medianMinutes: medianMs === null ? null : Math.round(medianMs / 6000) / 10,
    },
    series: [...series.values()].map(({ people, ...point }) => ({ ...point, activeUsers: people.size })),
    funnel: { generated: cohort.size, shared: sharedPlans.size, viewed: viewedPlans.size },
    users: [...users.values()]
      .filter((u) => u.plans || u.shareLinks || u.shareViews)
      .sort((a, b) => b.plans - a.plans || b.shareLinks - a.shareLinks || b.shareViews - a.shareViews),
    advertisers: [...advertisers.values()].sort((a, b) => b.plans - a.plans || b.budget - a.budget),
    channels: [...channels.values()].sort((a, b) => b.budget - a.budget),
    adoption,
    includesBackfill: current.some((e) => e.id.startsWith("backfill-")),
  };
}
