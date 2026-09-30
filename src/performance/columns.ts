// What a report's columns mean. Most uploads come from Digital Remedy's reporting platform, whose
// columns are known (below); anything else is read by header synonyms. Either way a ratio column
// is only trusted after it is recomputed from the counts in the same row: that is how "Roas 484"
// is known to mean 4.84x and "Ctr 0.0248" to mean 0.0248%, and the digest then states every ratio
// from the counts rather than from the export.

import type { DateWindow } from "./values";
import { parseDate } from "./values";

export const normalizeHeader = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Counts that add up across rows. */
export const METRIC_KEYS = ["impressions", "spend", "conversions", "revenue", "clicks", "videoCompletions", "videoImpressions"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];
export type Metrics = Partial<Record<MetricKey, number>>;

/** Ratios an export may carry; each is recomputed from the counts. */
export const RATIO_KEYS = ["cpa", "roas", "cpm", "ctr", "vcr", "pm"] as const;
export type RatioKey = (typeof RATIO_KEYS)[number];

const METRIC_SYNONYMS: Record<MetricKey, string[]> = {
  impressions: ["impressions", "imps", "impr", "totalimpressions"],
  spend: ["spend", "cost", "mediacost", "totalspend", "amountspent", "totalcost"],
  // The platform calls its pixel conversion "Visits" whatever the event is (checkout, install...).
  conversions: ["visits", "conversions", "conv", "checkouts", "purchases", "orders", "leads", "installs", "actions", "totalconversions"],
  revenue: ["revenue", "rev", "sales", "conversionvalue", "totalrevenue"],
  clicks: ["clicks"],
  videoCompletions: ["videocompletions", "completedviews", "completions", "videocompletes", "completes"],
  videoImpressions: ["videoimpressions", "videostarts", "videoviews"],
};

const RATIO_SYNONYMS: Record<RatioKey, string[]> = {
  cpa: ["cpa", "costperacquisition", "costperconversion", "costperaction"],
  roas: ["roas", "returnonadspend"],
  cpm: ["cpm", "ecpm"],
  ctr: ["ctr", "clickthroughrate"],
  vcr: ["vcr", "completionrate", "videocompletionrate"],
  pm: ["pm", "performancemultiplier"],
};

/** Platform columns with no reliable meaning yet. They are reported as ignored, never guessed at. */
const KNOWN_UNUSED = new Set(["ireach", "ireachpercentage"]);

export interface ColumnMap {
  metrics: Partial<Record<MetricKey, number>>;
  ratios: Partial<Record<RatioKey, number>>;
  /** Header text of the conversions column, so the digest can say what it read. */
  conversionsHeader?: string;
  unused: string[];
  /** Everything else, by index: dimension and attribute candidates. */
  other: number[];
}

export function mapColumns(headers: string[]): ColumnMap {
  const map: ColumnMap = { metrics: {}, ratios: {}, unused: [], other: [] };
  headers.forEach((header, index) => {
    const key = normalizeHeader(header);
    const metric = (Object.keys(METRIC_SYNONYMS) as MetricKey[]).find((k) => METRIC_SYNONYMS[k].includes(key));
    const ratio = (Object.keys(RATIO_SYNONYMS) as RatioKey[]).find((k) => RATIO_SYNONYMS[k].includes(key));
    if (metric && map.metrics[metric] === undefined) {
      map.metrics[metric] = index;
      if (metric === "conversions") map.conversionsHeader = header;
    } else if (ratio && map.ratios[ratio] === undefined) {
      map.ratios[ratio] = index;
    } else if (KNOWN_UNUSED.has(key)) {
      map.unused.push(header);
    } else {
      map.other.push(index);
    }
  });
  return map;
}

/** The platform's report columns, recognised even when a file has been renamed. */
const PLATFORM_SIGNATURE = ["name", "impressions", "spend", "visits", "cpa", "roas", "pm"];
export const hasPlatformColumns = (headers: string[]) => {
  const keys = new Set(headers.map(normalizeHeader));
  return PLATFORM_SIGNATURE.every((k) => keys.has(k));
};

/** How each ratio is recomputed, and the scales an export may write it at. */
export const RATIO_DEFINITIONS: Record<Exclude<RatioKey, "pm">, { compute: (m: Metrics) => number | null; scales: number[] }> = {
  cpa: { compute: (m) => ratio(m.spend, m.conversions), scales: [1] },
  roas: { compute: (m) => ratio(m.revenue, m.spend), scales: [1, 100] },
  cpm: { compute: (m) => ratio(m.spend, m.impressions, 1000), scales: [1] },
  ctr: { compute: (m) => ratio(m.clicks, m.impressions), scales: [1, 100] },
  vcr: { compute: (m) => ratio(m.videoCompletions, m.videoImpressions), scales: [1, 100] },
};

/** What the platform writes; a verified scale that disagrees is a warning, not silently accepted. */
export const PLATFORM_RATIO_SCALES: Partial<Record<RatioKey, number>> = { roas: 100, ctr: 100, vcr: 100, cpa: 1, cpm: 1, pm: 1 };

export function ratio(numerator: number | undefined, denominator: number | undefined, multiplier = 1): number | null {
  if (numerator === undefined || denominator === undefined || !(denominator > 0)) return null;
  return (numerator / denominator) * multiplier;
}

export interface ReportFileName {
  fromPlatform: boolean;
  /** "Adgroup", "Mediatype", "IO Pacing"... */
  reportType?: string;
  window?: DateWindow;
  advertiser?: string;
  exportedAt?: number;
}

// AP Adgroup (2026-02-09 - 2026-03-10) - Husky Liners_20260312_120234.csv
// AP IO Pacing - _20260312_120250.csv
const PLATFORM_FILE = /^AP\s+(.+?)\s*(?:\((\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})\))?\s*-\s*(.*?)_(\d{8})_(\d{6})\.\w+$/i;
const ANY_RANGE = /(\d{4}-\d{2}-\d{2})[\s_]*(?:-|to|_)[\s_]*(\d{4}-\d{2}-\d{2})/i;

export function parseReportFileName(fileName: string): ReportFileName {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const m = PLATFORM_FILE.exec(base);
  if (m) {
    const start = m[2] ? parseDate(m[2]) : null;
    const end = m[3] ? parseDate(m[3]) : null;
    const stamp = `${m[5].slice(0, 4)}-${m[5].slice(4, 6)}-${m[5].slice(6, 8)} ${m[6].slice(0, 2)}:${m[6].slice(2, 4)}:${m[6].slice(4, 6)}`;
    return {
      fromPlatform: true,
      reportType: m[1].trim(),
      ...(start !== null && end !== null ? { window: { start, end } } : {}),
      ...(m[4].trim() ? { advertiser: m[4].trim() } : {}),
      exportedAt: parseDate(stamp) ?? undefined,
    };
  }
  const range = ANY_RANGE.exec(base);
  const start = range ? parseDate(range[1]) : null;
  const end = range ? parseDate(range[2]) : null;
  return { fromPlatform: false, ...(start !== null && end !== null ? { window: { start, end } } : {}) };
}
