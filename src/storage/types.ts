import type { PlanningSettings } from "../planning/settings";
import type { CtvPublisherSetting } from "../planning/knowledge/ctvPublishers";

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

export interface ListPlansOptions {
  includeArchived?: boolean;
}

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
}
