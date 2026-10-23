import type { ExtractedPlacement, RfpAnalysis, SavedProfile } from "../types";
import type { PlanningSettings } from "../planning/settings";
import type { CtvPublisherSetting } from "../planning/knowledge/ctvPublishers";
import type { AssistantOp, ProposalChange } from "../assistant/operations";
import type { ScoutPrompt } from "../assistant/promptLibrary";
import type { ChatTurn } from "../assistant/scoutChat";
import type { FollowUp } from "../assistant/followUps";
import type { CampaignAnalysis } from "../performance/campaign";
import type { PerformanceReview, ReviewFinding } from "../performance/review";
import type { PlanVsActual } from "../performance/planVsActual";
import type { PreparedFile } from "../performance/browserFiles";
import type { PerformanceCampaignSummary } from "../storage/types";
import type { UsageSummary } from "../usage/usageSummary";
import type { DashboardData } from "../usage/dashboard";
import type { DashboardConfig, DashboardLink, ScoutLog } from "../storage/types";
import type { AskBlock } from "../scoutReview/scoutAsk";
import type { ReviewFilters } from "../scoutReview/scoutReviewData";

/**
 * Client for the shared server store.
 *
 * Everything here talks to a server that is the single source of truth. The browser
 * keeps no authoritative copy: localStorage is a display cache only, so one person's
 * stale tab can never become everyone else's data.
 */

export interface SessionUser {
  name: string;
  isAdmin: boolean;
  /** True when this user may write global settings (see ADMIN_PASSWORD on the server). */
  canEditSettings: boolean;
  /** Pseudonymous Google Analytics user_id: a keyed hash of the name, never the name itself. */
  analyticsId?: string;
}

/** Server-owned plan metadata. The sidebar renders from these without loading payloads. */
export interface PlanSummary {
  id: string;
  revision: number;
  title: string;
  advertiserName?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  archived: boolean;
  settingsRevision: number | null;
  /** Denormalized from the payload server-side so the list renders without a fetch per plan. */
  audienceDescription?: string;
  geography?: string;
  campaignFocus?: string;
  url?: string;
  shareToken?: string | null;
  isShared?: boolean;
}

export interface StoredPlan extends PlanSummary {
  payload: PlanPayload;
}

/** The plan body: a SavedProfile minus the fields the server now owns. */
export type PlanPayload = Omit<SavedProfile, "id" | "savedAt" | "title" | "advertiserName">;

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly currentRevision?: number;
  /** Why a request was refused item by item, e.g. the parts of a ScoutAI change that no longer apply. */
  readonly reasons?: string[];

  constructor(status: number, message: string, body?: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = body?.code;
    this.currentRevision = body?.currentRevision;
    this.reasons = Array.isArray(body?.reasons) ? body.reasons.map(String) : undefined;
  }

  /** Someone else saved this plan while the user was editing it. */
  get isConflict(): boolean {
    return this.status === 409 || this.code === "REVISION_CONFLICT";
  }

  get isUnauthenticated(): boolean {
    return this.status === 401 || this.code === "UNAUTHENTICATED";
  }

  get isForbidden(): boolean {
    return this.status === 403 || this.code === "FORBIDDEN";
  }
}

const AUTH_TOKEN_KEY = "apa_session_token";
let inMemoryToken: string | null = null;

export function getAuthToken(): string | null {
  if (inMemoryToken) return inMemoryToken;
  try {
    const stored = localStorage.getItem(AUTH_TOKEN_KEY) || sessionStorage.getItem(AUTH_TOKEN_KEY);
    if (stored) {
      inMemoryToken = stored;
      return stored;
    }
  } catch {
    // Storage access might be restricted in some iframe sandboxes
  }
  return null;
}

export function setAuthToken(token: string | null): void {
  inMemoryToken = token;
  try {
    if (token) {
      localStorage.setItem(AUTH_TOKEN_KEY, token);
      sessionStorage.setItem(AUTH_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      sessionStorage.removeItem(AUTH_TOKEN_KEY);
    }
  } catch {
    // Ignore storage errors in restricted contexts
  }
}

export function getAuthHeaders(initHeaders?: HeadersInit): Headers {
  const headers = new Headers(initHeaders || {});
  const token = getAuthToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("x-session-token", token);
  }
  return headers;
}

/**
 * Fetch wrapper that attaches authentication headers and credentials: "include".
 * Essential for operating securely inside embedded iframes and cross-site contexts.
 */
export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = getAuthHeaders(init.headers);
  const res = await fetch(input, {
    credentials: "include",
    ...init,
    headers,
  });

  if (res.status === 401) {
    setAuthToken(null);
  }
  return res;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = getAuthHeaders(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(path, {
    credentials: "include",
    ...init,
    headers,
  });

  let body: any = null;
  try {
    body = await res.json();
  } catch {
    // A non-JSON body (proxy error page, empty 204) is fine; status still drives control flow.
  }
  return settle<T>(path, res.status, body);
}

function settle<T>(path: string, status: number, body: any): T {
  if (status === 401) {
    setAuthToken(null);
  }

  if (status < 200 || status >= 300) {
    throw new ApiError(status, body?.error || `Request to ${path} failed (${status}).`, body);
  }
  return body as T;
}

/** The last line of a held-open response: the route's real status and body. */
export function readHeldOpenResult(text: string): { status: number; body: any } | null {
  for (const line of text.split("\n").reverse()) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event?.type === "result" && typeof event.status === "number") return { status: event.status, body: event.body };
    } catch {
      // A line cut short by a dropped connection; keep looking.
    }
  }
  return null;
}

/**
 * For requests that can take minutes (a campaign recap, a QA audit). The production domain is
 * behind Cloudflare, which fails a request with a 524 when the server sends nothing for 100
 * seconds. Asking for application/x-ndjson makes the server hold the response open with a
 * heartbeat line every 15 seconds and send the real status and body last (holdOpenForLongRequest
 * in server.ts). A server that does not do this answers with plain JSON, handled as before.
 */
async function longRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = getAuthHeaders(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Accept", "application/x-ndjson, application/json");

  const res = await fetch(path, { credentials: "include", ...init, headers });
  if (!(res.headers.get("Content-Type") || "").includes("application/x-ndjson")) {
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      // As in request(): the status still decides.
    }
    return settle<T>(path, res.status, body);
  }

  let text = "";
  try {
    text = await res.text();
  } catch {
    // The connection dropped mid-response; handled below as a missing result.
  }
  const result = readHeldOpenResult(text);
  if (!result) {
    throw new ApiError(
      502,
      "The connection closed before the server finished. The work may still have completed: reload the plan before trying again.",
    );
  }
  return settle<T>(path, result.status, result.body);
}

// --- session ---------------------------------------------------------------

export async function fetchSession(): Promise<SessionUser | null> {
  try {
    const body = await request<{ authenticated: boolean; user: SessionUser; token?: string }>("/api/auth/me");
    if (body.authenticated && body.token) {
      setAuthToken(body.token);
    }
    return body.authenticated ? body.user : null;
  } catch (err) {
    if (err instanceof ApiError && err.isUnauthenticated) {
      setAuthToken(null);
      return null;
    }
    throw err;
  }
}

export async function login(input: {
  username: string;
  password: string;
  displayName: string;
  adminPassword?: string;
}): Promise<SessionUser> {
  const body = await request<{ user: SessionUser; token?: string }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (body.token) {
    setAuthToken(body.token);
  }
  return body.user;
}

/**
 * Names already in use that match what is being typed at sign-in. The server answers only when
 * the team's username and password are right, so it returns nothing until those are filled in.
 */
export async function suggestNames(input: { username: string; password: string; query: string }): Promise<Array<{ name: string; plans: number }>> {
  try {
    const body = await request<{ names: Array<{ name: string; plans: number }> }>("/api/auth/name-suggestions", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return Array.isArray(body.names) ? body.names : [];
  } catch {
    return [];
  }
}

export async function logout(): Promise<void> {
  try {
    await request("/api/auth/logout", { method: "POST" });
  } finally {
    setAuthToken(null);
  }
}

// --- usage -----------------------------------------------------------------

/**
 * Records an action only the browser sees (an export, opening a plan) in the server's usage
 * log. Best effort: losing one usage record must never surface as an error to the planner.
 */
export function recordUsage(action: "plan_open" | "plan_save" | "export", details: { planId?: string | null; advertiserName?: string; detail?: string } = {}): void {
  if (!getAuthToken()) return;
  request("/api/usage/events", {
    method: "POST",
    body: JSON.stringify({ action, planId: details.planId || undefined, advertiserName: details.advertiserName, detail: details.detail }),
    keepalive: true,
  }).catch(() => undefined);
}

export async function getUsageSummary(days: number): Promise<UsageSummary> {
  const body = await request<{ summary: UsageSummary }>(`/api/usage/summary?days=${encodeURIComponent(String(days))}`);
  return body.summary;
}

// --- leadership dashboard -----------------------------------------------------

export type DashboardViewer = { via: "admin" | "member"; name: string } | { via: "link"; label: string; sharedBy: string };

/** `key` is a view-only dashboard link's key; without one the signed-in session is used. */
export async function getDashboardData(range: { from: string; to: string }, options: { key?: string | null; firstLoad?: boolean; users?: string[] | null } = {}): Promise<{ data: DashboardData; viewer: DashboardViewer }> {
  const headers: Record<string, string> = {};
  if (options.key) headers["x-dashboard-key"] = options.key;
  if (options.firstLoad) headers["x-dashboard-visit"] = "1";
  // The viewer's timezone, so the charts' days are the viewer's days.
  const query = new URLSearchParams({ from: range.from, to: range.to, tz: String(new Date().getTimezoneOffset()) });
  for (const user of options.users ?? []) query.append("user", user);
  return request(`/api/dashboard/data?${query.toString()}`, { headers });
}

export async function listDashboardLinks(): Promise<{ links: DashboardLink[]; config: DashboardConfig }> {
  return request("/api/dashboard/links");
}

export async function createDashboardLink(label: string): Promise<DashboardLink> {
  const body = await request<{ link: DashboardLink }>("/api/dashboard/links", { method: "POST", body: JSON.stringify({ label }) });
  return body.link;
}

export async function revokeDashboardLink(token: string): Promise<DashboardLink> {
  const body = await request<{ link: DashboardLink }>("/api/dashboard/links/revoke", { method: "POST", body: JSON.stringify({ token }) });
  return body.link;
}

export async function saveDashboardConfig(config: Pick<DashboardConfig, "hoursPerPlan" | "excludedNames">): Promise<DashboardConfig> {
  const body = await request<{ config: DashboardConfig }>("/api/dashboard/config", { method: "PUT", body: JSON.stringify(config) });
  return body.config;
}

export async function backfillDashboardHistory(): Promise<{ plansScanned: number; generations: number; shares: number; skipped: number }> {
  return request("/api/dashboard/backfill", { method: "POST" });
}

/** The address leadership opens. The key sits after "#", so it never reaches a server log. */
export const dashboardLinkUrl = (token: string, range?: string) =>
  `${window.location.origin}/dashboard#key=${encodeURIComponent(token)}${range ? `&range=${encodeURIComponent(range)}` : ""}`;

// --- plans -----------------------------------------------------------------

export async function listPlans(): Promise<PlanSummary[]> {
  const body = await request<{ plans: PlanSummary[] }>("/api/plans");
  return body.plans || [];
}

export async function getPlan(id: string): Promise<StoredPlan> {
  const body = await request<{ plan: StoredPlan }>(`/api/plans/${encodeURIComponent(id)}`);
  return body.plan;
}

export async function createPlan(input: {
  title: string;
  advertiserName?: string;
  settingsRevision: number | null;
  payload: PlanPayload;
}): Promise<StoredPlan> {
  const body = await request<{ plan: StoredPlan }>("/api/plans", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return body.plan;
}

/**
 * `checkpointReason` takes a History checkpoint before this write whatever the last one was; without
 * it the server checkpoints edits at most every 15 minutes. Only reasons the server allows are kept.
 */
export async function updatePlan(
  id: string,
  expectedRevision: number,
  input: { title: string; advertiserName?: string; settingsRevision: number | null; payload: PlanPayload },
  options: { checkpointReason?: "media_plan" } = {},
): Promise<StoredPlan> {
  const body = await request<{ plan: StoredPlan }>(`/api/plans/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "If-Match": String(expectedRevision) },
    body: JSON.stringify(options.checkpointReason ? { ...input, checkpointReason: options.checkpointReason } : input),
  });
  return body.plan;
}

// --- version history ---------------------------------------------------------

/** Mirrors PlanVersionSummary in src/storage/types.ts. Each holds the plan as it stood before `reason`. */
export interface PlanVersionSummary {
  id: string;
  planId: string;
  reason: "original" | "editing" | "scout" | "qa_fixes" | "recap" | "restore" | "media_plan" | "content_refresh";
  createdAt: string;
  createdBy: string;
  planRevision: number;
  savedAt: string;
  savedBy: string;
  title: string;
}

export async function listPlanVersions(planId: string): Promise<PlanVersionSummary[]> {
  const body = await request<{ versions: PlanVersionSummary[] }>(`/api/plans/${encodeURIComponent(planId)}/versions`);
  return body.versions;
}

/** Puts a checkpoint back as the plan's newest revision. The plan as it was is checkpointed first. */
export async function restorePlanVersion(planId: string, versionId: string, expectedRevision: number): Promise<StoredPlan> {
  const body = await request<{ plan: StoredPlan }>(`/api/plans/${encodeURIComponent(planId)}/versions/${encodeURIComponent(versionId)}/restore`, {
    method: "POST",
    headers: { "If-Match": String(expectedRevision) },
    body: JSON.stringify({}),
  });
  return body.plan;
}

// --- manual QA audit ----------------------------------------------------------

export interface AuditProposal {
  findingId: string;
  path: string;
  before: string;
  after: string;
}

export interface PlanAuditResponse {
  planId: string;
  /** The revision that was audited; approving fixes is refused if the plan has moved on. */
  revision: number;
  audit: {
    executiveSummary: string;
    scorecard: Array<{ category: string; score: number; notes: string }>;
    totalScore: number;
    findings: import("../types").AuditFindingRecord[];
    strategicHighlights: string[];
  };
  proposals: AuditProposal[];
  notes: unknown;
  fixError: string | null;
  auditModel: string;
}

/** Audits the saved plan and proposes fixes. Changes nothing. Takes a few minutes. */
export async function auditPlan(id: string): Promise<PlanAuditResponse> {
  return longRequest<PlanAuditResponse>(`/api/plans/${encodeURIComponent(id)}/audit`, { method: "POST" });
}

/**
 * Rewrites the plan's narrative (and leads its CTV publishers with the uploaded plan's) for the
 * channel plan it has now, and saves it. Takes a minute or two.
 */
export async function refreshPlanContent(id: string, expectedRevision: number): Promise<StoredPlan> {
  const body = await longRequest<{ plan: StoredPlan }>(`/api/plans/${encodeURIComponent(id)}/refresh-content`, {
    method: "POST",
    body: JSON.stringify({ expectedRevision }),
  });
  return body.plan;
}

/** Applies the approved fixes, re-verifies and saves the plan with the new audit. */
export async function applyPlanAudit(
  id: string,
  body: { expectedRevision: number; audit: PlanAuditResponse["audit"]; accepted: AuditProposal[]; notes: unknown },
): Promise<{ plan: StoredPlan; applied: number; stale: number; verifyError: string | null }> {
  return longRequest(`/api/plans/${encodeURIComponent(id)}/audit/apply`, { method: "POST", body: JSON.stringify(body) });
}

// --- ScoutAI plan assistant ---------------------------------------------------

export type { AssistantOp, ProposalChange, ChatTurn, FollowUp };

/** One recommendation in a proposal, which the planner can keep or leave out. */
export interface ScoutItem {
  id: string;
  title: string;
  why: string;
  /** The past-performance figures this recommendation rests on, when it rests on any. */
  evidence?: string | null;
  /** Figures in this recommendation that are in neither the campaign data nor the plan. */
  unverifiedFigures?: string[];
  ops: AssistantOp[];
  /** This item's effect on its own, from a server dry run. */
  changes: ProposalChange[];
  rejected: string[];
}

export interface ScoutProposal {
  summary: string;
  items: ScoutItem[];
  /** Every item together, from a server dry run: exactly what Apply saves when all are kept. */
  changes: ProposalChange[];
  /** Parts of the request that could not be included, and why. */
  rejected: string[];
  /** The plan revision the dry run read. Apply is refused if the plan has moved on. */
  baseRevision: number;
}

export interface ScoutReply {
  reply: string;
  proposal: ScoutProposal | null;
  /** Instructions for the executive summary generator, when ScoutAI suggests rewriting it. */
  executiveSummaryInstructions: string | null;
  revision: number;
  /** For past-performance analysis: whether it read the review summary or the full campaign rows. */
  depth: "summary" | "full" | null;
  /** The conversation-log record of this answer, for rating it and recording what was applied. */
  logId: string | null;
}

/**
 * One ScoutAI turn. The server streams newline-delimited JSON: thought headlines while the
 * model works, then the reply. `onThought` receives each headline as it arrives.
 */
export async function askScout(
  id: string,
  messages: ChatTurn[],
  onThought: (text: string) => void,
  signal?: AbortSignal,
  /** The library prompt the planner started from, so the server knows what kind of turn it is. */
  promptId?: string,
  /** "recap" when the plan view asked on the planner's behalf, for the usage log. */
  from?: "recap",
  /** Which chat this is and how many questions it has had, for the conversation log. */
  log?: { conversationId: string; turn: number },
): Promise<ScoutReply> {
  const res = await authFetch(`/api/plans/${encodeURIComponent(id)}/assistant/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, ...(promptId ? { promptId } : {}), ...(from ? { from } : {}), ...(log ?? {}) }),
    signal,
  });
  if (!res.ok || !res.body) {
    let body: any = null;
    try { body = await res.json(); } catch { /* non-JSON error page */ }
    throw new ApiError(res.status, body?.error || `ScoutAI request failed (${res.status}).`, body);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: ScoutReply | null = null;
  const handle = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "thought" && typeof event.text === "string") onThought(event.text);
    else if (event.type === "result") {
      result = {
        reply: String(event.reply ?? ""),
        proposal: event.proposal ?? null,
        executiveSummaryInstructions: typeof event.executiveSummaryInstructions === "string" ? event.executiveSummaryInstructions : null,
        revision: Number(event.revision),
        depth: event.depth === "summary" || event.depth === "full" ? event.depth : null,
        logId: typeof event.logId === "string" ? event.logId : null,
      };
    }
    else if (event.type === "error") throw new ApiError(502, event.error || "ScoutAI couldn't answer just now.", event);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      handle(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
    }
  }
  handle(buffer + decoder.decode());
  if (!result) throw new ApiError(502, "ScoutAI's answer was cut off. Please try again.");
  return result;
}

/** Thumbs up or down on a ScoutAI answer (null clears it), with an optional note. */
export async function rateScoutAnswer(logId: string, rating: "up" | "down" | null, comment?: string): Promise<void> {
  await request(`/api/scout-logs/${encodeURIComponent(logId)}/feedback`, { method: "POST", body: JSON.stringify({ rating, ...(comment ? { comment } : {}) }) });
}

/** Admin-only: every ScoutAI question and answer between two times, newest first. */
export async function listScoutLogs(options: { days: number; until: string; limit?: number }): Promise<{ logs: ScoutLog[]; since: string; until: string }> {
  const params = new URLSearchParams({ days: String(options.days), until: options.until, limit: String(options.limit ?? 1000) });
  return request(`/api/scout-logs?${params}`);
}

/** The page's scope, sent with Ask and topic tagging so the server reads the same questions. */
export interface ScoutReviewScope {
  since: string;
  until: string;
  filters?: ReviewFilters;
  /** How the admin sees the scope ("Last 30 days · Ana · thumbs down"), for the model. */
  scope?: string;
}

export interface ScoutAskResponse {
  blocks: AskBlock[];
  /** The answer as plain text, sent back as history with the next question. */
  text: string;
  basedOn: { total: number; listed: number; capped: boolean };
  model: string;
  thinkingLevel: string;
  durationMs: number;
}

/** Admin-only: a question about the ScoutAI questions in scope. Can take a minute or two. */
export async function askScoutLogs(scope: ScoutReviewScope, messages: Array<{ role: "admin" | "assistant"; text: string }>): Promise<ScoutAskResponse> {
  return longRequest(`/api/scout-logs/ask`, { method: "POST", body: JSON.stringify({ ...scope, messages }) });
}

/** Admin-only: tags the topic of up to a batch of untagged questions in the range. */
export async function tagScoutTopics(scope: Pick<ScoutReviewScope, "since" | "until">): Promise<{ tagged: number; remaining: number }> {
  return longRequest(`/api/scout-logs/tag-topics`, { method: "POST", body: JSON.stringify(scope) });
}

/** Admin-only: the reviewer's own rating of an answer (null clears it). Leaves the planner's thumbs alone. */
export async function reviewScoutAnswer(logId: string, rating: "up" | "down" | null, notes?: string): Promise<ScoutLog> {
  const { log } = await request<{ log: ScoutLog }>(`/api/scout-logs/${encodeURIComponent(logId)}/review`, { method: "POST", body: JSON.stringify({ rating, ...(notes ? { notes } : {}) }) });
  return log;
}

/** Dry-runs the items a planner has kept. Changes nothing. */
export async function previewScoutChange(
  id: string,
  body: { ops: AssistantOp[]; baseRevision: number },
): Promise<{ changes: ProposalChange[]; rejected: string[] }> {
  return request(`/api/plans/${encodeURIComponent(id)}/assistant/preview`, { method: "POST", body: JSON.stringify(body) });
}

/** Applies a ScoutAI change (or reverts one) and saves the plan. */
export async function applyScoutChange(
  id: string,
  /** `from: "scout"` marks the ScoutAI panel's own Apply/Undo for the usage log, with the prompt that led to it. */
  body: { ops: AssistantOp[]; baseRevision: number; revert?: boolean; from?: "scout"; promptId?: string; logId?: string },
): Promise<{ plan: StoredPlan; changes: ProposalChange[]; revertOps: AssistantOp[]; followUps: FollowUp[] }> {
  return request(`/api/plans/${encodeURIComponent(id)}/assistant/apply`, { method: "POST", body: JSON.stringify(body) });
}

export interface ScoutPromptLibrary {
  prompts: ScoutPrompt[];
  revision: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export function getScoutPrompts(): Promise<ScoutPromptLibrary> {
  return request<ScoutPromptLibrary>("/api/scout-prompts");
}

/** Admin only. `baseRevision` is the revision that was edited; a stale one is refused with 409. */
export function saveScoutPrompts(prompts: ScoutPrompt[], baseRevision: number): Promise<ScoutPromptLibrary> {
  return request<ScoutPromptLibrary>("/api/scout-prompts", { method: "PUT", body: JSON.stringify({ prompts, baseRevision }) });
}

export function resetScoutPrompts(baseRevision: number): Promise<ScoutPromptLibrary> {
  return request<ScoutPromptLibrary>("/api/scout-prompts/reset", { method: "POST", body: JSON.stringify({ baseRevision }) });
}

/** Builds (or rebuilds) the plan's Campaign Recap from its linked past campaigns and saves it. */
export async function buildCampaignRecap(id: string, baseRevision: number): Promise<{ plan: StoredPlan; dropped: string[] }> {
  return longRequest(`/api/plans/${encodeURIComponent(id)}/campaign-recap`, { method: "POST", body: JSON.stringify({ baseRevision }) });
}

export async function archivePlan(id: string): Promise<void> {
  await request(`/api/plans/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** `staffPreview` is true when a planner (signed in now or before, on this browser) opened the link. */
/** Reads an uploaded media plan file on the server (cached there by file contents). */
export async function parseMediaPlan(file: File): Promise<{ placements: ExtractedPlacement[]; rfpAnalysis: RfpAnalysis | null }> {
  const form = new FormData();
  form.append("file", file);
  const res = await authFetch("/api/parse-plan", { method: "POST", body: form });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success || !Array.isArray(body?.placements)) {
    throw new Error(body?.error ? `${body.error}${body.details ? `: ${body.details}` : ""}` : "The media plan could not be read.");
  }
  if (body.placements.length === 0) throw new Error("No media lines were found in that file.");
  return { placements: body.placements, rfpAnalysis: body.rfpAnalysis || null };
}

export async function fetchSharedPlan(token: string): Promise<{ plan: StoredPlan; staffPreview: boolean }> {
  const body = await request<{ plan: StoredPlan; staffPreview?: boolean }>(`/api/share/plan?token=${encodeURIComponent(token)}`);
  return { plan: body.plan, staffPreview: Boolean(body.staffPreview) };
}

export async function enablePlanShare(
  id: string,
  regenerate = false,
): Promise<{ shareToken: string; isShared: boolean }> {
  return request<{ shareToken: string; isShared: boolean }>(`/api/plans/${encodeURIComponent(id)}/share`, {
    method: "POST",
    body: JSON.stringify({ regenerate }),
  });
}

export async function revokePlanShare(id: string): Promise<{ shareToken: string | null; isShared: boolean }> {
  return request<{ shareToken: string | null; isShared: boolean }>(`/api/plans/${encodeURIComponent(id)}/unshare`, {
    method: "POST",
  });
}

// --- settings ---------------------------------------------------------------

export interface SettingsResponse {
  settings: PlanningSettings;
  revision: number;
  updatedAt?: string;
  updatedBy?: string;
}

export async function fetchSettings(): Promise<SettingsResponse> {
  return request<SettingsResponse>("/api/settings");
}

export async function fetchSettingsRevision(revision: number): Promise<SettingsResponse | null> {
  try {
    return await request<SettingsResponse>(`/api/settings/revisions/${revision}`);
  } catch (err) {
    // A missing revision is not fatal - the caller falls back to live settings.
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export async function saveSettings(settings: PlanningSettings): Promise<SettingsResponse> {
  return request<SettingsResponse>("/api/settings", { method: "PUT", body: JSON.stringify(settings) });
}

export async function fetchPublishers(): Promise<{ publishers: CtvPublisherSetting[]; revision: number }> {
  return request<{ publishers: CtvPublisherSetting[]; revision: number }>("/api/ctv-publishers");
}

export async function savePublishers(
  publishers: CtvPublisherSetting[],
): Promise<{ publishers: CtvPublisherSetting[]; revision: number }> {
  return request("/api/ctv-publishers", { method: "PUT", body: JSON.stringify({ publishers }) });
}

// --- past campaign performance --------------------------------------------------

export type { CampaignAnalysis, Warning as PerformanceWarning } from "../performance/campaign";
export type { PerformanceCampaignSummary, PreparedFile, PerformanceReview, ReviewFinding, PlanVsActual };

export interface CampaignDetailsInput {
  advertiserName?: string;
  name?: string;
  flightStart?: string | null;
  flightEnd?: string | null;
  conversionLabel?: string | null;
  campaignGoal?: string | null;
  notes?: string | null;
}

export interface PerformanceCampaignView extends PerformanceCampaignSummary {
  files: Array<{ id: string; fileName: string; sizeBytes: number; uploadedAt: string; uploadedBy: string; source: "export" | "browser-summary" }>;
}

export interface CampaignResponse {
  campaign: PerformanceCampaignView;
  analysis: CampaignAnalysis;
  review: PerformanceReview | null;
  /** The reports or details changed after the review was written. */
  reviewStale: boolean;
  /** The advertiser the files name, when it is not the campaign's. */
  advertiserMismatch: string | null;
  rejected?: string[];
  duplicates?: string[];
}

export interface PerformancePreview {
  analysis: CampaignAnalysis;
  suggested: CampaignDetailsInput;
  duplicates: string[];
  /** Earlier exports of the same reports a live campaign's new upload replaces. */
  replaced?: string[];
  rejected: string[];
  advertiserMismatch: string | null;
}

export async function listPerformanceCampaigns(filter: { advertiser?: string; planId?: string }): Promise<PerformanceCampaignSummary[]> {
  const query = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as string[][]).toString();
  const body = await request<{ campaigns: PerformanceCampaignSummary[] }>(`/api/performance/campaigns${query ? `?${query}` : ""}`);
  return body.campaigns || [];
}

export function previewPerformanceFiles(input: { files: PreparedFile[]; campaignId?: string; details?: CampaignDetailsInput; kind?: "past" | "live" }): Promise<PerformancePreview> {
  return request<PerformancePreview>("/api/performance/preview", { method: "POST", body: JSON.stringify(input) });
}

export function createPerformanceCampaign(input: { details: CampaignDetailsInput; files: PreparedFile[]; planId?: string; kind?: "past" | "live" }): Promise<CampaignResponse> {
  return request<CampaignResponse>("/api/performance/campaigns", { method: "POST", body: JSON.stringify(input) });
}

export function getPerformanceCampaign(id: string): Promise<CampaignResponse> {
  return request<CampaignResponse>(`/api/performance/campaigns/${encodeURIComponent(id)}`);
}

/** One saved export's text. Touch-level exports have none (only their summary was uploaded). */
export async function getPerformanceFileText(campaignId: string, fileId: string): Promise<string> {
  const body = await request<{ text: string }>(`/api/performance/campaigns/${encodeURIComponent(campaignId)}/files/${encodeURIComponent(fileId)}`);
  return body.text;
}

export function updatePerformanceCampaign(
  id: string,
  expectedRevision: number,
  input: { details?: CampaignDetailsInput; addFiles?: PreparedFile[]; removeFileIds?: string[]; linkPlanIds?: string[]; unlinkPlanIds?: string[] },
): Promise<CampaignResponse> {
  return request<CampaignResponse>(`/api/performance/campaigns/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "If-Match": String(expectedRevision) },
    body: JSON.stringify(input),
  });
}

export async function archivePerformanceCampaign(id: string): Promise<void> {
  await request(`/api/performance/campaigns/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Writes (or rewrites) the campaign's saved review. Takes up to a couple of minutes. */
export function reviewPerformanceCampaign(id: string, expectedRevision: number): Promise<CampaignResponse> {
  return longRequest<CampaignResponse>(`/api/performance/campaigns/${encodeURIComponent(id)}/review`, {
    method: "POST",
    headers: { "If-Match": String(expectedRevision) },
  });
}

/** The plan's live campaign compared with the plan, or null when it has none. */
export async function getPlanLive(planId: string): Promise<{ campaign: PerformanceCampaignView; comparison: PlanVsActual } | null> {
  const body = await request<{ live: { campaign: PerformanceCampaignView; comparison: PlanVsActual } | null }>(`/api/plans/${encodeURIComponent(planId)}/live`);
  return body.live;
}
