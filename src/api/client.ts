import type { SavedProfile } from "../types";
import type { PlanningSettings } from "../planning/settings";
import type { CtvPublisherSetting } from "../planning/knowledge/ctvPublishers";
import type { AssistantOp, ProposalChange } from "../assistant/operations";
import type { ChatTurn } from "../assistant/scoutChat";
import type { FollowUp } from "../assistant/followUps";
import type { CampaignAnalysis } from "../performance/campaign";
import type { PreparedFile } from "../performance/browserFiles";
import type { PerformanceCampaignSummary } from "../storage/types";

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

  if (res.status === 401) {
    setAuthToken(null);
  }

  if (!res.ok) {
    throw new ApiError(res.status, body?.error || `Request to ${path} failed (${res.status}).`, body);
  }
  return body as T;
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

export async function logout(): Promise<void> {
  try {
    await request("/api/auth/logout", { method: "POST" });
  } finally {
    setAuthToken(null);
  }
}

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

export async function updatePlan(
  id: string,
  expectedRevision: number,
  input: { title: string; advertiserName?: string; settingsRevision: number | null; payload: PlanPayload },
): Promise<StoredPlan> {
  const body = await request<{ plan: StoredPlan }>(`/api/plans/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "If-Match": String(expectedRevision) },
    body: JSON.stringify(input),
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
  return request<PlanAuditResponse>(`/api/plans/${encodeURIComponent(id)}/audit`, { method: "POST" });
}

/** Applies the approved fixes, re-verifies and saves the plan with the new audit. */
export async function applyPlanAudit(
  id: string,
  body: { expectedRevision: number; audit: PlanAuditResponse["audit"]; accepted: AuditProposal[]; notes: unknown },
): Promise<{ plan: StoredPlan; applied: number; stale: number; verifyError: string | null }> {
  return request(`/api/plans/${encodeURIComponent(id)}/audit/apply`, { method: "POST", body: JSON.stringify(body) });
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
): Promise<ScoutReply> {
  const res = await authFetch(`/api/plans/${encodeURIComponent(id)}/assistant/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
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
  body: { ops: AssistantOp[]; baseRevision: number; revert?: boolean },
): Promise<{ plan: StoredPlan; changes: ProposalChange[]; revertOps: AssistantOp[]; followUps: FollowUp[] }> {
  return request(`/api/plans/${encodeURIComponent(id)}/assistant/apply`, { method: "POST", body: JSON.stringify(body) });
}

export async function archivePlan(id: string): Promise<void> {
  await request(`/api/plans/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function fetchSharedPlan(token: string): Promise<StoredPlan> {
  const body = await request<{ plan: StoredPlan }>(`/api/share/plan?token=${encodeURIComponent(token)}`);
  return body.plan;
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
export type { PerformanceCampaignSummary, PreparedFile };

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
  /** The advertiser the files name, when it is not the campaign's. */
  advertiserMismatch: string | null;
  rejected?: string[];
  duplicates?: string[];
}

export interface PerformancePreview {
  analysis: CampaignAnalysis;
  suggested: CampaignDetailsInput;
  duplicates: string[];
  rejected: string[];
  advertiserMismatch: string | null;
}

export async function listPerformanceCampaigns(filter: { advertiser?: string; planId?: string }): Promise<PerformanceCampaignSummary[]> {
  const query = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as string[][]).toString();
  const body = await request<{ campaigns: PerformanceCampaignSummary[] }>(`/api/performance/campaigns${query ? `?${query}` : ""}`);
  return body.campaigns || [];
}

export function previewPerformanceFiles(input: { files: PreparedFile[]; campaignId?: string; details?: CampaignDetailsInput }): Promise<PerformancePreview> {
  return request<PerformancePreview>("/api/performance/preview", { method: "POST", body: JSON.stringify(input) });
}

export function createPerformanceCampaign(input: { details: CampaignDetailsInput; files: PreparedFile[]; planId?: string }): Promise<CampaignResponse> {
  return request<CampaignResponse>("/api/performance/campaigns", { method: "POST", body: JSON.stringify(input) });
}

export function getPerformanceCampaign(id: string): Promise<CampaignResponse> {
  return request<CampaignResponse>(`/api/performance/campaigns/${encodeURIComponent(id)}`);
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
