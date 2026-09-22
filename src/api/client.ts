import type { SavedProfile } from "../types";
import type { PlanningSettings } from "../planning/settings";
import type { CtvPublisherSetting } from "../planning/knowledge/ctvPublishers";

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

  constructor(status: number, message: string, body?: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = body?.code;
    this.currentRevision = body?.currentRevision;
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
