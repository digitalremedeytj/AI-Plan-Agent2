import type { PlanningSettings } from "../planning/settings";
import type { CtvPublisherSetting } from "../planning/knowledge/ctvPublishers";
import type { ScoutPrompt } from "../assistant/promptLibrary";

/**
 * Shared, server-authoritative storage contract.
 *
 * Everything the app needs to survive a Cloud Run instance restart lives behind this
 * interface. Two drivers implement it: a local-file driver for development and a
 * Firestore driver for the deployed service. The container filesystem is never a
 * store in production - it is ephemeral (minScale 0, maxScale 100), so a JSON file
 * written by one instance is invisible to the next one and gone after a redeploy.
 */

/** Server-managed metadata. The client never sets these fields; the server always does. */
export interface PlanSummary {
  id: string;
  /** Monotonic per-plan counter used for optimistic concurrency (If-Match). */
  revision: number;
  title: string;
  advertiserName?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  archived: boolean;
  /**
   * Which global settings revision this plan was generated against. Loading a plan
   * restores that revision, so a later settings change cannot silently move the
   * numbers under a plan somebody already saved.
   */
  settingsRevision: number | null;
  /**
   * A few fields denormalized out of the payload purely so the plan list can render
   * without downloading every payload. Derived server-side on write; never authoritative.
   */
  audienceDescription?: string;
  geography?: string;
  campaignFocus?: string;
  url?: string;
  /** Secret share token for unauthenticated link-sharing. */
  shareToken?: string | null;
  /** Whether the plan is currently accessible via its shareToken. */
  isShared?: boolean;
}

/** A full plan record: metadata plus the opaque saved-plan body the client round-trips. */
export interface StoredPlan extends PlanSummary {
  payload: PlanPayload;
}

/**
 * The plan body. Deliberately opaque to the storage layer - it mirrors the client's
 * SavedProfile shape minus the fields the server owns (id/savedAt/title/author).
 * Storing it as one JSON blob keeps the drivers free of the app's evolving schema.
 */
export type PlanPayload = Record<string, unknown>;

/** The preview fields the server derives from a payload on every write. */
export interface PlanPreviewFields {
  audienceDescription?: string;
  geography?: string;
  campaignFocus?: string;
  url?: string;
}

export interface CreatePlanInput extends PlanPreviewFields {
  title: string;
  advertiserName?: string;
  settingsRevision: number | null;
  payload: PlanPayload;
  actor: string;
}

export interface UpdatePlanInput extends PlanPreviewFields {
  title: string;
  advertiserName?: string;
  settingsRevision: number | null;
  payload: PlanPayload;
  actor: string;
}

export interface SettingsRecord {
  revision: number;
  settings: PlanningSettings;
  updatedAt: string;
  updatedBy: string;
}

export interface PublishersRecord {
  revision: number;
  publishers: CtvPublisherSetting[];
  updatedAt: string;
  updatedBy: string;
}

/** The ScoutAI prompt library as the admin last saved it. See src/assistant/promptLibrary.ts. */
export interface ScoutPromptsRecord {
  revision: number;
  prompts: ScoutPrompt[];
  updatedAt: string;
  updatedBy: string;
}

export interface ListPlansOptions {
  includeArchived?: boolean;
}

// --- past campaign performance --------------------------------------------------

/**
 * One uploaded report. A summarised export keeps its text, so the server re-reads it with
 * whatever the reader knows today. A touch-level export arrives as the browser's summary: its
 * rows are household-level (hashed IPs) and too large to upload, so they never leave the browser.
 */
export interface PerformanceFileRecord {
  id: string;
  fileName: string;
  sizeBytes: number;
  /** Used to skip a file uploaded twice: the text's SHA-256, or name/size/modified time for a summary. */
  fingerprint: string;
  uploadedAt: string;
  uploadedBy: string;
  text?: string;
  touchReport?: unknown;
}

/**
 * A past campaign in an advertiser's library: the report set for one flight. It is its own
 * record, linked to plans rather than stored in them, so uploading reports never moves a plan's
 * revision (which would invalidate pending ScoutAI proposals) and the next plan for the same
 * advertiser can draw on it too.
 */
/** What the campaign's totals were at one upload of a live campaign, for "since last upload". */
export interface PerformanceSnapshot {
  uploadedAt: string;
  uploadedBy: string;
  /** The last day the reports covered, YYYY-MM-DD. */
  asOf: string | null;
  spend: number;
  conversions: number;
  revenue: number;
}

export interface PerformanceCampaignSummary {
  id: string;
  revision: number;
  /**
   * "past": a finished campaign to learn from. "live": the running campaign of a linked plan,
   * re-exported during the flight and compared with the plan.
   */
  kind: "past" | "live";
  advertiserName: string;
  /** Lowercased and trimmed, so "Acme " and "acme" are one advertiser's library. */
  advertiserKey: string;
  name: string;
  /** The flight the planner confirmed, YYYY-MM-DD. */
  flightStart: string | null;
  flightEnd: string | null;
  /** What the pixel conversion is; the exports never say. */
  conversionLabel: string | null;
  /** What the campaign optimised for, which decides what "performed well" means. */
  campaignGoal: string | null;
  notes: string | null;
  linkedPlanIds: string[];
  fileCount: number;
  /** Live campaigns only: one entry per upload, newest last. */
  snapshots: PerformanceSnapshot[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  archived: boolean;
}

export interface PerformanceCampaign extends PerformanceCampaignSummary {
  files: PerformanceFileRecord[];
  /** The saved Performance Review (src/performance/review), opaque to storage. */
  review: unknown | null;
}

export interface PerformanceCampaignInput {
  /** Set when the campaign is created; left out of an update to keep it. */
  kind?: "past" | "live";
  snapshots?: PerformanceSnapshot[];
  advertiserName: string;
  name: string;
  flightStart: string | null;
  flightEnd: string | null;
  conversionLabel: string | null;
  campaignGoal: string | null;
  notes: string | null;
  linkedPlanIds: string[];
  files: PerformanceFileRecord[];
  /** Left out to keep the saved review; null clears it. */
  review?: unknown | null;
  actor: string;
}

const MAX_SNAPSHOTS = 40;

/** A campaign is one Firestore document; its files must leave room under the 1MB limit. */
export const MAX_PERFORMANCE_FILES_BYTES = 900_000;

export const toAdvertiserKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

export class CampaignNotFoundError extends Error {
  constructor(id: string) {
    super(`Campaign '${id}' was not found.`);
    this.name = "CampaignNotFoundError";
  }
}

export class CampaignTooLargeError extends Error {
  constructor(bytes: number) {
    super(`These reports take ${Math.round(bytes / 1000)}KB, more than the ${Math.round(MAX_PERFORMANCE_FILES_BYTES / 1000)}KB a campaign can hold. Remove a file, or split the reports into two campaigns.`);
    this.name = "CampaignTooLargeError";
  }
}

/** Shared by both drivers so a campaign too big for Firestore is refused in development as well. */
export function assertCampaignFits(files: PerformanceFileRecord[], review: unknown = null): void {
  const bytes = new TextEncoder().encode(JSON.stringify(files)).length + new TextEncoder().encode(JSON.stringify(review)).length;
  if (bytes > MAX_PERFORMANCE_FILES_BYTES) throw new CampaignTooLargeError(bytes);
}

export function buildCampaignRecord(
  id: string,
  input: PerformanceCampaignInput,
  existing: Pick<PerformanceCampaign, "revision" | "createdAt" | "createdBy" | "archived" | "review" | "kind" | "snapshots"> | null,
  now: string,
): PerformanceCampaign {
  return {
    id,
    revision: existing ? existing.revision + 1 : 1,
    kind: existing?.kind ?? input.kind ?? "past",
    advertiserName: input.advertiserName,
    advertiserKey: toAdvertiserKey(input.advertiserName),
    name: input.name,
    flightStart: input.flightStart,
    flightEnd: input.flightEnd,
    conversionLabel: input.conversionLabel,
    campaignGoal: input.campaignGoal,
    notes: input.notes,
    linkedPlanIds: [...new Set(input.linkedPlanIds)],
    fileCount: input.files.length,
    snapshots: (input.snapshots ?? existing?.snapshots ?? []).slice(-MAX_SNAPSHOTS),
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? input.actor,
    updatedAt: now,
    updatedBy: input.actor,
    archived: existing?.archived ?? false,
    files: input.files,
    review: input.review !== undefined ? input.review : existing?.review ?? null,
  };
}

export function toCampaignSummary(campaign: PerformanceCampaign): PerformanceCampaignSummary {
  const { files, review, ...summary } = campaign;
  return summary;
}

// --- ScoutAI conversation log -------------------------------------------------------

/** How long a ScoutAI turn is kept. Firestore deletes it at `expireAt` (a TTL policy on that field). */
export const SCOUT_LOG_RETENTION_DAYS = 365;

/** What a planner or reviewer thought of an answer. */
export interface ScoutRating {
  rating: "up" | "down";
  comment?: string;
  by: string;
  at: string;
}

/**
 * One ScoutAI question and its answer, for reviewing answer quality and what planners ask.
 * Unlike the usage log this holds the words, so it is admin-only to read and expires after
 * SCOUT_LOG_RETENTION_DAYS. Only the newest question is stored; earlier turns of the same
 * conversation are their own records, linked by conversationId and turn.
 */
export interface ScoutLog {
  id: string;
  at: string;
  expireAt: string;
  actor: string;
  planId: string;
  advertiserName?: string;
  planRevision: number;
  /** Set by the browser per chat, so a conversation can be read back in order. */
  conversationId?: string;
  /** 1 for the first question of the conversation. */
  turn: number;
  /** Library prompt id, "typed", or "recap". */
  promptId: string;
  promptLabel: string;
  kind: "plan" | "past" | "live";
  ok: boolean;
  durationMs: number;
  question: string;
  reply?: string;
  /** What ScoutAI proposed, as the planner saw it (before -> after), without the raw operations. */
  proposal?: {
    summary?: string;
    items: Array<{ title: string; why: string; evidence?: string; changes: Array<{ label: string; before: string; after: string }>; unverifiedFigures?: string[] }>;
  };
  /** Proposed changes the plan could not take, as told to the planner. */
  dropped?: string[];
  depth?: "summary" | "full";
  model?: string;
  thinkingLevel?: string;
  error?: { code: string; message: string };
  /** Set when the planner applies or undoes the proposal from this answer. */
  outcome?: { status: "applied" | "reverted"; changes: number; by: string; at: string };
  /** The asking planner's thumbs up or down. */
  feedback?: ScoutRating;
  /** What the question is about (an id from SCOUT_TOPICS), tagged by Gemini after the answer is saved. */
  topic?: { id: string; at: string };
  /** An admin's rating from the review page (/scout-review). Never touches `feedback`. */
  review?: ScoutRating & { notes?: string };
}

export type ScoutLogUpdate = Partial<Pick<ScoutLog, "outcome" | "feedback" | "review" | "topic">>;

// --- usage log -------------------------------------------------------------------

/**
 * One thing a person did, recorded server-side for the admin Usage report. Google Analytics
 * covers the same ground but may not receive names (its terms forbid personal data) and is
 * blocked by some browsers, so this log is what "who used it" is answered from.
 * Append-only: events are never edited or removed.
 */
export interface UsageEvent {
  id: string;
  /** ISO timestamp, set by the server. */
  at: string;
  /** Display name from the session, or SHARE_VIEWER_ACTOR for an unauthenticated share link. */
  actor: string;
  action: string;
  planId?: string;
  advertiserName?: string;
  /** How long the action took, for generation and other long calls. */
  durationMs?: number;
  /** False when the action failed. Absent means it is not a pass/fail action. */
  ok?: boolean;
  /** A short qualifier, e.g. the export format, which slide, or which ScoutAI prompt. */
  detail?: string;
  /** Display name for `detail` as it was at the time, e.g. a ScoutAI prompt's title (prompts can be renamed). */
  label?: string;
  /** A second qualifier. scout_chat: "plan" | "past" | "live"; scout_apply: "applied" | "reverted". */
  kind?: string;
  /** scout_chat: changes ScoutAI proposed (0 = answer only); scout_apply: changes saved. */
  count?: number;
  /** plan_generate only: the plan's working media budget, in dollars. */
  budget?: number;
  /** plan_generate only: dollars allocated per media type, keyed by channel name. */
  channels?: Record<string, number>;
}

export const SHARE_VIEWER_ACTOR = "(client share link)";

/**
 * A view-only link to the leadership dashboard, for people without the team login. The token
 * is the secret (256 bits, like plan share links). Links never expire; they are revoked.
 */
export interface DashboardLink {
  token: string;
  label: string;
  createdAt: string;
  createdBy: string;
  revoked: boolean;
  revokedAt?: string;
  revokedBy?: string;
  lastViewedAt?: string;
  viewCount: number;
}

/** Shared dashboard settings, edited by admins. */
export interface DashboardConfig {
  /** The manual hours one plan replaces, for the "time saved" estimate. */
  hoursPerPlan: number;
  /** Test or internal accounts left out of every dashboard number (matched case-insensitively). */
  excludedNames: string[];
  updatedAt?: string;
  updatedBy?: string;
}

export const DEFAULT_DASHBOARD_CONFIG: DashboardConfig = { hoursPerPlan: 1, excludedNames: [] };

/** Raised when a caller's If-Match revision no longer matches the stored plan. */
export class RevisionConflictError extends Error {
  readonly currentRevision: number;
  constructor(currentRevision: number, message = "Plan was modified by someone else.") {
    super(message);
    this.name = "RevisionConflictError";
    this.currentRevision = currentRevision;
  }
}

/** Raised when a plan id does not exist (or has been hard-removed). */
export class PlanNotFoundError extends Error {
  constructor(id: string) {
    super(`Plan '${id}' was not found.`);
    this.name = "PlanNotFoundError";
  }
}

export interface StorageAdapter {
  /** Human-readable driver name, surfaced in /api/health for deploy verification. */
  readonly name: string;

  /** Called once at boot. Must be idempotent and safe to call concurrently. */
  init(): Promise<void>;

  listPlans(options?: ListPlansOptions): Promise<PlanSummary[]>;
  getPlan(id: string): Promise<StoredPlan | null>;
  createPlan(input: CreatePlanInput): Promise<StoredPlan>;
  /** Throws RevisionConflictError if expectedRevision is stale, PlanNotFoundError if absent. */
  updatePlan(id: string, input: UpdatePlanInput, expectedRevision: number): Promise<StoredPlan>;
  /** Soft delete. Plans are never destroyed, so a mis-click is always recoverable. */
  archivePlan(id: string, actor: string): Promise<void>;
  restorePlan(id: string, actor: string): Promise<void>;

  /** Look up an unarchived, actively shared plan by its secret share token. Returns null if revoked/absent. */
  getPlanByShareToken(token: string): Promise<StoredPlan | null>;
  /** Update the sharing status and/or token for a plan. */
  setPlanShare(id: string, isShared: boolean, shareToken?: string | null): Promise<StoredPlan>;

  getCurrentSettings(): Promise<SettingsRecord>;
  getSettingsRevision(revision: number): Promise<SettingsRecord | null>;
  saveSettings(settings: PlanningSettings, actor: string): Promise<SettingsRecord>;

  getCurrentPublishers(): Promise<PublishersRecord>;
  savePublishers(publishers: CtvPublisherSetting[], actor: string): Promise<PublishersRecord>;

  /** Null until an admin first saves the library; callers fall back to the built-in prompts. */
  getScoutPrompts(): Promise<ScoutPromptsRecord | null>;
  /** Throws RevisionConflictError if expectedRevision (0 for a first save) is stale. */
  saveScoutPrompts(prompts: ScoutPrompt[], actor: string, expectedRevision: number): Promise<ScoutPromptsRecord>;

  /** Summaries only: listing never downloads report files. */
  listPerformanceCampaigns(options?: ListPlansOptions): Promise<PerformanceCampaignSummary[]>;
  getPerformanceCampaign(id: string): Promise<PerformanceCampaign | null>;
  /** Throws CampaignTooLargeError if the files would not fit in one document. */
  createPerformanceCampaign(input: PerformanceCampaignInput): Promise<PerformanceCampaign>;
  /** Replaces the campaign. Throws RevisionConflictError if stale, CampaignNotFoundError if absent. */
  updatePerformanceCampaign(id: string, input: PerformanceCampaignInput, expectedRevision: number): Promise<PerformanceCampaign>;
  /** Soft delete, like plans. */
  archivePerformanceCampaign(id: string, actor: string): Promise<void>;

  /** Throws (from the driver) if an event with this id already exists, so backfills cannot double up. */
  recordUsageEvent(event: UsageEvent): Promise<void>;
  /** Every event at or after `sinceIso`, oldest first. */
  listUsageEvents(sinceIso: string): Promise<UsageEvent[]>;

  recordScoutLog(log: ScoutLog): Promise<void>;
  getScoutLog(id: string): Promise<ScoutLog | null>;
  /** Merges outcome, feedback, review or topic into the record. Returns null if it is gone (expired). */
  updateScoutLog(id: string, update: ScoutLogUpdate): Promise<ScoutLog | null>;
  /** Newest first, between the two times, at most `limit`. */
  listScoutLogs(options: { sinceIso: string; untilIso?: string; limit?: number }): Promise<ScoutLog[]>;

  listDashboardLinks(): Promise<DashboardLink[]>;
  getDashboardLink(token: string): Promise<DashboardLink | null>;
  /** Creates or replaces the link stored under link.token. */
  saveDashboardLink(link: DashboardLink): Promise<void>;
  getDashboardConfig(): Promise<DashboardConfig>;
  saveDashboardConfig(config: DashboardConfig): Promise<DashboardConfig>;
}
