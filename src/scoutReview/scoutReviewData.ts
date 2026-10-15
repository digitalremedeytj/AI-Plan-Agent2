import type { ScoutLog } from "../storage/types";

// Filtering, the summary and conversation threading for the ScoutAI review page, kept free of
// React so the numbers an admin judges answer quality by are covered by tests. Everything works
// on the page of records the server returned for the date range.

export type RatingFilter = "all" | "up" | "down" | "unrated";
export type StatusFilter = "all" | "failed" | "applied" | "reverted" | "proposed";

export interface ReviewFilters {
  /** toPersonKey-style match on the asker; "" for everyone. */
  person: string;
  promptId: string;
  /** A topic id (src/assistant/scoutTopics.ts), or UNTAGGED for questions not tagged yet. */
  topic: string;
  kind: "" | ScoutLog["kind"];
  /** The planner's own thumbs. */
  rating: RatingFilter;
  /** The admin review: reviewed or not yet. */
  reviewed: "all" | "reviewed" | "unreviewed";
  status: StatusFilter;
  search: string;
}

export const UNTAGGED = "__untagged";

export const EMPTY_FILTERS: ReviewFilters = { person: "", promptId: "", topic: "", kind: "", rating: "all", reviewed: "all", status: "all", search: "" };

const personKey = (name: string) => name.trim().toLowerCase();

const RATINGS: RatingFilter[] = ["all", "up", "down", "unrated"];
const STATUSES: StatusFilter[] = ["all", "failed", "applied", "reverted", "proposed"];
const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");

/** Filters from a request body, for the server to apply the page's own filters itself. */
export function sanitizeReviewFilters(raw: unknown): ReviewFilters {
  const f = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    person: text(f.person, 200),
    promptId: text(f.promptId, 200),
    topic: text(f.topic, 60),
    kind: pick(f.kind, ["", "plan", "past", "live"] as const, ""),
    rating: pick(f.rating, RATINGS, "all"),
    reviewed: pick(f.reviewed, ["all", "reviewed", "unreviewed"] as const, "all"),
    status: pick(f.status, STATUSES, "all"),
    search: text(f.search, 500),
  };
}

export function filterScoutLogs(logs: ScoutLog[], filters: ReviewFilters): ScoutLog[] {
  const words = filters.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return logs.filter((log) => {
    if (filters.person && personKey(log.actor) !== personKey(filters.person)) return false;
    if (filters.promptId && log.promptId !== filters.promptId) return false;
    if (filters.topic && (filters.topic === UNTAGGED ? Boolean(log.topic) : log.topic?.id !== filters.topic)) return false;
    if (filters.kind && log.kind !== filters.kind) return false;
    if (filters.rating === "unrated" ? Boolean(log.feedback) : filters.rating !== "all" && log.feedback?.rating !== filters.rating) return false;
    if (filters.reviewed !== "all" && Boolean(log.review) !== (filters.reviewed === "reviewed")) return false;
    if (filters.status === "failed" && log.ok) return false;
    if (filters.status === "proposed" && !log.proposal) return false;
    if ((filters.status === "applied" || filters.status === "reverted") && log.outcome?.status !== filters.status) return false;
    if (words.length) {
      // The question is what planners ask; the advertiser is how admins remember a chat.
      const haystack = `${log.question}\n${log.advertiserName ?? ""}`.toLowerCase();
      if (!words.every((w) => haystack.includes(w))) return false;
    }
    return true;
  });
}

export interface ReviewSummary {
  questions: number;
  people: number;
  rated: number;
  up: number;
  down: number;
  /** Of the rated answers; null when none were rated. */
  upPct: number | null;
  downPct: number | null;
  failed: number;
  failurePct: number | null;
  reviewed: number;
  applied: number;
  topPrompts: Array<{ promptId: string; label: string; count: number }>;
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

export function summarizeScoutLogs(logs: ScoutLog[], topN = 5): ReviewSummary {
  const up = logs.filter((l) => l.feedback?.rating === "up").length;
  const down = logs.filter((l) => l.feedback?.rating === "down").length;
  const failed = logs.filter((l) => !l.ok).length;
  const prompts = new Map<string, { promptId: string; label: string; count: number }>();
  for (const log of logs) {
    const entry = prompts.get(log.promptId) ?? { promptId: log.promptId, label: log.promptLabel || log.promptId, count: 0 };
    entry.count += 1;
    prompts.set(log.promptId, entry);
  }
  return {
    questions: logs.length,
    people: new Set(logs.map((l) => personKey(l.actor))).size,
    rated: up + down,
    up,
    down,
    upPct: pct(up, up + down),
    downPct: pct(down, up + down),
    failed,
    failurePct: pct(failed, logs.length),
    reviewed: logs.filter((l) => l.review).length,
    applied: logs.filter((l) => l.outcome?.status === "applied").length,
    topPrompts: [...prompts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, topN),
  };
}

/** The choices the filter menus offer: everyone who asked and every prompt used, in the loaded range. */
export function filterOptions(logs: ScoutLog[]): { people: string[]; prompts: Array<{ promptId: string; label: string }>; topics: string[] } {
  const people = new Map<string, string>();
  const prompts = new Map<string, string>();
  for (const log of logs) {
    if (!people.has(personKey(log.actor))) people.set(personKey(log.actor), log.actor);
    if (!prompts.has(log.promptId)) prompts.set(log.promptId, log.promptLabel || log.promptId);
  }
  return {
    people: [...people.values()].sort((a, b) => a.localeCompare(b)),
    prompts: [...prompts.entries()].map(([promptId, label]) => ({ promptId, label })).sort((a, b) => a.label.localeCompare(b.label)),
    topics: [...new Set(logs.flatMap((l) => (l.topic ? [l.topic.id] : [])))],
  };
}

/**
 * Every turn of the chat this record belongs to, first question first. A record without a
 * conversationId (asked before ids existed) stands alone. Only turns inside the loaded range
 * can be shown, so `missingEarlier` says when the chat started before it.
 */
export function conversationOf(logs: ScoutLog[], log: ScoutLog): { turns: ScoutLog[]; missingEarlier: boolean } {
  const turns = log.conversationId
    ? logs.filter((l) => l.conversationId === log.conversationId).sort((a, b) => a.turn - b.turn || (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    : [log];
  return { turns, missingEarlier: (turns[0]?.turn ?? 1) > 1 };
}

/** "12.3s" or "1m 05s". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

export const KIND_LABELS: Record<ScoutLog["kind"], string> = { plan: "Plan", past: "Past performance", live: "Live campaign" };

// A cell that starts with = + - or @ is a formula to Excel and Sheets; a question typed by a
// planner must open as text.
function csvCell(value: unknown): string {
  let text = value === undefined || value === null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The questions as CSV, one row per question, for reading in a spreadsheet. */
export function scoutLogsCsv(logs: ScoutLog[], topicLabelOf: (id: string | undefined) => string): string {
  const header = [
    "Asked at (UTC)", "Person", "Advertiser", "Plan id", "Conversation", "Turn", "Prompt", "Type", "Topic", "Answered", "Error",
    "Seconds", "Model", "Question", "Answer", "Changes proposed", "Outcome", "Planner rating", "Planner comment", "Review", "Review notes", "Reviewed by",
  ];
  const rows = logs.map((l) => [
    l.at, l.actor, l.advertiserName ?? "", l.planId, l.conversationId ?? "", l.turn, l.promptLabel, KIND_LABELS[l.kind], topicLabelOf(l.topic?.id),
    l.ok ? "yes" : "no", l.error ? `${l.error.code}: ${l.error.message}` : "", (l.durationMs / 1000).toFixed(1), l.model ?? "",
    l.question, l.reply ?? "", l.proposal ? l.proposal.items.length : 0, l.outcome?.status ?? "",
    l.feedback?.rating ?? "", l.feedback?.comment ?? "", l.review ? (l.review.rating === "up" ? "good" : "poor") : "", l.review?.notes ?? "", l.review?.by ?? "",
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}
