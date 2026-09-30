import crypto from "crypto";
import { DEFAULT_PLANNING_SETTINGS, migrateStoredSettings, validatePlanningSettings, PlanningSettings } from "../planning/settings";
import { DEFAULT_CTV_PUBLISHERS, validateCtvPublishers, enrichPublishersWithKnownLogos, CtvPublisherSetting } from "../planning/knowledge/ctvPublishers";
import { getAccessToken } from "./googleAuth";
import { decodeFields, encodeFields } from "./firestoreValue";
import { sortByUpdatedDesc, toSummary } from "./localFileAdapter";
import {
  assertCampaignFits,
  buildCampaignRecord,
  CampaignNotFoundError,
  CreatePlanInput,
  ListPlansOptions,
  PlanNotFoundError,
  PlanSummary,
  PublishersRecord,
  RevisionConflictError,
  SettingsRecord,
  StorageAdapter,
  StoredPlan,
  toCampaignSummary,
  UpdatePlanInput,
  type PerformanceCampaign,
  type PerformanceCampaignInput,
  type PerformanceCampaignSummary,
} from "./types";

/**
 * Production driver: Firestore in Native mode, over the REST API.
 *
 * Collections
 *   plans/{id}                  metadata as real fields + payloadJson as one string
 *   settings/current            pointer to the live settings revision
 *   settings_revisions/{n}      immutable history, referenced by each plan
 *   publishers/current          live CTV publisher list
 *   performance_campaigns/{id}  past campaign report sets: metadata fields + filesJson
 *
 * Concurrency is compare-and-swap: every write carries a currentDocument precondition
 * on the updateTime we read, so two people saving the same plan cannot silently clobber
 * each other - the loser gets a 409 and is told to reload.
 */

const PLANS = "plans";
const SHARES = "shares";
const SETTINGS = "settings";
const SETTINGS_REVISIONS = "settings_revisions";
const PUBLISHERS = "publishers";
const CURRENT_DOC = "current";
const PERFORMANCE = "performance_campaigns";

const CAMPAIGN_SUMMARY_FIELDS = [
  "id", "revision", "advertiserName", "advertiserKey", "name", "flightStart", "flightEnd", "conversionLabel", "campaignGoal", "notes",
  "linkedPlanIdsJson", "fileCount", "createdAt", "createdBy", "updatedAt", "updatedBy", "archived",
];

/** Metadata fields fetched when listing, so the sidebar never downloads plan payloads. */
const SUMMARY_FIELDS = [
  "id",
  "revision",
  "title",
  "advertiserName",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
  "archived",
  "settingsRevision",
  "audienceDescription",
  "geography",
  "campaignFocus",
  "url",
  "shareToken",
  "isShared",
];

interface FirestoreDocument {
  name?: string;
  fields?: Record<string, any>;
  createTime?: string;
  updateTime?: string;
}

export class FirestoreAdapter implements StorageAdapter {
  readonly name = "firestore";

  private readonly projectId: string;
  private readonly databaseId: string;
  private initialized = false;

  constructor(projectId: string, databaseId: string = process.env.FIRESTORE_DATABASE_ID || "(default)") {
    this.projectId = projectId;
    this.databaseId = databaseId;
  }

  private get baseUrl(): string {
    return `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/${this.databaseId}/documents`;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    // Touching the settings doc both proves credentials work and seeds defaults on a
    // brand-new database, so the first real request is not the one that discovers a
    // misconfigured service account.
    await this.getCurrentSettings();
    this.initialized = true;
  }

  // --- HTTP ----------------------------------------------------------------

  private async request(method: string, urlPath: string, body?: unknown, query?: string[][]): Promise<any> {
    const token = await getAccessToken();
    const search = query && query.length > 0 ? `?${new URLSearchParams(query as any).toString()}` : "";
    const res = await fetch(`${this.baseUrl}${urlPath}${search}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text();
      const error: any = new Error(`Firestore ${method} ${urlPath} failed (${res.status}): ${text}`);
      error.status = res.status;
      throw error;
    }
    if (res.status === 204) return null;
    return res.json();
  }

  /** A precondition failure surfaces as 400 FAILED_PRECONDITION or 409 ABORTED. */
  private isPreconditionFailure(err: any): boolean {
    return err?.status === 409 || (err?.status === 400 && /FAILED_PRECONDITION|precondition/i.test(err.message || ""));
  }

  private async getDocument(collection: string, id: string, fieldMask?: string[]): Promise<FirestoreDocument | null> {
    const query = (fieldMask || []).map((f) => ["mask.fieldPaths", f]);
    return this.request("GET", `/${collection}/${encodeURIComponent(id)}`, undefined, query);
  }

  /**
   * Create or overwrite a document.
   *  - requireAbsent: fails if the document already exists (create-only)
   *  - expectedUpdateTime: fails unless the stored updateTime still matches (CAS)
   */
  private async putDocument(
    collection: string,
    id: string,
    data: Record<string, unknown>,
    options: { requireAbsent?: boolean; expectedUpdateTime?: string } = {},
  ): Promise<FirestoreDocument> {
    const query: string[][] = [];
    if (options.requireAbsent) query.push(["currentDocument.exists", "false"]);
    if (options.expectedUpdateTime) query.push(["currentDocument.updateTime", options.expectedUpdateTime]);
    // Without an explicit mask, PATCH replaces only the fields supplied; listing every
    // field keeps the document an exact mirror of `data` (removed keys really go away).
    for (const key of Object.keys(data)) query.push(["updateMask.fieldPaths", key]);

    return this.request("PATCH", `/${collection}/${encodeURIComponent(id)}`, { fields: encodeFields(data) }, query);
  }

  private async listDocuments(collection: string, fieldMask?: string[]): Promise<FirestoreDocument[]> {
    const docs: FirestoreDocument[] = [];
    let pageToken: string | undefined;
    do {
      const query: string[][] = [["pageSize", "300"]];
      for (const f of fieldMask || []) query.push(["mask.fieldPaths", f]);
      if (pageToken) query.push(["pageToken", pageToken]);
      const page = await this.request("GET", `/${collection}`, undefined, query);
      if (page?.documents) docs.push(...page.documents);
      pageToken = page?.nextPageToken;
    } while (pageToken);
    return docs;
  }

  // --- plans ---------------------------------------------------------------

  async listPlans(options: ListPlansOptions = {}): Promise<PlanSummary[]> {
    const docs = await this.listDocuments(PLANS, SUMMARY_FIELDS);
    const summaries = docs
      .map((doc) => decodeFields(doc.fields || {}) as unknown as PlanSummary)
      .filter((plan) => Boolean(plan?.id))
      .filter((plan) => options.includeArchived || !plan.archived);
    return sortByUpdatedDesc(summaries);
  }

  async getPlan(id: string): Promise<StoredPlan | null> {
    const doc = await this.getDocument(PLANS, id);
    if (!doc) return null;
    return this.documentToPlan(doc);
  }

  async createPlan(input: CreatePlanInput): Promise<StoredPlan> {
    const now = new Date().toISOString();
    const plan: StoredPlan = {
      id: crypto.randomUUID(),
      revision: 1,
      title: input.title,
      advertiserName: input.advertiserName,
      audienceDescription: input.audienceDescription,
      geography: input.geography,
      campaignFocus: input.campaignFocus,
      url: input.url,
      createdAt: now,
      createdBy: input.actor,
      updatedAt: now,
      updatedBy: input.actor,
      archived: false,
      settingsRevision: input.settingsRevision,
      payload: input.payload,
    };
    await this.putDocument(PLANS, plan.id, this.planToFields(plan), { requireAbsent: true });
    return plan;
  }

  async updatePlan(id: string, input: UpdatePlanInput, expectedRevision: number): Promise<StoredPlan> {
    const doc = await this.getDocument(PLANS, id);
    if (!doc) throw new PlanNotFoundError(id);

    const existing = this.documentToPlan(doc);
    if (existing.revision !== expectedRevision) {
      throw new RevisionConflictError(existing.revision);
    }

    const updated: StoredPlan = {
      ...existing,
      revision: existing.revision + 1,
      title: input.title,
      advertiserName: input.advertiserName,
      audienceDescription: input.audienceDescription,
      geography: input.geography,
      campaignFocus: input.campaignFocus,
      url: input.url,
      settingsRevision: input.settingsRevision,
      payload: input.payload,
      updatedAt: new Date().toISOString(),
      updatedBy: input.actor,
    };

    try {
      await this.putDocument(PLANS, id, this.planToFields(updated), { expectedUpdateTime: doc.updateTime });
    } catch (err) {
      if (this.isPreconditionFailure(err)) {
        // Someone committed between our read and our write.
        const latest = await this.getPlan(id);
        throw new RevisionConflictError(latest?.revision ?? expectedRevision);
      }
      throw err;
    }
    return updated;
  }

  async archivePlan(id: string, actor: string): Promise<void> {
    await this.setArchived(id, actor, true);
  }

  async restorePlan(id: string, actor: string): Promise<void> {
    await this.setArchived(id, actor, false);
  }

  async getPlanByShareToken(token: string): Promise<StoredPlan | null> {
    if (!token) return null;
    await this.init();
    // 1. Look up the share mapping
    const shareDoc = await this.getDocument(SHARES, token);
    if (!shareDoc || !shareDoc.fields) return null;
    const shareData = decodeFields(shareDoc.fields) as Record<string, any>;
    if (shareData.active !== true || !shareData.planId) return null;

    // 2. Fetch the referenced plan
    const planDoc = await this.getDocument(PLANS, String(shareData.planId));
    if (!planDoc) return null;
    const plan = this.documentToPlan(planDoc);
    if (plan.archived || !plan.isShared || plan.shareToken !== token) return null;
    return plan;
  }

  async setPlanShare(id: string, isShared: boolean, shareToken?: string | null): Promise<StoredPlan> {
    await this.init();
    const doc = await this.getDocument(PLANS, id);
    if (!doc) throw new PlanNotFoundError(id);
    const existing = this.documentToPlan(doc);
    const token = shareToken !== undefined ? shareToken : existing.shareToken;
    const updated: StoredPlan = {
      ...existing,
      isShared,
      shareToken: token,
      updatedAt: new Date().toISOString(),
    };
    await this.putDocument(PLANS, id, this.planToFields(updated), { expectedUpdateTime: doc.updateTime });
    if (token) {
      await this.putDocument(SHARES, token, {
        planId: id,
        active: isShared,
        updatedAt: new Date().toISOString(),
      });
    }
    return updated;
  }

  private async setArchived(id: string, actor: string, archived: boolean): Promise<void> {
    const doc = await this.getDocument(PLANS, id);
    if (!doc) throw new PlanNotFoundError(id);
    const existing = this.documentToPlan(doc);
    const updated: StoredPlan = {
      ...existing,
      archived,
      revision: existing.revision + 1,
      updatedAt: new Date().toISOString(),
      updatedBy: actor,
    };
    try {
      await this.putDocument(PLANS, id, this.planToFields(updated), { expectedUpdateTime: doc.updateTime });
    } catch (err) {
      if (this.isPreconditionFailure(err)) throw new RevisionConflictError(existing.revision);
      throw err;
    }
  }

  private planToFields(plan: StoredPlan): Record<string, unknown> {
    const summary = toSummary(plan);
    return { ...summary, payloadJson: JSON.stringify(plan.payload ?? {}) };
  }

  private documentToPlan(doc: FirestoreDocument): StoredPlan {
    const fields = decodeFields(doc.fields || {}) as Record<string, any>;
    let payload: Record<string, unknown> = {};
    try {
      payload = fields.payloadJson ? JSON.parse(fields.payloadJson) : {};
    } catch (err) {
      console.error(`[STORAGE:firestore] Plan ${fields.id} has unparseable payloadJson:`, err);
    }
    return {
      id: fields.id,
      revision: Number(fields.revision) || 1,
      title: fields.title || "Untitled Plan",
      advertiserName: fields.advertiserName || undefined,
      createdAt: fields.createdAt,
      createdBy: fields.createdBy,
      updatedAt: fields.updatedAt,
      updatedBy: fields.updatedBy,
      archived: Boolean(fields.archived),
      settingsRevision: fields.settingsRevision === null || fields.settingsRevision === undefined ? null : Number(fields.settingsRevision),
      audienceDescription: fields.audienceDescription || undefined,
      geography: fields.geography || undefined,
      campaignFocus: fields.campaignFocus || undefined,
      url: fields.url || undefined,
      shareToken: fields.shareToken || undefined,
      isShared: fields.isShared !== undefined ? Boolean(fields.isShared) : undefined,
      payload,
    };
  }

  // --- settings ------------------------------------------------------------

  async getCurrentSettings(): Promise<SettingsRecord> {
    const doc = await this.getDocument(SETTINGS, CURRENT_DOC);
    if (doc) {
      const record = this.documentToSettings(doc);
      if (record) {
        // Migrate before validating: an older-version record is still the team's real
        // configuration, and falling through would reseed defaults over it.
        const migrated = validatePlanningSettings(migrateStoredSettings(record.settings));
        if (migrated.valid && migrated.settings) return { ...record, settings: migrated.settings };
      }
      console.warn("[STORAGE:firestore] settings/current failed validation; reseeding defaults.");
    }
    return this.saveSettings(DEFAULT_PLANNING_SETTINGS, "system");
  }

  async getSettingsRevision(revision: number): Promise<SettingsRecord | null> {
    const doc = await this.getDocument(SETTINGS_REVISIONS, String(revision));
    return doc ? this.documentToSettings(doc) : null;
  }

  async saveSettings(settings: PlanningSettings, actor: string): Promise<SettingsRecord> {
    const migrated = migrateStoredSettings(settings);
    const validation = validatePlanningSettings(migrated);
    if (!validation.valid || !validation.settings) {
      throw new Error(`Invalid planning settings: ${validation.errors.join("; ")}`);
    }

    // Retry the read-increment-write cycle if a concurrent admin save takes our revision.
    for (let attempt = 0; attempt < 3; attempt++) {
      const currentDoc = await this.getDocument(SETTINGS, CURRENT_DOC);
      const currentRecord = currentDoc ? this.documentToSettings(currentDoc) : null;
      const record: SettingsRecord = {
        revision: (currentRecord?.revision ?? 0) + 1,
        settings: validation.settings,
        updatedAt: new Date().toISOString(),
        updatedBy: actor,
      };
      const fields = {
        revision: record.revision,
        updatedAt: record.updatedAt,
        updatedBy: record.updatedBy,
        settingsJson: JSON.stringify(record.settings),
      };

      try {
        // History first: a revision doc must exist before any plan can reference it.
        await this.putDocument(SETTINGS_REVISIONS, String(record.revision), fields, { requireAbsent: true });
        await this.putDocument(SETTINGS, CURRENT_DOC, fields, { expectedUpdateTime: currentDoc?.updateTime });
        return record;
      } catch (err) {
        if (this.isPreconditionFailure(err)) continue;
        throw err;
      }
    }
    throw new Error("Could not save planning settings after repeated write conflicts. Please retry.");
  }

  private documentToSettings(doc: FirestoreDocument): SettingsRecord | null {
    const fields = decodeFields(doc.fields || {}) as Record<string, any>;
    try {
      return {
        revision: Number(fields.revision) || 1,
        settings: JSON.parse(fields.settingsJson),
        updatedAt: fields.updatedAt,
        updatedBy: fields.updatedBy,
      };
    } catch (err) {
      console.error("[STORAGE:firestore] Could not parse settingsJson:", err);
      return null;
    }
  }

  // --- publishers ----------------------------------------------------------

  async getCurrentPublishers(): Promise<PublishersRecord> {
    const doc = await this.getDocument(PUBLISHERS, CURRENT_DOC);
    if (doc) {
      const record = this.documentToPublishers(doc);
      if (record && record.publishers.length > 0) {
        return {
          ...record,
          publishers: enrichPublishersWithKnownLogos(record.publishers),
        };
      }
    }
    return this.savePublishers(DEFAULT_CTV_PUBLISHERS, "system");
  }

  async savePublishers(publishers: CtvPublisherSetting[], actor: string): Promise<PublishersRecord> {
    const enriched = enrichPublishersWithKnownLogos(publishers);
    const validation = validateCtvPublishers(enriched);
    if (!validation.valid) {
      throw new Error(`Invalid CTV publishers: ${validation.errors.join("; ")}`);
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const currentDoc = await this.getDocument(PUBLISHERS, CURRENT_DOC);
      const currentRecord = currentDoc ? this.documentToPublishers(currentDoc) : null;
      const record: PublishersRecord = {
        revision: (currentRecord?.revision ?? 0) + 1,
        publishers: validation.publishers,
        updatedAt: new Date().toISOString(),
        updatedBy: actor,
      };
      try {
        await this.putDocument(
          PUBLISHERS,
          CURRENT_DOC,
          {
            revision: record.revision,
            updatedAt: record.updatedAt,
            updatedBy: record.updatedBy,
            publishersJson: JSON.stringify(record.publishers),
          },
          { expectedUpdateTime: currentDoc?.updateTime },
        );
        return record;
      } catch (err) {
        if (this.isPreconditionFailure(err)) continue;
        throw err;
      }
    }
    throw new Error("Could not save CTV publishers after repeated write conflicts. Please retry.");
  }

  // --- past campaign performance ---------------------------------------------

  async listPerformanceCampaigns(options: ListPlansOptions = {}): Promise<PerformanceCampaignSummary[]> {
    const docs = await this.listDocuments(PERFORMANCE, CAMPAIGN_SUMMARY_FIELDS);
    const summaries = docs
      .map((doc) => this.documentToCampaign(doc, false))
      .filter((c): c is PerformanceCampaign => Boolean(c?.id))
      .filter((c) => options.includeArchived || !c.archived)
      .map(toCampaignSummary);
    return sortByUpdatedDesc(summaries);
  }

  async getPerformanceCampaign(id: string): Promise<PerformanceCampaign | null> {
    const doc = await this.getDocument(PERFORMANCE, id);
    return doc ? this.documentToCampaign(doc, true) : null;
  }

  async createPerformanceCampaign(input: PerformanceCampaignInput): Promise<PerformanceCampaign> {
    const campaign = buildCampaignRecord(crypto.randomUUID(), input, null, new Date().toISOString());
    assertCampaignFits(campaign.files, campaign.review);
    await this.putDocument(PERFORMANCE, campaign.id, this.campaignToFields(campaign), { requireAbsent: true });
    return campaign;
  }

  async updatePerformanceCampaign(id: string, input: PerformanceCampaignInput, expectedRevision: number): Promise<PerformanceCampaign> {
    const doc = await this.getDocument(PERFORMANCE, id);
    if (!doc) throw new CampaignNotFoundError(id);
    const existing = this.documentToCampaign(doc, true)!;
    if (existing.revision !== expectedRevision) throw new RevisionConflictError(existing.revision, "This campaign was changed by someone else.");
    const campaign = buildCampaignRecord(id, input, existing, new Date().toISOString());
    assertCampaignFits(campaign.files, campaign.review);
    try {
      await this.putDocument(PERFORMANCE, id, this.campaignToFields(campaign), { expectedUpdateTime: doc.updateTime });
    } catch (err) {
      if (this.isPreconditionFailure(err)) {
        const latest = await this.getDocument(PERFORMANCE, id);
        throw new RevisionConflictError(latest ? this.documentToCampaign(latest, false)!.revision : expectedRevision, "This campaign was changed by someone else.");
      }
      throw err;
    }
    return campaign;
  }

  async archivePerformanceCampaign(id: string, actor: string): Promise<void> {
    const doc = await this.getDocument(PERFORMANCE, id);
    if (!doc) throw new CampaignNotFoundError(id);
    const existing = this.documentToCampaign(doc, true)!;
    const archived = { ...existing, archived: true, revision: existing.revision + 1, updatedAt: new Date().toISOString(), updatedBy: actor };
    try {
      await this.putDocument(PERFORMANCE, id, this.campaignToFields(archived), { expectedUpdateTime: doc.updateTime });
    } catch (err) {
      if (this.isPreconditionFailure(err)) throw new RevisionConflictError(existing.revision, "This campaign was changed by someone else.");
      throw err;
    }
  }

  // Lists and files are JSON strings for the same reason plan payloads are: Firestore refuses
  // nested arrays, and report rows are nothing but.
  private campaignToFields(campaign: PerformanceCampaign): Record<string, unknown> {
    const { files, linkedPlanIds, review, ...summary } = campaign;
    return { ...summary, linkedPlanIdsJson: JSON.stringify(linkedPlanIds), filesJson: JSON.stringify(files), reviewJson: JSON.stringify(review ?? null) };
  }

  private documentToCampaign(doc: FirestoreDocument, withFiles: boolean): PerformanceCampaign | null {
    const fields = decodeFields(doc.fields || {}) as Record<string, any>;
    if (!fields.id) return null;
    const parse = (json: unknown, fallback: any) => {
      try {
        return typeof json === "string" ? JSON.parse(json) : fallback;
      } catch (err) {
        console.error(`[STORAGE:firestore] Campaign ${fields.id} has unparseable JSON:`, err);
        return fallback;
      }
    };
    const orNull = (v: unknown) => (v === undefined || v === null || v === "" ? null : String(v));
    return {
      id: fields.id,
      revision: Number(fields.revision) || 1,
      advertiserName: fields.advertiserName || "",
      advertiserKey: fields.advertiserKey || "",
      name: fields.name || "Untitled campaign",
      flightStart: orNull(fields.flightStart),
      flightEnd: orNull(fields.flightEnd),
      conversionLabel: orNull(fields.conversionLabel),
      campaignGoal: orNull(fields.campaignGoal),
      notes: orNull(fields.notes),
      linkedPlanIds: parse(fields.linkedPlanIdsJson, []),
      fileCount: Number(fields.fileCount) || 0,
      createdAt: fields.createdAt,
      createdBy: fields.createdBy,
      updatedAt: fields.updatedAt,
      updatedBy: fields.updatedBy,
      archived: Boolean(fields.archived),
      files: withFiles ? parse(fields.filesJson, []) : [],
      review: withFiles ? parse(fields.reviewJson, null) : null,
    };
  }

  private documentToPublishers(doc: FirestoreDocument): PublishersRecord | null {
    const fields = decodeFields(doc.fields || {}) as Record<string, any>;
    try {
      return {
        revision: Number(fields.revision) || 1,
        publishers: JSON.parse(fields.publishersJson),
        updatedAt: fields.updatedAt,
        updatedBy: fields.updatedBy,
      };
    } catch (err) {
      console.error("[STORAGE:firestore] Could not parse publishersJson:", err);
      return null;
    }
  }
}
