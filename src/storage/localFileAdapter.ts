import fs from "fs";
import path from "path";
import crypto from "crypto";
import { DEFAULT_PLANNING_SETTINGS, validatePlanningSettings, PlanningSettings } from "../planning/settings";
import { DEFAULT_CTV_PUBLISHERS, validateCtvPublishers, CtvPublisherSetting } from "../planning/knowledge/ctvPublishers";
import {
  CreatePlanInput,
  ListPlansOptions,
  PlanNotFoundError,
  PlanSummary,
  PublishersRecord,
  RevisionConflictError,
  SettingsRecord,
  StorageAdapter,
  StoredPlan,
  UpdatePlanInput,
} from "./types";

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

  constructor(rootDir: string = path.join(process.cwd(), "data", "store")) {
    this.rootDir = rootDir;
    this.plansDir = path.join(rootDir, "plans");
    this.settingsDir = path.join(rootDir, "settings");
    this.publishersDir = path.join(rootDir, "publishers");
  }

  async init(): Promise<void> {
    for (const dir of [this.plansDir, this.settingsDir, this.publishersDir]) {
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
    if (current && validatePlanningSettings(current.settings).valid) return current;
    return this.saveSettings(DEFAULT_PLANNING_SETTINGS, "system");
  }

  async getSettingsRevision(revision: number): Promise<SettingsRecord | null> {
    await this.init();
    return readJson<SettingsRecord>(path.join(this.settingsDir, `rev-${revision}.json`));
  }

  async saveSettings(settings: PlanningSettings, actor: string): Promise<SettingsRecord> {
    await this.init();
    const validation = validatePlanningSettings(settings);
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
    if (current && Array.isArray(current.publishers) && current.publishers.length > 0) return current;
    return this.savePublishers(DEFAULT_CTV_PUBLISHERS, "system");
  }

  async savePublishers(publishers: CtvPublisherSetting[], actor: string): Promise<PublishersRecord> {
    await this.init();
    const validation = validateCtvPublishers(publishers);
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
}

export function toSummary(plan: StoredPlan): PlanSummary {
  const { payload, ...summary } = plan;
  return summary;
}

export function sortByUpdatedDesc<T extends { updatedAt: string }>(records: T[]): T[] {
  return records.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
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
