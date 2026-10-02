// An uploaded export as a table the planner can look through: its rows as they were exported, with
// each column marked by what the reader made of it. The roles come from the same column mapping
// the analysis uses, so a column shown as read is one ScoutAI's numbers were built from, and a
// misread export shows up here as a column marked ignored.

import { parseCsv } from "./csv";
import { mapColumns, normalizeHeader, type MetricKey } from "./columns";
import { findDateColumn, type Report } from "./reports";
import { parseNumber } from "./values";

export type ColumnRole =
  /** A count ScoutAI adds up: spend, impressions, conversions... */
  | "metric"
  /** A ratio in the export, checked against the counts but never used as it is. */
  | "ratio"
  /** What each row is: its name, date or a descriptive attribute. */
  | "label"
  /** Read past: nothing in the analysis comes from it. */
  | "ignored"
  /** The file was not read as rows of metrics, so no column has a role. */
  | "none";

export interface DatasetColumn {
  header: string;
  role: ColumnRole;
  /** What the column was read as, e.g. "Conversions"; shown on hover. */
  readAs?: string;
  numeric: boolean;
}

export interface DatasetTable {
  columns: DatasetColumn[];
  rows: string[][];
}

export interface DatasetSort {
  column: number;
  direction: "asc" | "desc";
}

/** Rows shown before "Show more": enough to read a report, few enough not to stall the page. */
export const ROW_PAGE = 500;

const METRIC_LABEL: Record<MetricKey, string> = {
  impressions: "Impressions",
  spend: "Spend",
  conversions: "Conversions",
  revenue: "Revenue",
  clicks: "Clicks",
  videoCompletions: "Video completions",
  videoImpressions: "Video impressions",
};

/**
 * The export as rows, with column roles for the kind of report the analysis read it as.
 * `ignoredColumns` is the breakdown reader's own list, so the two never disagree.
 */
export function buildDatasetTable(text: string, kind: Report["kind"], ignoredColumns: string[] = []): DatasetTable {
  const { headers, rows } = parseCsv(text);
  // A trailing newline or a blank line between sections reads as a row of one empty cell.
  const dataRows = rows.filter((r) => r.some((cell) => cell.trim() !== ""));
  const roles = columnRoles(headers, dataRows, kind, ignoredColumns);
  return {
    columns: headers.map((header, i) => ({ header, ...roles[i], numeric: isNumericColumn(dataRows, i) })),
    rows: dataRows,
  };
}

function columnRoles(headers: string[], rows: string[][], kind: Report["kind"], ignoredColumns: string[]): Array<{ role: ColumnRole; readAs?: string }> {
  if (kind === "unread") return headers.map(() => ({ role: "ignored" }));
  if (kind !== "breakdown" && kind !== "series") return headers.map(() => ({ role: "none" }));
  const map = mapColumns(headers);
  const metricAt = new Map(Object.entries(map.metrics).map(([key, i]) => [i, key as MetricKey]));
  const ratioAt = new Map(Object.entries(map.ratios).map(([key, i]) => [i, key]));
  const dateColumn = kind === "series" ? findDateColumn(headers, rows, map.other) : undefined;
  const ignored = new Set(ignoredColumns);
  return headers.map((header, i) => {
    const metric = metricAt.get(i);
    if (metric) return { role: "metric", readAs: metric === "conversions" ? `Conversions (${header})` : METRIC_LABEL[metric] };
    const ratio = ratioAt.get(i);
    if (ratio) return { role: "ratio", readAs: `${ratio.toUpperCase()}, recomputed from the counts` };
    if (i === dateColumn) return { role: "label", readAs: "Date" };
    // A daily report is summed by day, so its other columns (a publisher split, say) are not read.
    if (kind === "series" || ignored.has(header) || map.unused.includes(header)) return { role: "ignored" };
    return { role: "label", readAs: normalizeHeader(header) === "name" || normalizeHeader(header) === "displayname" ? "Row name" : "Label" };
  });
}

/** Mostly numbers, so it sorts and aligns as numbers. */
function isNumericColumn(rows: string[][], index: number): boolean {
  const filled = rows.map((r) => r[index] ?? "").filter((v) => v.trim() !== "");
  return filled.length > 0 && filled.filter((v) => parseNumber(v) !== null).length / filled.length >= 0.8;
}

/** Rows containing the text in any cell, ignoring case. */
export function filterRows(rows: string[][], query: string): string[][] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((r) => r.some((cell) => cell.toLowerCase().includes(needle)));
}

/** Rows ordered by one column; blanks always last, whichever way the sort runs. */
export function sortRows(rows: string[][], columns: DatasetColumn[], sort: DatasetSort | null): string[][] {
  if (!sort) return rows;
  const { column, direction } = sort;
  const numeric = columns[column]?.numeric;
  const sign = direction === "asc" ? 1 : -1;
  const value = (r: string[]) => (r[column] ?? "").trim();
  return [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (!x || !y) return x ? -1 : y ? 1 : 0;
    if (numeric) {
      const nx = parseNumber(x);
      const ny = parseNumber(y);
      if (nx === null || ny === null) return nx !== null ? -1 : ny !== null ? 1 : 0;
      return (nx - ny) * sign;
    }
    return x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" }) * sign;
  });
}

/** Header click: ascending, then descending, then the export's own order. */
export function nextSort(current: DatasetSort | null, column: number): DatasetSort | null {
  if (!current || current.column !== column) return { column, direction: "asc" };
  return current.direction === "asc" ? { column, direction: "desc" } : null;
}
