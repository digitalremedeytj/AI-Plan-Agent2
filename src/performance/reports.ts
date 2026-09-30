// One uploaded report file, read into what it is: a breakdown (one row per ad group, publisher,
// creative...), a summary of labelled values, a date series, or touch-level conversions (see
// ./touches). Reading decides the file's shape from its columns and values, not its name, so a
// renamed or non-platform export is read the same way; the name only adds the report type, the
// date window and the advertiser.

import { CsvReader, detectDelimiter, parseCsv } from "./csv";
import {
  hasPlatformColumns,
  mapColumns,
  METRIC_KEYS,
  normalizeHeader,
  parseReportFileName,
  PLATFORM_RATIO_SCALES,
  RATIO_DEFINITIONS,
  type Metrics,
  type RatioKey,
  type ReportFileName,
} from "./columns";
import { detectTouchColumns, TouchSummarizer, type TouchSummary } from "./touches";
import { dayOf, isCurrencyText, isPercentText, parseDate, parseNumber, type DateWindow } from "./values";

export interface RatioCheck {
  ratio: RatioKey;
  header: string;
  /** What the export's value is multiplied by relative to the plain ratio (Roas 484 = 4.84x is 100). */
  scale: number | null;
  status: "verified" | "mismatch" | "unchecked";
  /** Rows the check could compare. */
  compared: number;
}

export interface BreakdownRow {
  name: string;
  /** Other text columns, e.g. a publisher's streaming category. */
  attributes: Record<string, string>;
  metrics: Metrics;
  /** The export's own Performance Multiplier, kept to check the recomputed one against. */
  exportedPm?: number;
}

interface ReportBase {
  fileName: string;
  file: ReportFileName;
  /** Recognised as the reporting platform's export, by name or by columns. */
  platform: boolean;
  /** From the file name, or from the file's own dates when the name has none. */
  window?: DateWindow;
  notes: string[];
}

export interface BreakdownReport extends ReportBase {
  kind: "breakdown";
  /** What each row is: "Adgroup", "Publisher"..., or the dimension column's header. */
  dimension: string;
  rows: BreakdownRow[];
  totals: Metrics;
  conversionsHeader?: string;
  ratioChecks: RatioCheck[];
  ignoredColumns: string[];
}

export interface SummaryValue {
  metric: string;
  value: number | null;
  previous: number | null;
  raw: string;
  percent: boolean;
  currency: boolean;
}

export interface SummaryReport extends ReportBase {
  kind: "summary";
  values: SummaryValue[];
  /** True when the export carried a "previous period" column with anything in it. */
  hasComparison: boolean;
  pacing: boolean;
}

export interface SeriesPoint {
  day: number;
  metrics: Metrics;
}

export interface SeriesReport extends ReportBase {
  kind: "series";
  /** Daily values; a running-total export is converted to daily increments. */
  points: SeriesPoint[];
  cumulative: boolean;
  /** The export's last row when it was a running total: the whole window's totals. */
  finalTotals?: Metrics;
}

export interface TouchReport extends ReportBase {
  kind: "touches";
  summary: TouchSummary;
}

export interface UnreadReport extends ReportBase {
  kind: "unread";
  reason: string;
}

export type Report = BreakdownReport | SummaryReport | SeriesReport | TouchReport | UnreadReport;

/** Read a report already in memory. Large touch files go through readTouchReportStream instead. */
export function readReport(fileName: string, text: string): Report {
  const file = parseReportFileName(fileName);
  const { headers, rows } = parseCsv(text);
  const base = { fileName, file, platform: file.fromPlatform || hasPlatformColumns(headers), window: file.window, notes: [] as string[] };
  if (headers.length === 0 || rows.length === 0) return { ...base, kind: "unread", reason: "The file has no data rows." };

  if (detectTouchColumns(headers)) {
    const summarizer = new TouchSummarizer(headers, fileName);
    for (const row of rows) summarizer.add(row);
    return touchReport(base, summarizer.finish());
  }
  const keys = headers.map(normalizeHeader);
  if (keys[0] === "metric" && (keys.includes("currentvalue") || keys.includes("value"))) return readSummary(base, keys, rows);

  const columns = mapColumns(headers);
  const metricCount = Object.keys(columns.metrics).length;
  if (metricCount === 0) return { ...base, kind: "unread", reason: "No spend, impression or conversion columns were recognised." };

  const dateColumn = columns.other.find((i) => keys[i] === "date" || keys[i] === "day" || share(rows, (r) => parseDate(r[i]) !== null) >= 0.9);
  if (dateColumn !== undefined) return readSeries(base, headers, rows, dateColumn, columns.metrics);
  return readBreakdown(base, headers, rows, columns);
}

/**
 * Stream a touch-level export (File.stream() piped through a TextDecoderStream, or any string
 * chunks) without holding its rows. Returns an unread report if the columns are not touch columns.
 */
export async function readTouchReportStream(fileName: string, chunks: AsyncIterable<string> | Iterable<string>): Promise<Report> {
  const file = parseReportFileName(fileName);
  const base = { fileName, file, platform: file.fromPlatform, window: file.window, notes: [] as string[] };
  let reader: CsvReader | null = null;
  let summarizer: TouchSummarizer | null = null;
  let unreadable = false;
  const take = (rows: string[][]) => {
    for (const row of rows) {
      if (unreadable) return;
      if (!summarizer) {
        const headers = row.map((h) => h.trim());
        if (!detectTouchColumns(headers)) {
          unreadable = true;
          return;
        }
        summarizer = new TouchSummarizer(headers, fileName);
      } else {
        summarizer.add(row);
      }
    }
  };
  for await (const chunk of chunks) {
    if (!reader) reader = new CsvReader(detectDelimiter(chunk));
    take(reader.push(chunk));
    if (unreadable) break;
  }
  if (reader && !unreadable) take(reader.end());
  if (!summarizer || unreadable) return { ...base, kind: "unread", reason: "The file does not have conversion and impression timestamp columns." };
  return touchReport(base, (summarizer as TouchSummarizer).finish());
}

function touchReport(base: Omit<ReportBase, "notes"> & { notes: string[] }, summary: TouchSummary): TouchReport {
  // A touch file's window is when its conversions happened; its impressions start earlier because
  // of the lookback, and the file name (when there is one) is the export's own statement of it.
  const window = base.window ?? (summary.conversionWindow ? { start: dayOf(summary.conversionWindow.start), end: dayOf(summary.conversionWindow.end) } : undefined);
  return { ...base, window, kind: "touches", summary };
}

const share = (rows: string[][], test: (row: string[]) => boolean) => (rows.length ? rows.filter(test).length / rows.length : 0);

function readSummary(base: ReportBase, keys: string[], rows: string[][]): SummaryReport {
  const valueIndex = keys.indexOf("currentvalue") >= 0 ? keys.indexOf("currentvalue") : keys.indexOf("value");
  const previousIndex = keys.indexOf("previousvalue");
  const startIndex = keys.indexOf("startdate");
  const endIndex = keys.indexOf("enddate");
  const values: SummaryValue[] = rows.filter((r) => (r[0] ?? "").trim()).map((r) => ({
    metric: r[0].trim(),
    value: parseNumber(r[valueIndex]),
    previous: previousIndex >= 0 ? parseNumber(r[previousIndex]) : null,
    raw: (r[valueIndex] ?? "").trim(),
    percent: isPercentText(r[valueIndex]),
    currency: isCurrencyText(r[valueIndex]),
  }));
  let window = base.window;
  if (!window && startIndex >= 0 && endIndex >= 0) {
    const start = parseDate(rows[0]?.[startIndex]);
    const end = parseDate(rows[0]?.[endIndex]);
    if (start !== null && end !== null) window = { start, end };
  }
  // The platform fills "Previous Value" with zeros when no comparison period was chosen.
  const hasComparison = values.some((v) => v.previous !== null && v.previous !== 0);
  const pacing = values.some((v) => /pacing|budget/i.test(v.metric));
  return { ...base, window, kind: "summary", values, hasComparison, pacing };
}

function readSeries(base: ReportBase, headers: string[], rows: string[][], dateColumn: number, metricColumns: Partial<Record<keyof Metrics, number>>): SeriesReport {
  const keys = Object.keys(metricColumns) as Array<keyof Metrics>;
  // A daily report split by publisher or ad group has several rows per day; the series is their sum.
  const byDay = new Map<number, Metrics>();
  for (const r of rows) {
    const time = parseDate(r[dateColumn]);
    if (time === null) continue;
    const day = dayOf(time);
    const metrics = readMetrics(r, metricColumns);
    const into = byDay.get(day) ?? {};
    for (const k of keys) if (metrics[k] !== undefined) into[k] = (into[k] ?? 0) + (metrics[k] as number);
    byDay.set(day, into);
  }
  const raw: SeriesPoint[] = [...byDay.entries()].map(([day, metrics]) => ({ day, metrics })).sort((a, b) => a.day - b.day);
  // A running total never falls and ends well above where it started. Real daily figures over a
  // week or more do not behave like that, so this does not need the campaign total to decide.
  const cumulative = raw.length >= 5 && keys.length > 0 && keys.every((k) => {
    const values = raw.map((p) => p.metrics[k] ?? 0);
    return values.every((v, i) => i === 0 || v >= values[i - 1] - 1e-6) && values[values.length - 1] > values[0] * 3;
  });
  const points = cumulative
    ? raw.map((p, i) => ({ day: p.day, metrics: Object.fromEntries(keys.map((k) => [k, (p.metrics[k] ?? 0) - (i === 0 ? 0 : raw[i - 1].metrics[k] ?? 0)])) as Metrics }))
    : raw;
  const notes = [...base.notes];
  if (byDay.size < rows.length && !cumulative) notes.push("Several rows share a date; each day is their sum.");
  if (cumulative) notes.push(`${headers.filter((_, i) => Object.values(metricColumns).includes(i)).join(", ")} are running totals; converted to daily values.`);
  const window = base.window ?? (raw.length ? { start: raw[0].day, end: raw[raw.length - 1].day } : undefined);
  return { ...base, notes, window, kind: "series", points, cumulative, ...(cumulative ? { finalTotals: raw[raw.length - 1].metrics } : {}) };
}

function readMetrics(row: string[], columns: Partial<Record<keyof Metrics, number>>): Metrics {
  const metrics: Metrics = {};
  for (const key of METRIC_KEYS) {
    const index = columns[key];
    if (index === undefined) continue;
    const value = parseNumber(row[index]);
    if (value !== null) metrics[key] = value;
  }
  return metrics;
}

function readBreakdown(base: ReportBase, headers: string[], rows: string[][], columns: ReturnType<typeof mapColumns>): BreakdownReport {
  const keys = headers.map(normalizeHeader);
  const textColumns = columns.other.filter((i) => share(rows, (r) => (r[i] ?? "").trim() !== "" && parseNumber(r[i]) === null) >= 0.5);
  // The platform's Publisher report has both "name" and "displayName"; the display name is what a planner knows.
  const nameColumn = textColumns.find((i) => keys[i] === "displayname") ?? textColumns.find((i) => keys[i] === "name") ?? textColumns[0];
  const attributeColumns = textColumns.filter((i) => i !== nameColumn && keys[i] !== "name");
  const ignoredColumns = [...columns.unused, ...columns.other.filter((i) => i !== nameColumn && !attributeColumns.includes(i) && keys[i] !== "name").map((i) => headers[i])];

  const parsed: BreakdownRow[] = rows.map((r, index) => {
    const pm = columns.ratios.pm !== undefined ? parseNumber(r[columns.ratios.pm]) : null;
    return {
      name: nameColumn !== undefined ? (r[nameColumn] ?? "").trim() || `Row ${index + 1}` : `Row ${index + 1}`,
      attributes: Object.fromEntries(attributeColumns.map((i) => [headers[i], (r[i] ?? "").trim()]).filter(([, v]) => v)),
      metrics: readMetrics(r, columns.metrics),
      ...(pm !== null ? { exportedPm: pm } : {}),
    };
  });
  // "Total" rows would double every sum.
  const dataRows = parsed.filter((r) => !/^(grand\s+)?totals?$/i.test(r.name));
  const totals: Metrics = {};
  for (const key of Object.keys(columns.metrics) as Array<keyof Metrics>) totals[key] = dataRows.reduce((sum, r) => sum + (r.metrics[key] ?? 0), 0);

  const ratioChecks = checkRatios(rows, headers, columns, base.platform);
  const notes = [...base.notes];
  if (dataRows.length < parsed.length) notes.push("A total row in the export was left out so it is not counted twice.");
  const dimension = base.file.reportType ?? (nameColumn !== undefined ? headers[nameColumn] : "Breakdown");
  return { ...base, notes, kind: "breakdown", dimension, rows: dataRows, totals, conversionsHeader: columns.conversionsHeader, ratioChecks, ignoredColumns };
}

// A scale is accepted when nearly every comparable row agrees with it; the platform rounds to
// several decimals, so half a percent is ample.
const RATIO_TOLERANCE = 0.005;
const RATIO_AGREEMENT = 0.9;

function checkRatios(rows: string[][], headers: string[], columns: ReturnType<typeof mapColumns>, platform: boolean): RatioCheck[] {
  const checks: RatioCheck[] = [];
  for (const [ratio, index] of Object.entries(columns.ratios) as Array<[RatioKey, number]>) {
    if (ratio === "pm") continue; // Needs campaign totals; checked where those are known.
    const definition = RATIO_DEFINITIONS[ratio];
    const pairs = rows
      .map((r) => ({ computed: definition.compute(readMetrics(r, columns.metrics)), exported: parseNumber(r[index]) }))
      .filter((p): p is { computed: number; exported: number } => p.computed !== null && p.computed > 0 && p.exported !== null && p.exported > 0);
    if (pairs.length === 0) {
      checks.push({ ratio, header: headers[index], scale: null, status: "unchecked", compared: 0 });
      continue;
    }
    const scale = definition.scales.find((s) => pairs.filter((p) => Math.abs(p.exported - p.computed * s) <= Math.abs(p.computed * s) * RATIO_TOLERANCE + 1e-9).length / pairs.length >= RATIO_AGREEMENT) ?? null;
    const expected = platform ? PLATFORM_RATIO_SCALES[ratio] : undefined;
    const status = scale === null || (expected !== undefined && scale !== expected) ? "mismatch" : "verified";
    checks.push({ ratio, header: headers[index], scale, status, compared: pairs.length });
  }
  return checks;
}
