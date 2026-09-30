// Cell values as the reporting platform and spreadsheets write them: "$950,000.01", "66.74%",
// "(12.5)", "2/09/2026", "2024-05-25 15:51:30". Dates become UTC milliseconds; the exports carry no
// time zone, and every calculation here is a difference between two of their own timestamps.

export function parseNumber(raw: string | undefined): number | null {
  const text = (raw ?? "").trim();
  if (!text || /^(n\/?a|null|none|-|—)$/i.test(text)) return null;
  const negative = /^\(.*\)$/.test(text) || /^-/.test(text);
  const cleaned = text.replace(/[()$,%\s]/g, "").replace(/^[-+]/, "");
  if (!/^(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(cleaned)) return null;
  const value = Number(cleaned);
  return negative ? -value : value;
}

export const isPercentText = (raw: string | undefined) => /%\s*$/.test((raw ?? "").trim());
export const isCurrencyText = (raw: string | undefined) => /^\(?-?\$/.test((raw ?? "").trim());

const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/;
const US = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?)?$/i;

export function parseDate(raw: string | undefined): number | null {
  const text = (raw ?? "").trim();
  let parts: number[] | null = null;
  let m = ISO.exec(text);
  if (m) {
    parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)];
  } else if ((m = US.exec(text))) {
    // The platform is US-only and writes month first.
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    let hour = Number(m[4] ?? 0);
    if (m[7]) hour = (hour % 12) + (m[7].toLowerCase() === "pm" ? 12 : 0);
    parts = [year, Number(m[1]), Number(m[2]), hour, Number(m[5] ?? 0), Number(m[6] ?? 0)];
  }
  if (!parts) return null;
  const [y, mo, d, h, mi, s] = parts;
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(ms);
  // Date.UTC rolls 2/30 over to 3/2; a date that does not round-trip was not a date.
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return ms;
}

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

export const formatDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export interface DateWindow {
  /** First day covered, UTC midnight. */
  start: number;
  /** Last day covered, UTC midnight (inclusive). */
  end: number;
}

export const dayOf = (ms: number) => Math.floor(ms / DAY_MS) * DAY_MS;
export const windowDays = (w: DateWindow) => Math.round((w.end - w.start) / DAY_MS) + 1;
export const formatWindow = (w: DateWindow) => `${formatDay(w.start)} to ${formatDay(w.end)}`;

/** Exports cut at midnight in the platform's zone, so a day of slack either side is the same window. */
export const sameWindow = (a: DateWindow, b: DateWindow) => Math.abs(a.start - b.start) <= DAY_MS && Math.abs(a.end - b.end) <= DAY_MS;
export const withinWindow = (inner: DateWindow, outer: DateWindow) => inner.start >= outer.start - DAY_MS && inner.end <= outer.end + DAY_MS;

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * q;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}
