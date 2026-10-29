import fs from "fs";
import path from "path";
import crypto from "crypto";
import { DEFAULT_PLANNING_SETTINGS, migrateStoredSettings, validatePlanningSettings, PlanningSettings } from "../planning/settings";
import { DEFAULT_CTV_PUBLISHERS, validateCtvPublishers, enrichPublishersWithKnownLogos, CtvPublisherSetting } from "../planning/knowledge/ctvPublishers";
import type { ScoutPrompt } from "../assistant/promptLibrary";
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
  ScoutPromptsRecord,
  SettingsRecord,
  StorageAdapter,
  StoredPlan,
  toCampaignSummary,
  UpdatePlanInput,
  type PerformanceCampaign,
  type PerformanceCampaignInput,
  type PerformanceCampaignSummary,
  type UsageEvent,
  type ScoutLog,
  type ScoutLogUpdate,
  DEFAULT_DASHBOARD_CONFIG,
  type DashboardConfig,
  type DashboardLink,
  type PlanVersion,
  type PlanVersionSummary,
} from "./types";
import { EMPTY_PEOPLE, type Person, type PeopleRecord } from "../people/people";

/**
 * Development driver. Writes the same records the Firestore driver writes, but to
 * disk under data/store/, so the whole feature can be built and tested without any
 * cloud credentials. Not for production: a Cloud Run container's disk does not
 * outlive the instance.
 */
export class LocalFileAdapter implements StorageAdapter {
  readonly name = "local-file";

  private readonly rootDir: string;
  private readonly plansDir: string;
  private readonly settingsDir: string;
  private readonly publishersDir: string;
  private readonly performanceDir: string;
  private readonly promptsDir: string;
  private readonly usageDir: string;
  private readonly dashboardDir: string;
  private readonly scoutLogsDir: string;
  private readonly planVersionsDir: string;

  constructor(rootDir: string = path.join(process.cwd(), "data", "store")) {
    this.rootDir = rootDir;
    this.plansDir = path.join(rootDir, "plans");
    this.settingsDir = path.join(rootDir, "settings");
    this.publishersDir = path.join(rootDir, "publishers");
    this.performanceDir = path.join(rootDir, "performance");
    this.promptsDir = path.join(rootDir, "scout-prompts");
    this.usageDir = path.join(rootDir, "usage");
    this.dashboardDir = path.join(rootDir, "dashboard");
    this.scoutLogsDir = path.join(rootDir, "scout-logs");
    this.planVersionsDir = path.join(rootDir, "plan-versions");
  }

  async init(): Promise<void> {
    for (const dir of [this.plansDir, this.settingsDir, this.publishersDir, this.performanceDir, this.promptsDir, this.usageDir, this.dashboardDir, this.scoutLogsDir, this.planVersionsDir]) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // --- plans ---------------------------------------------------------------

  async listPlans(options: ListPlansOptions = {}): Promise<PlanSummary[]> {
    await this.init();
    const files = fs.readdirSync(this.plansDir).filter((f) => f.endsWith(".json"));
    const summaries: PlanSummary[] = [];
    for (const file of files) {
      const plan = this.readPlanFile(path.join(this.plansDir, file));
      if (!plan) continue;
      if (plan.archived && !options.includeArchived) continue;
      summaries.push(toSummary(plan));
    }
    return sortByUpdatedDesc(summaries);
  }

  async getPlan(id: string): Promise<StoredPlan | null> {
    await this.init();
    return this.readPlanFile(this.planPath(id));
  }

  async createPlan(input: CreatePlanInput): Promise<StoredPlan> {
    await this.init();
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
    writeJsonAtomic(this.planPath(plan.id), plan);
    return plan;
  }

  async updatePlan(id: string, input: UpdatePlanInput, expectedRevision: number): Promise<StoredPlan> {
    await this.init();
    const existing = this.readPlanFile(this.planPath(id));
    if (!existing) throw new PlanNotFoundError(id);
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
    writeJsonAtomic(this.planPath(id), updated);
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
    const files = fs.readdirSync(this.plansDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const plan = this.readPlanFile(path.join(this.plansDir, file));
      if (plan && !plan.archived && plan.isShared && plan.shareToken === token) {
        return plan;
      }
    }
    return null;
  }

  async setPlanShare(id: string, isShared: boolean, shareToken?: string | null): Promise<StoredPlan> {
    await this.init();
    const existing = this.readPlanFile(this.planPath(id));
    if (!existing) throw new PlanNotFoundError(id);
    const updated: StoredPlan = {
      ...existing,
      isShared,
      shareToken: shareToken !== undefined ? shareToken : existing.shareToken,
      updatedAt: new Date().toISOString(),
    };
    writeJsonAtomic(this.planPath(id), updated);
    return updated;
  }

  // --- plan versions: plan-versions/{planId}/{versionId}.json ----------------

  async savePlanVersion(version: PlanVersion): Promise<void> {
    await this.init();
    fs.mkdirSync(this.planVersionDir(version.planId), { recursive: true });
    writeJsonAtomic(this.planVersionPath(version.planId, version.id), version);
  }

  async listPlanVersions(planId: string): Promise<PlanVersionSummary[]> {
    await this.init();
    const dir = this.planVersionDir(planId);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJson<PlanVersion>(path.join(dir, f)))
      .filter((v): v is PlanVersion => Boolean(v))
      .map(({ payload: _payload, settingsRevision: _settings, advertiserName: _advertiser, audienceDescription: _a, geography: _g, campaignFocus: _c, url: _u, ...summary }) => summary)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getPlanVersion(planId: string, versionId: string): Promise<PlanVersion | null> {
    await this.init();
    return readJson<PlanVersion>(this.planVersionPath(planId, versionId));
  }

  async deletePlanVersion(planId: string, versionId: string): Promise<void> {
    await this.init();
    fs.rmSync(this.planVersionPath(planId, versionId), { force: true });
  }

  private planVersionDir(planId: string): string {
    return path.join(this.planVersionsDir, safeFileId(planId));
  }

  private planVersionPath(planId: string, versionId: string): string {
    return path.join(this.planVersionDir(planId), `${safeFileId(versionId)}.json`);
  }

  private async setArchived(id: string, actor: string, archived: boolean): Promise<void> {
    await this.init();
    const existing = this.readPlanFile(this.planPath(id));
    if (!existing) throw new PlanNotFoundError(id);
    const updated: StoredPlan = {
      ...existing,
      archived,
      revision: existing.revision + 1,
      updatedAt: new Date().toISOString(),
      updatedBy: actor,
    };
    writeJsonAtomic(this.planPath(id), updated);
  }

  private planPath(id: string): string {
    // Guard against path traversal via a crafted id in the URL.
    const safe = id.replace(/[^a-zA-Z0-9._-]/g, "");
    return path.join(this.plansDir, `${safe}.json`);
  }

  private readPlanFile(filePath: string): StoredPlan | null {
    try {
      if (!fs.existsSync(filePath)) return null;
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (!parsed || typeof parsed.id !== "string") return null;
      return parsed as StoredPlan;
    } catch (err) {
      console.error(`[STORAGE:local] Could not read plan file ${filePath}:`, err);
      return null;
    }
  }

  // --- settings ------------------------------------------------------------

  async getCurrentSettings(): Promise<SettingsRecord> {
    await this.init();
    const current = readJson<SettingsRecord>(path.join(this.settingsDir, "current.json"));
    if (current) {
      // Migrate before validating: an older-version record is still the team's real
      // configuration, and falling through would reseed defaults over it.
      const migrated = validatePlanningSettings(migrateStoredSettings(current.settings));
      if (migrated.valid && migrated.settings) return { ...current, settings: migrated.settings };
    }
    return this.saveSettings(DEFAULT_PLANNING_SETTINGS, "system");
  }

  async getSettingsRevision(revision: number): Promise<SettingsRecord | null> {
    await this.init();
    return readJson<SettingsRecord>(path.join(this.settingsDir, `rev-${revision}.json`));
  }

  async saveSettings(settings: PlanningSettings, actor: string): Promise<SettingsRecord> {
    await this.init();
    const migrated = migrateStoredSettings(settings);
    const validation = validatePlanningSettings(migrated);
    if (!validation.valid || !validation.settings) {
      throw new Error(`Invalid planning settings: ${validation.errors.join("; ")}`);
    }
    const previous = readJson<SettingsRecord>(path.join(this.settingsDir, "current.json"));
    const record: SettingsRecord = {
      revision: (previous?.revision ?? 0) + 1,
      settings: validation.settings,
      updatedAt: new Date().toISOString(),
      updatedBy: actor,
    };
    writeJsonAtomic(path.join(this.settingsDir, `rev-${record.revision}.json`), record);
    writeJsonAtomic(path.join(this.settingsDir, "current.json"), record);
    return record;
  }

  // --- publishers ----------------------------------------------------------

  async getCurrentPublishers(): Promise<PublishersRecord> {
    await this.init();
    const current = readJson<PublishersRecord>(path.join(this.publishersDir, "current.json"));
    if (current && Array.isArray(current.publishers) && current.publishers.length > 0) {
      return {
        ...current,
        publishers: enrichPublishersWithKnownLogos(current.publishers),
      };
    }
    return this.savePublishers(DEFAULT_CTV_PUBLISHERS, "system");
  }

  async savePublishers(publishers: CtvPublisherSetting[], actor: string): Promise<PublishersRecord> {
    await this.init();
    const enriched = enrichPublishersWithKnownLogos(publishers);
    const validation = validateCtvPublishers(enriched);
    if (!validation.valid) {
      throw new Error(`Invalid CTV publishers: ${validation.errors.join("; ")}`);
    }
    const previous = readJson<PublishersRecord>(path.join(this.publishersDir, "current.json"));
    const record: PublishersRecord = {
      revision: (previous?.revision ?? 0) + 1,
      publishers: validation.publishers,
      updatedAt: new Date().toISOString(),
      updatedBy: actor,
    };
    writeJsonAtomic(path.join(this.publishersDir, "current.json"), record);
    return record;
  }

  // --- ScoutAI prompt library -------------------------------------------------

  async getScoutPrompts(): Promise<ScoutPromptsRecord | null> {
    await this.init();
    return readJson<ScoutPromptsRecord>(path.join(this.promptsDir, "current.json"));
  }

  async saveScoutPrompts(prompts: ScoutPrompt[], actor: string, expectedRevision: number): Promise<ScoutPromptsRecord> {
    await this.init();
    const file = path.join(this.promptsDir, "current.json");
    const current = readJson<ScoutPromptsRecord>(file);
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== expectedRevision) throw new RevisionConflictError(currentRevision, "The prompt library was changed by someone else.");
    const record: ScoutPromptsRecord = { revision: currentRevision + 1, prompts, updatedAt: new Date().toISOString(), updatedBy: actor };
    writeJsonAtomic(file, record);
    return record;
  }

  // --- past campaign performance ---------------------------------------------

  async listPerformanceCampaigns(options: ListPlansOptions = {}): Promise<PerformanceCampaignSummary[]> {
    await this.init();
    const summaries: PerformanceCampaignSummary[] = [];
    for (const file of fs.readdirSync(this.performanceDir).filter((f) => f.endsWith(".json"))) {
      const campaign = this.campaignFromDisk(readJson<PerformanceCampaign>(path.join(this.performanceDir, file)));
      if (!campaign?.id || (campaign.archived && !options.includeArchived)) continue;
      summaries.push(toCampaignSummary(campaign));
    }
    return sortByUpdatedDesc(summaries);
  }

  async getPerformanceCampaign(id: string): Promise<PerformanceCampaign | null> {
    await this.init();
    return this.campaignFromDisk(readJson<PerformanceCampaign>(this.campaignPath(id)));
  }

  async createPerformanceCampaign(input: PerformanceCampaignInput): Promise<PerformanceCampaign> {
    await this.init();
    const campaign = buildCampaignRecord(crypto.randomUUID(), input, null, new Date().toISOString());
    assertCampaignFits(campaign.files, campaign.review);
    writeJsonAtomic(this.campaignPath(campaign.id), campaign);
    return campaign;
  }

  async updatePerformanceCampaign(id: string, input: PerformanceCampaignInput, expectedRevision: number): Promise<PerformanceCampaign> {
    await this.init();
    const existing = this.campaignFromDisk(readJson<PerformanceCampaign>(this.campaignPath(id)));
    if (!existing) throw new CampaignNotFoundError(id);
    if (existing.revision !== expectedRevision) throw new RevisionConflictError(existing.revision, "This campaign was changed by someone else.");
    const campaign = buildCampaignRecord(id, input, existing, new Date().toISOString());
    assertCampaignFits(campaign.files, campaign.review);
    writeJsonAtomic(this.campaignPath(id), campaign);
    return campaign;
  }

  async archivePerformanceCampaign(id: string, actor: string): Promise<void> {
    await this.init();
    const existing = this.campaignFromDisk(readJson<PerformanceCampaign>(this.campaignPath(id)));
    if (!existing) throw new CampaignNotFoundError(id);
    writeJsonAtomic(this.campaignPath(id), { ...existing, archived: true, revision: existing.revision + 1, updatedAt: new Date().toISOString(), updatedBy: actor });
  }

  // Records written before live campaigns existed have no kind or snapshots.
  private campaignFromDisk(raw: PerformanceCampaign | null): PerformanceCampaign | null {
    return raw ? { ...raw, kind: raw.kind ?? "past", snapshots: raw.snapshots ?? [] } : null;
  }

  // --- usage log -------------------------------------------------------------

  // One JSON line per event, one file per UTC day, so a report only reads the days it covers.
  async recordUsageEvent(event: UsageEvent): Promise<void> {
    await this.init();
    // Matches Firestore's create-only write. Only backfills reuse ids, so the scan stays rare.
    if (event.id.startsWith("backfill-") && (await this.listUsageEvents("")).some((e) => e.id === event.id)) {
      throw new Error(`Usage event '${event.id}' already exists.`);
    }
    fs.appendFileSync(path.join(this.usageDir, `${event.at.slice(0, 10)}.jsonl`), `${JSON.stringify(event)}\n`, "utf-8");
  }

  async listUsageEvents(sinceIso: string): Promise<UsageEvent[]> {
    await this.init();
    const sinceDay = sinceIso.slice(0, 10);
    const events: UsageEvent[] = [];
    for (const file of fs.readdirSync(this.usageDir).filter((f) => f.endsWith(".jsonl") && f.slice(0, 10) >= sinceDay)) {
      for (const line of fs.readFileSync(path.join(this.usageDir, file), "utf-8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as UsageEvent;
          if (event.at >= sinceIso) events.push(event);
        } catch {
          // A line cut short by a crash mid-append loses that one event, not the report.
        }
      }
    }
    return events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  }

  // --- ScoutAI conversation log --------------------------------------------------

  // One file per record under a folder per UTC day. Records are updated in place (outcome,
  // feedback), so this is not one append-only file like the usage log.
  private scoutLogPath(id: string, at: string): string {
    return path.join(this.scoutLogsDir, at.slice(0, 10), `${id.replace(/[^a-zA-Z0-9_-]/g, "")}.json`);
  }

  private findScoutLogFile(id: string): string | null {
    const name = `${id.replace(/[^a-zA-Z0-9_-]/g, "")}.json`;
    for (const day of fs.readdirSync(this.scoutLogsDir).sort().reverse()) {
      const file = path.join(this.scoutLogsDir, day, name);
      if (fs.existsSync(file)) return file;
    }
    return null;
  }

  async recordScoutLog(log: ScoutLog): Promise<void> {
    await this.init();
    const file = this.scoutLogPath(log.id, log.at);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(log, null, 2), { encoding: "utf-8", flag: "wx" });
    // Firestore's TTL policy does this in production; here, drop whole days past their expiry.
    const cutoffDay = new Date().toISOString().slice(0, 10);
    for (const day of fs.readdirSync(this.scoutLogsDir)) {
      const files = fs.readdirSync(path.join(this.scoutLogsDir, day));
      const sample = files[0] ? readJson<ScoutLog>(path.join(this.scoutLogsDir, day, files[0])) : null;
      if (sample?.expireAt && sample.expireAt.slice(0, 10) < cutoffDay) fs.rmSync(path.join(this.scoutLogsDir, day), { recursive: true, force: true });
    }
  }

  async getScoutLog(id: string): Promise<ScoutLog | null> {
    await this.init();
    const file = this.findScoutLogFile(id);
    return file ? readJson<ScoutLog>(file) : null;
  }

  async updateScoutLog(id: string, update: ScoutLogUpdate): Promise<ScoutLog | null> {
    await this.init();
    const file = this.findScoutLogFile(id);
    const log = file ? readJson<ScoutLog>(file) : null;
    if (!file || !log) return null;
    const updated = { ...log, ...update };
    fs.writeFileSync(file, JSON.stringify(updated, null, 2), "utf-8");
    return updated;
  }

  async listScoutLogs({ sinceIso, untilIso, limit = 500 }: { sinceIso: string; untilIso?: string; limit?: number }): Promise<ScoutLog[]> {
    await this.init();
    const logs: ScoutLog[] = [];
    for (const day of fs.readdirSync(this.scoutLogsDir).filter((d) => d >= sinceIso.slice(0, 10) && (!untilIso || d <= untilIso.slice(0, 10)))) {
      for (const file of fs.readdirSync(path.join(this.scoutLogsDir, day))) {
        const log = readJson<ScoutLog>(path.join(this.scoutLogsDir, day, file));
        if (log && log.at >= sinceIso && (!untilIso || log.at <= untilIso)) logs.push(log);
      }
    }
    return logs.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
  }

  // --- leadership dashboard ----------------------------------------------------

  async listDashboardLinks(): Promise<DashboardLink[]> {
    await this.init();
    return readJson<DashboardLink[]>(path.join(this.dashboardDir, "links.json")) ?? [];
  }

  async getDashboardLink(token: string): Promise<DashboardLink | null> {
    return (await this.listDashboardLinks()).find((link) => link.token === token) ?? null;
  }

  async saveDashboardLink(link: DashboardLink): Promise<void> {
    const links = (await this.listDashboardLinks()).filter((l) => l.token !== link.token);
    writeJsonAtomic(path.join(this.dashboardDir, "links.json"), [...links, link]);
  }

  async getDashboardConfig(): Promise<DashboardConfig> {
    await this.init();
    return { ...DEFAULT_DASHBOARD_CONFIG, ...(readJson<DashboardConfig>(path.join(this.dashboardDir, "config.json")) ?? {}) };
  }

  async saveDashboardConfig(config: DashboardConfig): Promise<DashboardConfig> {
    await this.init();
    writeJsonAtomic(path.join(this.dashboardDir, "config.json"), config);
    return config;
  }

  // --- people directory -----------------------------------------------------------

  async getPeople(): Promise<PeopleRecord> {
    await this.init();
    return readJson<PeopleRecord>(path.join(this.dashboardDir, "people.json")) ?? { ...EMPTY_PEOPLE };
  }

  async savePeople(people: Person[], actor: string, expectedRevision: number): Promise<PeopleRecord> {
    const current = await this.getPeople();
    if (current.revision !== expectedRevision) throw new RevisionConflictError(current.revision, "The people list was changed by someone else.");
    const record: PeopleRecord = { revision: current.revision + 1, people, updatedAt: new Date().toISOString(), updatedBy: actor };
    writeJsonAtomic(path.join(this.dashboardDir, "people.json"), record);
    return record;
  }

  private campaignPath(id: string): string {
    return path.join(this.performanceDir, `${id.replace(/[^a-zA-Z0-9._-]/g, "")}.json`);
  }
}

export function toSummary(plan: StoredPlan): PlanSummary {
  const { payload, ...summary } = plan;
  return summary;
}

export function sortByUpdatedDesc<T extends { updatedAt: string }>(records: T[]): T[] {
  return records.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

/** An id from a URL, made safe to use as one path segment (no separators, no ".."). */
function safeFileId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "") || "_";
}

function readJson<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch (err) {
    console.error(`[STORAGE:local] Could not read ${filePath}:`, err);
    return null;
  }
}

/** Write via a temp file + rename so a crash mid-write cannot truncate a good record. */
function writeJsonAtomic(filePath: string, value: unknown): void {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);
}
