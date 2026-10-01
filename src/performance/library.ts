// The advertiser's campaign library, server side: what an upload may contain, what a campaign's
// details may be, and how a stored campaign is analysed. The analysis is recomputed from the
// stored files on every read rather than saved, so a better reader improves old campaigns too
// and a saved analysis can never disagree with the files it came from.

import { createHash } from "node:crypto";
import type { PerformanceCampaign, PerformanceFileRecord, PerformanceSnapshot } from "../storage/types";
import { toAdvertiserKey } from "../storage/types";
import { analyzeCampaign, type CampaignAnalysis } from "./campaign";
import { parseReportFileName } from "./columns";
import { CAMPAIGN_GOALS, MAX_REPORT_TEXT_CHARS } from "./constants";
import { readReport, type Report, type TouchReport } from "./reports";
import type { MediaTypeCredit, PathCount, Tally, TouchSummary } from "./touches";
import { dayOf, formatDay, parseDate } from "./values";

const MAX_FILES = 40;
const MAX_NAME = 200;

export interface CampaignDetails {
  advertiserName: string;
  name: string;
  flightStart: string | null;
  flightEnd: string | null;
  conversionLabel: string | null;
  campaignGoal: string | null;
  notes: string | null;
}

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const isDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && parseDate(value) !== null;

/** The planner-editable details of a campaign; the advertiser is the one thing required. */
export function readCampaignDetails(body: any, fallback?: Partial<CampaignDetails>): { details: CampaignDetails | null; error?: string } {
  const pick = <K extends keyof CampaignDetails>(key: K) => (body && key in body ? body[key] : fallback?.[key]);
  const advertiserName = text(pick("advertiserName"), 120);
  if (!advertiserName) return { details: null, error: "Name the advertiser these reports are for." };
  const flightStart = pick("flightStart");
  const flightEnd = pick("flightEnd");
  if ((flightStart != null && flightStart !== "" && !isDay(flightStart)) || (flightEnd != null && flightEnd !== "" && !isDay(flightEnd))) {
    return { details: null, error: "Flight dates must be YYYY-MM-DD." };
  }
  if (isDay(flightStart) && isDay(flightEnd) && flightStart > flightEnd) return { details: null, error: "The flight ends before it starts." };
  const goal = text(pick("campaignGoal"), 20);
  if (goal && !CAMPAIGN_GOALS.some((g) => g.id === goal)) return { details: null, error: "Unknown campaign goal." };
  const name = text(pick("name"), 120) || defaultCampaignName(isDay(flightStart) ? flightStart : null, isDay(flightEnd) ? flightEnd : null);
  return {
    details: {
      advertiserName,
      name,
      flightStart: isDay(flightStart) ? flightStart : null,
      flightEnd: isDay(flightEnd) ? flightEnd : null,
      conversionLabel: text(pick("conversionLabel"), 60) || null,
      campaignGoal: goal || null,
      notes: text(pick("notes"), 1000) || null,
    },
  };
}

function defaultCampaignName(start: string | null, end: string | null): string {
  if (!start || !end) return "Past campaign";
  const format = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return `${format(start)} to ${format(end)}`;
}

/**
 * Uploaded files as the store keeps them. A file is either an export's text or the browser's
 * summary of a touch-level export; anything else is refused with a reason the planner can act on.
 */
export function readUploadedFiles(raw: unknown, actor: string, now = new Date().toISOString()): { files: PerformanceFileRecord[]; rejected: string[] } {
  const files: PerformanceFileRecord[] = [];
  const rejected: string[] = [];
  const items = Array.isArray(raw) ? raw : [];
  if (items.length > MAX_FILES) rejected.push(`Only ${MAX_FILES} files can be added at once.`);
  for (const item of items.slice(0, MAX_FILES)) {
    const fileName = text(item?.fileName, MAX_NAME).replace(/[\\/]/g, "_");
    if (!fileName) {
      rejected.push("A file had no name.");
      continue;
    }
    if (typeof item?.text === "string") {
      if (item.text.length > MAX_REPORT_TEXT_CHARS) {
        rejected.push(`${fileName} is too large to be a summarised report (${Math.round(item.text.length / 1000)}KB). Touch-level exports are summarised in the browser; other large exports should be split.`);
        continue;
      }
      files.push({ id: crypto.randomUUID(), fileName, sizeBytes: item.text.length, fingerprint: createHash("sha256").update(item.text).digest("hex"), uploadedAt: now, uploadedBy: actor, text: item.text });
      continue;
    }
    const summary = sanitizeTouchSummary(item?.touchSummary);
    if (summary) {
      files.push({
        id: crypto.randomUUID(),
        fileName,
        sizeBytes: Math.max(0, Math.round(Number(item?.sizeBytes) || 0)),
        fingerprint: text(item?.fingerprint, 300) || `${fileName}:${summary.rows}:${summary.conversions}`,
        uploadedAt: now,
        uploadedBy: actor,
        touchReport: summary,
      });
      continue;
    }
    rejected.push(`${fileName} could not be read.`);
  }
  return { files, rejected };
}

/**
 * Which report a file is, whatever day it was exported: "AP Mediatype (2026-02-09 - 2026-03-10)
 * - Acme_20260312_120237.csv" and the same report exported a week later are one report.
 */
export function reportKey(fileName: string): string {
  const parsed = parseReportFileName(fileName);
  if (parsed.reportType) return parsed.reportType.toLowerCase();
  return fileName.toLowerCase().replace(/\.\w+$/, "").replace(/_\d{8}_\d{6}$/, "").replace(/\(?\d{4}-\d{2}-\d{2}[\s_]*(?:-|to|_)[\s_]*\d{4}-\d{2}-\d{2}\)?/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Existing files plus new ones, skipping any file already in the campaign. A live campaign is
 * re-exported during the flight, so there a new export replaces the earlier one of the same report.
 */
export function mergeFiles(existing: PerformanceFileRecord[], added: PerformanceFileRecord[], { replaceSameReport = false } = {}): { files: PerformanceFileRecord[]; duplicates: string[]; replaced: string[] } {
  const seen = new Set(existing.map((f) => f.fingerprint));
  let files = [...existing];
  const duplicates: string[] = [];
  const replaced: string[] = [];
  for (const f of added) {
    if (seen.has(f.fingerprint)) {
      duplicates.push(f.fileName);
      continue;
    }
    if (replaceSameReport) {
      const key = reportKey(f.fileName);
      const old = files.filter((e) => reportKey(e.fileName) === key);
      if (old.length) {
        replaced.push(...old.map((e) => e.fileName));
        files = files.filter((e) => !old.includes(e));
      }
    }
    seen.add(f.fingerprint);
    files.push(f);
  }
  return { files, duplicates, replaced };
}

/** A live campaign's totals at this upload, for "since the last upload". */
export function snapshotOf(analysis: CampaignAnalysis, actor: string, now = new Date().toISOString()): PerformanceSnapshot {
  const ends = analysis.files.filter((f) => f.role !== "reference" && f.window && f.kind !== "summary").map((f) => f.window!.end);
  return {
    uploadedAt: now,
    uploadedBy: actor,
    asOf: ends.length ? formatDay(Math.max(...ends)) : null,
    spend: analysis.totals?.spend ?? 0,
    conversions: analysis.totals?.conversions ?? 0,
    revenue: analysis.totals?.revenue ?? 0,
  };
}

export function reportsOf(files: PerformanceFileRecord[]): Report[] {
  return files.map((f): Report => {
    if (typeof f.text === "string") return readReport(f.fileName, f.text);
    const summary = sanitizeTouchSummary(f.touchReport);
    const file = parseReportFileName(f.fileName);
    if (!summary) return { fileName: f.fileName, file, platform: file.fromPlatform, notes: [], kind: "unread", reason: "The stored summary could not be read." };
    const window = file.window ?? (summary.conversionWindow ? { start: dayOf(summary.conversionWindow.start), end: dayOf(summary.conversionWindow.end) } : undefined);
    const report: TouchReport = { fileName: f.fileName, file, platform: file.fromPlatform, window, notes: [], kind: "touches", summary };
    return report;
  });
}

export function analyzeFiles(files: PerformanceFileRecord[], details: Pick<CampaignDetails, "flightStart" | "flightEnd" | "conversionLabel"> & { kind?: "past" | "live" }): CampaignAnalysis {
  const start = details.flightStart ? parseDate(details.flightStart) : null;
  const end = details.flightEnd ? parseDate(details.flightEnd) : null;
  return analyzeCampaign(reportsOf(files), {
    ...(start !== null && end !== null ? { flight: { start, end } } : {}),
    ...(details.conversionLabel ? { conversionLabel: details.conversionLabel } : {}),
    ...(details.kind === "live" ? { inFlight: true } : {}),
  });
}

/** What the campaign's own files say, for pre-filling the upload form. */
export function suggestedDetails(analysis: CampaignAnalysis): Partial<CampaignDetails> {
  return {
    ...(analysis.advertiser ? { advertiserName: analysis.advertiser } : {}),
    ...(analysis.flight ? { flightStart: formatDay(analysis.flight.start), flightEnd: formatDay(analysis.flight.end) } : {}),
    ...(analysis.conversionLabel.source !== "default" && analysis.conversionLabel.source !== "planner" ? { conversionLabel: analysis.conversionLabel.label } : {}),
  };
}

/**
 * What a review was written from. Changing a file, the flight, the conversion event, the goal or
 * the notes changes what the data says, so the saved review is then marked out of date.
 */
export function reviewFingerprint(campaign: Pick<PerformanceCampaign, "files" | "flightStart" | "flightEnd" | "conversionLabel" | "campaignGoal" | "notes">): string {
  const basis = [campaign.files.map((f) => f.fingerprint).sort(), campaign.flightStart, campaign.flightEnd, campaign.conversionLabel, campaign.campaignGoal, campaign.notes];
  return createHash("sha256").update(JSON.stringify(basis)).digest("hex").slice(0, 32);
}

/** The campaign as the browser sees it: file details but never file contents. */
export function publicCampaign(campaign: PerformanceCampaign) {
  const { files, review, ...summary } = campaign;
  return {
    ...summary,
    files: files.map((f) => ({ id: f.id, fileName: f.fileName, sizeBytes: f.sizeBytes, uploadedAt: f.uploadedAt, uploadedBy: f.uploadedBy, source: typeof f.text === "string" ? "export" as const : "browser-summary" as const })),
  };
}

/** Whether the files name a different advertiser from the campaign; the client view depends on this. */
export function advertiserMismatch(campaign: { advertiserName: string }, analysis: CampaignAnalysis): string | null {
  return analysis.advertiser && toAdvertiserKey(analysis.advertiser) !== toAdvertiserKey(campaign.advertiserName) ? analysis.advertiser : null;
}

// --- the browser's touch summary ----------------------------------------------
// It arrives from the client, so it is rebuilt field by field: numbers must be finite, lists are
// capped, names are clipped, and anything the summary does not define is dropped. That also keeps
// a household hash out of the store even if a future client sent one.

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const name = (v: unknown) => text(v, 160);
const list = <T>(v: unknown, max: number, read: (item: any) => T | null): T[] => (Array.isArray(v) ? v.slice(0, max).map(read).filter((x): x is T => x !== null) : []);
const tally = (v: unknown): Tally[] => list(v, 25, (t) => (name(t?.name) ? { name: name(t.name), conversions: num(t.conversions) } : null));

export function sanitizeTouchSummary(raw: any): TouchSummary | null {
  if (!raw || typeof raw !== "object" || (raw.attribution !== "all-touch" && raw.attribution !== "last-touch")) return null;
  if (!(num(raw.conversions) > 0) || !Array.isArray(raw.byMediaType)) return null;
  const window = raw.conversionWindow && Number.isFinite(raw.conversionWindow.start) && Number.isFinite(raw.conversionWindow.end)
    ? { start: raw.conversionWindow.start, end: raw.conversionWindow.end }
    : null;
  return {
    attribution: raw.attribution,
    rows: num(raw.rows),
    unreadRows: num(raw.unreadRows),
    conversions: num(raw.conversions),
    households: num(raw.households),
    repeatHouseholds: numOrNull(raw.repeatHouseholds),
    revenue: num(raw.revenue),
    conversionWindow: window,
    firstImpression: numOrNull(raw.firstImpression),
    maxLookbackHours: num(raw.maxLookbackHours),
    medianHoursToConvert: numOrNull(raw.medianHoursToConvert),
    touchesPerConversion: raw.touchesPerConversion
      ? { mean: num(raw.touchesPerConversion.mean), median: num(raw.touchesPerConversion.median), p90: num(raw.touchesPerConversion.p90), max: num(raw.touchesPerConversion.max) }
      : null,
    byMediaType: list(raw.byMediaType, 30, (m): MediaTypeCredit | null => (name(m?.mediaType)
      ? {
        mediaType: name(m.mediaType), isCtv: m.isCtv === true, lastTouch: num(m.lastTouch), firstTouch: num(m.firstTouch), anyTouch: num(m.anyTouch), onlyTouch: num(m.onlyTouch),
        linear: num(m.linear), lastTouchRevenue: num(m.lastTouchRevenue), linearRevenue: num(m.linearRevenue), touches: num(m.touches), medianHoursToConvert: numOrNull(m.medianHoursToConvert),
      }
      : null)),
    paths: list(raw.paths, 10, (p): PathCount | null => {
      const path = list(p?.path, 6, (step) => name(step) || null);
      return path.length ? { path, conversions: num(p.conversions), revenue: num(p.revenue) } : null;
    }),
    distinctPaths: num(raw.distinctPaths),
    ctv: raw.ctv ? { anyTouch: num(raw.ctv.anyTouch), lastTouch: num(raw.ctv.lastTouch), onlyCtv: num(raw.ctv.onlyCtv), creditedElsewhere: num(raw.ctv.creditedElsewhere) } : null,
    publishers: list(raw.publishers, 25, (p) => (name(p?.name) ? { name: name(p.name), anyTouch: num(p.anyTouch), lastTouch: num(p.lastTouch) } : null)),
    dma: tally(raw.dma),
    state: tally(raw.state),
    device: tally(raw.device),
    bursts: raw.bursts
      ? { windowMinutes: num(raw.bursts.windowMinutes), minTouches: num(raw.bursts.minTouches), conversions: num(raw.bursts.conversions), maxInWindow: num(raw.bursts.maxInWindow), byMediaType: tally(raw.bursts.byMediaType) }
      : null,
    timesExposed: raw.timesExposed ? { median: num(raw.timesExposed.median), max: num(raw.timesExposed.max), matchesPathLength: numOrNull(raw.timesExposed.matchesPathLength) } : null,
    anomalies: { revenueDiffersWithinConversion: num(raw.anomalies?.revenueDiffersWithinConversion), impressionAfterConversion: num(raw.anomalies?.impressionAfterConversion) },
    notes: list(raw.notes, 10, (n) => text(n, 400) || null),
  };
}
