/**
 * Everything a generation run has settled when it reaches the channel plan: the research, the
 * citation pool, the brief of record and the synthesized plan. A run whose channel plan fails
 * stops there and hands this to the browser, and "Retry channel plan" sends it back, so the
 * retry runs only the channel plan onward (~4 minutes) instead of the whole run (~15). Research
 * and synthesis are the expensive, slow part of a run and are rarely what failed.
 *
 * Held by the browser, not stored: it is a few hundred KB of in-flight run state, worthless once
 * the plan is saved, and losing it (a closed tab) costs no more than today's full regenerate.
 * It comes back as request input, so it is checked and bounded here like any other.
 */
import type { BriefOfRecord, GenerationAlert, GenerationLogEntry } from "../types";
import { normalizeBriefOfRecord } from "./briefOfRecord";

export interface CheckpointDossier {
  label: string;
  text: string;
  sources: Array<{ title: string; uri: string }>;
  failed?: boolean;
  reason?: string;
}

export interface RunCheckpoint {
  version: 1;
  createdAt: string;
  /** The plan as it stood just before the channel plan: synthesized, publishers settled. */
  profile: Record<string, unknown>;
  /** In the run's own order, so each dossier lands back in the slot the run reads it from. */
  research: CheckpointDossier[];
  groundingSources: Array<{ title: string; uri: string }>;
  briefOfRecord: BriefOfRecord | null;
  crawl?: { url: string; ok: boolean; chars: number };
  alerts: GenerationAlert[];
  log: GenerationLogEntry[];
}

// Generous bounds: a dossier runs ~10-30k chars and a synthesized profile ~100k.
const MAX_DOSSIER_CHARS = 200_000;
const MAX_SOURCES = 200;
const MAX_ALERTS = 200;
const MAX_LOG_ENTRIES = 400;
const MAX_PROFILE_CHARS = 2_000_000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function sources(raw: unknown): Array<{ title: string; uri: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isObject)
    .map((src) => ({ title: String(src.title ?? "").slice(0, 500), uri: String(src.uri ?? "").slice(0, 2000) }))
    .filter((src) => src.uri)
    .slice(0, MAX_SOURCES);
}

export function buildRunCheckpoint(parts: Omit<RunCheckpoint, "version" | "createdAt">): RunCheckpoint {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    // A copy: the run goes on to mutate the profile, and the checkpoint must be the pre-channel plan.
    profile: JSON.parse(JSON.stringify(parts.profile)),
    research: parts.research.map(({ label, text, sources: found, failed, reason }) => ({
      label,
      text,
      sources: found,
      ...(failed ? { failed: true } : {}),
      ...(reason ? { reason } : {}),
    })),
    groundingSources: parts.groundingSources,
    briefOfRecord: parts.briefOfRecord,
    ...(parts.crawl ? { crawl: parts.crawl } : {}),
    alerts: [...parts.alerts],
    log: [...parts.log],
  };
}

/**
 * A checkpoint sent back for a retry, or null when it is missing or not one this run can resume
 * from. `labels` are the run's dossiers in order; a checkpoint from a run with different research
 * steps is refused rather than half-used.
 */
export function parseRunCheckpoint(raw: unknown, labels: readonly string[]): RunCheckpoint | null {
  if (!isObject(raw) || raw.version !== 1) return null;
  if (!isObject(raw.profile) || JSON.stringify(raw.profile).length > MAX_PROFILE_CHARS) return null;
  if (!Array.isArray(raw.research) || raw.research.length !== labels.length) return null;
  const research: CheckpointDossier[] = [];
  for (const [index, entry] of raw.research.entries()) {
    if (!isObject(entry) || entry.label !== labels[index] || typeof entry.text !== "string") return null;
    research.push({
      label: labels[index],
      text: entry.text.slice(0, MAX_DOSSIER_CHARS),
      sources: sources(entry.sources),
      ...(entry.failed === true ? { failed: true } : {}),
      ...(typeof entry.reason === "string" ? { reason: entry.reason.slice(0, 500) } : {}),
    });
  }
  // A run with every dossier failed throws before synthesis, so it never produced a checkpoint.
  if (research.every((dossier) => dossier.failed)) return null;
  const brief = raw.briefOfRecord as Partial<BriefOfRecord> | null | undefined;
  const basis = brief?.basis && ["brief + website", "brief + web search", "brief only"].includes(brief.basis) ? brief.basis : "brief only";
  const crawl = isObject(raw.crawl) && typeof raw.crawl.url === "string"
    ? { url: raw.crawl.url.slice(0, 2000), ok: raw.crawl.ok === true, chars: Number(raw.crawl.chars) || 0 }
    : undefined;
  return {
    version: 1,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    profile: raw.profile,
    research,
    groundingSources: sources(raw.groundingSources),
    briefOfRecord: brief ? normalizeBriefOfRecord(brief, basis) : null,
    ...(crawl ? { crawl } : {}),
    alerts: (Array.isArray(raw.alerts) ? raw.alerts : [])
      .filter(isObject)
      .filter((alert) => ["failed", "not_found", "flagged"].includes(String(alert.severity)))
      .map((alert) => ({ section: String(alert.section ?? "").slice(0, 100), severity: alert.severity as GenerationAlert["severity"], message: String(alert.message ?? "").slice(0, 2000) }))
      .slice(0, MAX_ALERTS),
    log: (Array.isArray(raw.log) ? raw.log : [])
      .filter(isObject)
      .filter((entry) => typeof entry.at === "string" && (entry.type === "status" || entry.type === "research_result"))
      .slice(0, MAX_LOG_ENTRIES)
      .map((entry) => ({
        at: String(entry.at).slice(0, 40),
        type: entry.type as GenerationLogEntry["type"],
        ...(typeof entry.message === "string" ? { message: entry.message.slice(0, 2000) } : {}),
        ...(typeof entry.label === "string" ? { label: entry.label.slice(0, 100) } : {}),
        ...(Array.isArray(entry.sources) ? { sources: sources(entry.sources) } : {}),
        ...(typeof entry.blurb === "string" ? { blurb: entry.blurb.slice(0, 1000) } : {}),
        ...(entry.failed === true ? { failed: true } : {}),
      })),
  };
}
