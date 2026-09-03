import fs from "fs";
import path from "path";
import { DEFAULT_CTV_PUBLISHERS, validateCtvPublishers, CtvPublisherSetting } from "./ctvPublishers";
import { DEFAULT_PLANNING_SETTINGS, validatePlanningSettings, PlanningSettings } from "../settings";

const DATA_DIR = path.join(process.cwd(), "data");
const CTV_PUBLISHERS_FILE = path.join(DATA_DIR, "ctv-publishers.json");
const PLANNING_SETTINGS_FILE = path.join(DATA_DIR, "planning-settings.json");
const CUSTOM_LOGOS_DIR = path.join(process.cwd(), "assets", "pub-logos");

function ensureDirectories() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(CUSTOM_LOGOS_DIR)) {
      fs.mkdirSync(CUSTOM_LOGOS_DIR, { recursive: true });
    }
  } catch (err) {
    console.warn("[STORAGE] Failed to ensure data directories:", err);
  }
}

export function loadPersistentPlanningSettings(): PlanningSettings {
  ensureDirectories();
  try {
    if (fs.existsSync(PLANNING_SETTINGS_FILE)) {
      const raw = fs.readFileSync(PLANNING_SETTINGS_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      const validation = validatePlanningSettings(parsed);
      if (validation.valid && validation.settings) {
        return validation.settings;
      }
      console.warn("[STORAGE] Invalid settings found in planning-settings.json, falling back to defaults. Errors:", validation.errors);
    } else {
      // Initialize with defaults on first run
      savePersistentPlanningSettings(DEFAULT_PLANNING_SETTINGS);
    }
  } catch (err) {
    console.error("[STORAGE] Error reading planning-settings.json:", err);
  }
  return DEFAULT_PLANNING_SETTINGS;
}

export function savePersistentPlanningSettings(settings: PlanningSettings): { valid: boolean; settings?: PlanningSettings; errors: string[] } {
  ensureDirectories();
  const validation = validatePlanningSettings(settings);
  if (!validation.valid || !validation.settings) {
    return validation;
  }
  try {
    fs.writeFileSync(PLANNING_SETTINGS_FILE, JSON.stringify(validation.settings, null, 2), "utf-8");
    console.log(`[STORAGE] Successfully saved planning settings to ${PLANNING_SETTINGS_FILE}`);
    return { valid: true, settings: validation.settings, errors: [] };
  } catch (err: any) {
    console.error("[STORAGE] Error writing planning-settings.json:", err);
    return { valid: false, errors: [err.message || "Failed to write settings to disk."] };
  }
}

export function loadPersistentCtvPublishers(): CtvPublisherSetting[] {
  ensureDirectories();
  try {
    if (fs.existsSync(CTV_PUBLISHERS_FILE)) {
      const raw = fs.readFileSync(CTV_PUBLISHERS_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      const validation = validateCtvPublishers(parsed);
      if (validation.valid && validation.publishers.length > 0) {
        return validation.publishers;
      }
      console.warn("[STORAGE] Invalid publishers in ctv-publishers.json, falling back to defaults. Errors:", validation.errors);
    } else {
      // Initialize with defaults on first run
      savePersistentCtvPublishers(DEFAULT_CTV_PUBLISHERS);
    }
  } catch (err) {
    console.error("[STORAGE] Error reading ctv-publishers.json:", err);
  }
  return DEFAULT_CTV_PUBLISHERS;
}

export function savePersistentCtvPublishers(publishers: CtvPublisherSetting[]): { valid: boolean; publishers?: CtvPublisherSetting[]; errors: string[] } {
  ensureDirectories();
  const validation = validateCtvPublishers(publishers);
  if (!validation.valid || !validation.publishers) {
    return { valid: false, errors: validation.errors };
  }
  try {
    fs.writeFileSync(CTV_PUBLISHERS_FILE, JSON.stringify(validation.publishers, null, 2), "utf-8");
    console.log(`[STORAGE] Successfully saved ${validation.publishers.length} CTV publisher(s) to ${CTV_PUBLISHERS_FILE}`);
    return { valid: true, publishers: validation.publishers, errors: [] };
  } catch (err: any) {
    console.error("[STORAGE] Error writing ctv-publishers.json:", err);
    return { valid: false, errors: [err.message || "Failed to write CTV publishers to disk."] };
  }
}

export function saveCustomPublisherLogo(filename: string, buffer: Buffer): string {
  ensureDirectories();
  const safeFilename = filename.toLowerCase().replace(/[^a-z0-9._-]/g, "_");
  const targetPath = path.join(CUSTOM_LOGOS_DIR, safeFilename);
  fs.writeFileSync(targetPath, buffer);
  console.log(`[STORAGE] Saved custom publisher logo to ${targetPath}`);
  return `/assets/pub-logos/${safeFilename}`;
}
