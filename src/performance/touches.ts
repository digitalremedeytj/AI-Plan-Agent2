// Touch-level conversion exports: "Last Touch" (one row per conversion, the impression credited
// with it) and "All Touch" (one row per impression on each conversion's path). They are the only
// data that shows what last-touch credit hides: a household that watched the CTV ad and converted
// after a display impression is credited to display.
//
// They are household-level (hashed IPs) and run to hundreds of thousands of rows, so they are
// summarised where they are read and only the summary is kept. Rows are fed one at a time; memory
// grows with conversions, not rows, and no household hash appears in the output.
//
// Traps in the format, each handled below:
// - All Touch repeats a conversion's revenue on every touch row. Revenue is counted once per conversion.
// - "Publisher" repeats the media type for anything that is not CTV ("Display"); that is no publisher.
// - One household can convert several times; conversions and converting households are counted apart.
// - "Times Exposed" is reported as-is and checked against the rows, not relied on for frequency.

import { normalizeHeader } from "./columns";
import { HOUR_MS, parseDate, parseNumber, quantile } from "./values";

export interface TouchColumns {
  conversionId: number;
  conversionTime: number;
  impressionTime: number;
  household?: number;
  revenue?: number;
  mediaType?: number;
  publisher?: number;
  creative?: number;
  audience?: number;
  state?: number;
  dma?: number;
  device?: number;
  timesExposed?: number;
}

const TOUCH_SYNONYMS: Record<keyof TouchColumns, string[]> = {
  conversionId: ["uniqueid", "conversionid", "orderid", "transactionid"],
  conversionTime: ["conversiontimestamp", "conversiontime", "conversiondate"],
  impressionTime: ["imptimestamp", "impressiontimestamp", "impressiontime", "imptime"],
  household: ["hashedipaddress", "hashedip", "iphash", "householdid"],
  revenue: ["rev", "revenue", "conversionvalue", "ordervalue"],
  mediaType: ["mediatype"],
  publisher: ["publisher"],
  creative: ["creative"],
  audience: ["audiencetactic", "audience", "tactic"],
  state: ["state"],
  dma: ["dma"],
  device: ["devicetype", "device"],
  timesExposed: ["timesexposed"],
};

export function detectTouchColumns(headers: string[]): TouchColumns | null {
  const keys = headers.map(normalizeHeader);
  const found: Partial<TouchColumns> = {};
  for (const [field, names] of Object.entries(TOUCH_SYNONYMS) as Array<[keyof TouchColumns, string[]]>) {
    const index = keys.findIndex((k) => names.includes(k));
    if (index >= 0) found[field] = index;
  }
  return found.conversionId !== undefined && found.conversionTime !== undefined && found.impressionTime !== undefined ? (found as TouchColumns) : null;
}

// Touches this close together on one path are not a person watching ads; they point at a broken
// frequency cap or stacked placements.
export const BURST_WINDOW_MINUTES = 60;
export const BURST_TOUCHES = 10;
const MAX_PATH_STEPS = 5;
const TOP_PATHS = 10;
const TOP_PLACES = 10;
const TOP_PUBLISHERS = 15;

const CTV_MEDIA = /\b(ott|ctv|connected\s*tv|streaming\s*tv)\b/i;

export interface MediaTypeCredit {
  mediaType: string;
  isCtv: boolean;
  /** Conversions credited under each model. Linear splits a conversion across its touches by count. */
  lastTouch: number;
  firstTouch: number;
  anyTouch: number;
  /** Conversions whose whole path was this media type. */
  onlyTouch: number;
  linear: number;
  lastTouchRevenue: number;
  linearRevenue: number;
  /** Impressions on converting paths. */
  touches: number;
  /** From this media type's last touch to the conversion, for conversions it is credited with. */
  medianHoursToConvert: number | null;
}

export interface PathCount {
  path: string[];
  conversions: number;
  revenue: number;
}

export interface Tally {
  name: string;
  conversions: number;
}

export interface TouchSummary {
  attribution: "all-touch" | "last-touch";
  rows: number;
  unreadRows: number;
  conversions: number;
  households: number;
  /** Households that converted more than once. */
  repeatHouseholds: number | null;
  revenue: number;
  conversionWindow: { start: number; end: number } | null;
  firstImpression: number | null;
  /** Longest gap from a credited impression to its conversion: at least the attribution lookback. */
  maxLookbackHours: number;
  medianHoursToConvert: number | null;
  touchesPerConversion: { mean: number; median: number; p90: number; max: number } | null;
  byMediaType: MediaTypeCredit[];
  paths: PathCount[];
  distinctPaths: number;
  ctv: { anyTouch: number; lastTouch: number; onlyCtv: number; creditedElsewhere: number } | null;
  publishers: Array<{ name: string; anyTouch: number; lastTouch: number }>;
  /** Where and on what the credited (last) touch happened. */
  dma: Tally[];
  state: Tally[];
  device: Tally[];
  bursts: { windowMinutes: number; minTouches: number; conversions: number; maxInWindow: number; byMediaType: Tally[] } | null;
  timesExposed: { median: number; max: number; matchesPathLength: number | null } | null;
  anomalies: { revenueDiffersWithinConversion: number; impressionAfterConversion: number };
  notes: string[];
}

class Interner {
  private readonly ids = new Map<string, number>();
  readonly names: string[] = [];
  id(name: string): number {
    let id = this.ids.get(name);
    if (id === undefined) {
      id = this.names.length;
      this.ids.set(name, id);
      this.names.push(name);
    }
    return id;
  }
}

interface Conversion {
  revenue: number;
  time: number;
  household: number;
  times: number[];
  media: number[];
  publishers: number[];
  /** The latest touch so far and where it happened: the credited touch once the file is read. */
  lastTime: number;
  lastPlace: [number, number, number];
  exposed: number[];
}

const NONE = -1;

export class TouchSummarizer {
  private readonly columns: TouchColumns;
  private readonly conversions = new Map<string, Conversion>();
  private readonly media = new Interner();
  private readonly publishers = new Interner();
  private readonly places = new Interner();
  private readonly households = new Interner();
  private rows = 0;
  private unread = 0;
  private revenueMismatch = 0;
  private afterConversion = 0;

  constructor(headers: string[], private readonly fileName = "") {
    const columns = detectTouchColumns(headers);
    if (!columns) throw new Error("Not a touch-level report: conversion id, conversion time and impression time columns are required.");
    this.columns = columns;
  }

  add(row: string[]) {
    this.rows++;
    const c = this.columns;
    const cell = (index: number | undefined) => (index === undefined ? "" : (row[index] ?? "").trim());
    const id = cell(c.conversionId);
    const time = parseDate(cell(c.conversionTime));
    const impression = parseDate(cell(c.impressionTime));
    if (!id || time === null || impression === null) {
      this.unread++;
      return;
    }
    const mediaName = cell(c.mediaType) || "Unknown";
    const media = this.media.id(mediaName);
    const publisherName = cell(c.publisher);
    const publisher = publisherName && normalizeHeader(publisherName) !== normalizeHeader(mediaName) ? this.publishers.id(publisherName) : NONE;
    const revenue = parseNumber(cell(c.revenue)) ?? 0;
    const place: [number, number, number] = [
      cell(c.dma) ? this.places.id(`dma:${cell(c.dma)}`) : NONE,
      cell(c.state) ? this.places.id(`state:${cell(c.state)}`) : NONE,
      cell(c.device) ? this.places.id(`device:${cell(c.device)}`) : NONE,
    ];
    if (impression > time) this.afterConversion++;
    const exposed = parseNumber(cell(c.timesExposed));

    let conversion = this.conversions.get(id);
    if (!conversion) {
      conversion = {
        revenue,
        time,
        household: cell(c.household) ? this.households.id(cell(c.household)) : NONE,
        times: [],
        media: [],
        publishers: [],
        lastTime: -Infinity,
        lastPlace: place,
        exposed: [],
      };
      this.conversions.set(id, conversion);
    } else if (Math.abs(conversion.revenue - revenue) > 0.005) {
      this.revenueMismatch++;
    }
    conversion.times.push(impression);
    conversion.media.push(media);
    conversion.publishers.push(publisher);
    if (exposed !== null) conversion.exposed.push(exposed);
    if (impression >= conversion.lastTime) {
      conversion.lastTime = impression;
      conversion.lastPlace = place;
    }
  }

  finish(): TouchSummary {
    const allTouch = [...this.conversions.values()].some((c) => c.times.length > 1);
    const mediaNames = this.media.names;
    const isCtv = mediaNames.map((name) => CTV_MEDIA.test(name));
    const credit = mediaNames.map((name, i) => ({ mediaType: name, isCtv: isCtv[i], lastTouch: 0, firstTouch: 0, anyTouch: 0, onlyTouch: 0, linear: 0, lastTouchRevenue: 0, linearRevenue: 0, touches: 0, hours: [] as number[] }));
    const paths = new Map<string, PathCount>();
    const publisherCredit = this.publishers.names.map((name) => ({ name, anyTouch: 0, lastTouch: 0 }));
    const placeCounts = new Map<number, number>();
    const burstMedia = new Map<number, number>();
    const pathLengths: number[] = [];
    const lagHours: number[] = [];
    const householdConversions = new Map<number, number>();
    const ctv = { anyTouch: 0, lastTouch: 0, onlyCtv: 0, creditedElsewhere: 0 };
    let revenue = 0;
    let bursts = 0;
    let maxInWindow = 0;
    let maxLookback = 0;
    let firstImpression = Infinity;
    let start = Infinity;
    let end = -Infinity;
    const exposedValues: number[] = [];
    let exposedMatches = 0;
    let exposedCompared = 0;

    for (const c of this.conversions.values()) {
      revenue += c.revenue;
      start = Math.min(start, c.time);
      end = Math.max(end, c.time);
      if (c.household !== NONE) householdConversions.set(c.household, (householdConversions.get(c.household) ?? 0) + 1);
      for (const p of c.lastPlace) if (p !== NONE) placeCounts.set(p, (placeCounts.get(p) ?? 0) + 1);

      const order = c.times.map((_, i) => i).sort((a, b) => c.times[a] - c.times[b]);
      const first = order[0];
      const last = order[order.length - 1];
      firstImpression = Math.min(firstImpression, c.times[first]);
      maxLookback = Math.max(maxLookback, (c.time - c.times[first]) / HOUR_MS);
      const hours = Math.max(0, (c.time - c.times[last]) / HOUR_MS);
      lagHours.push(hours);
      pathLengths.push(c.times.length);

      const lastMedia = c.media[last];
      credit[lastMedia].lastTouch++;
      credit[lastMedia].lastTouchRevenue += c.revenue;
      credit[lastMedia].hours.push(hours);
      credit[c.media[first]].firstTouch++;
      const perMedia = new Map<number, number>();
      for (const m of c.media) perMedia.set(m, (perMedia.get(m) ?? 0) + 1);
      for (const [m, count] of perMedia) {
        credit[m].anyTouch++;
        credit[m].touches += count;
        credit[m].linear += count / c.media.length;
        credit[m].linearRevenue += (c.revenue * count) / c.media.length;
      }
      if (perMedia.size === 1) credit[lastMedia].onlyTouch++;

      const publishersOnPath = new Set(c.publishers.filter((p) => p !== NONE));
      for (const p of publishersOnPath) publisherCredit[p].anyTouch++;
      if (c.publishers[last] !== NONE) publisherCredit[c.publishers[last]].lastTouch++;

      if (allTouch) {
        const steps: number[] = [];
        for (const i of order) if (steps[steps.length - 1] !== c.media[i]) steps.push(c.media[i]);
        const shown = steps.length > MAX_PATH_STEPS ? [...steps.slice(0, MAX_PATH_STEPS - 1), NONE, steps[steps.length - 1]] : steps;
        const names = shown.map((m) => (m === NONE ? "…" : mediaNames[m]));
        const key = names.join(" > ");
        const entry = paths.get(key) ?? { path: names, conversions: 0, revenue: 0 };
        entry.conversions++;
        entry.revenue += c.revenue;
        paths.set(key, entry);

        const ctvOnPath = [...perMedia.keys()].some((m) => isCtv[m]);
        if (ctvOnPath) {
          ctv.anyTouch++;
          if (isCtv[lastMedia]) ctv.lastTouch++;
          else ctv.creditedElsewhere++;
          if ([...perMedia.keys()].every((m) => isCtv[m])) ctv.onlyCtv++;
        }

        // Most touches inside any one window, found with two pointers over the sorted times.
        let most = 0;
        let mostAt = 0;
        for (let lo = 0, hi = 0; hi < order.length; hi++) {
          while (c.times[order[hi]] - c.times[order[lo]] > BURST_WINDOW_MINUTES * 60_000) lo++;
          if (hi - lo + 1 > most) {
            most = hi - lo + 1;
            mostAt = lo;
          }
        }
        maxInWindow = Math.max(maxInWindow, most);
        if (most >= BURST_TOUCHES) {
          bursts++;
          const inWindow = order.slice(mostAt, mostAt + most).map((i) => c.media[i]);
          const counts = new Map<number, number>();
          for (const m of inWindow) counts.set(m, (counts.get(m) ?? 0) + 1);
          const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
          burstMedia.set(top, (burstMedia.get(top) ?? 0) + 1);
        }
      }

      if (c.exposed.length) {
        const reported = Math.max(...c.exposed);
        exposedValues.push(reported);
        if (allTouch) {
          exposedCompared++;
          if (reported === c.times.length) exposedMatches++;
        }
      }
    }

    const conversions = this.conversions.size;
    const tally = (prefix: string): Tally[] =>
      this.places.names
        .map((name, id) => ({ name, id }))
        .filter((p) => p.name.startsWith(prefix))
        .map((p) => ({ name: p.name.slice(prefix.length), conversions: placeCounts.get(p.id) ?? 0 }))
        .sort((a, b) => b.conversions - a.conversions)
        .slice(0, TOP_PLACES);
    const sortedLengths = [...pathLengths].sort((a, b) => a - b);
    const sortedLag = [...lagHours].sort((a, b) => a - b);
    const sortedExposed = [...exposedValues].sort((a, b) => a - b);
    const hint = /all[\s_-]*touch/i.test(this.fileName) ? "all-touch" : /last[\s_-]*touch/i.test(this.fileName) ? "last-touch" : null;
    const attribution = allTouch ? "all-touch" : "last-touch";

    const notes: string[] = [];
    if (hint && hint !== attribution) notes.push(`The file name says ${hint}, but ${allTouch ? "conversions repeat across rows" : "every conversion has one row"}, so it was read as ${attribution}.`);
    if (this.unread) notes.push(`${this.unread} row(s) had no conversion id or no readable timestamps and were skipped.`);
    if (this.revenueMismatch) notes.push(`${this.revenueMismatch} touch row(s) carried a different revenue from the rest of their conversion; the first value was used.`);
    if (this.afterConversion) notes.push(`${this.afterConversion} impression(s) are timestamped after the conversion they are credited with.`);
    if (exposedCompared > 0 && exposedMatches / exposedCompared < 0.9) {
      notes.push(`"Times Exposed" matches the number of touch rows for only ${Math.round((exposedMatches / exposedCompared) * 100)}% of conversions, so frequency here is counted from the rows.`);
    }

    return {
      attribution,
      rows: this.rows,
      unreadRows: this.unread,
      conversions,
      households: householdConversions.size,
      repeatHouseholds: householdConversions.size ? [...householdConversions.values()].filter((n) => n > 1).length : null,
      revenue,
      conversionWindow: conversions ? { start, end } : null,
      firstImpression: Number.isFinite(firstImpression) ? firstImpression : null,
      maxLookbackHours: Math.round(maxLookback),
      medianHoursToConvert: sortedLag.length ? quantile(sortedLag, 0.5) : null,
      touchesPerConversion: allTouch && conversions
        ? { mean: pathLengths.reduce((a, b) => a + b, 0) / conversions, median: quantile(sortedLengths, 0.5), p90: quantile(sortedLengths, 0.9), max: sortedLengths[sortedLengths.length - 1] }
        : null,
      byMediaType: credit
        .map(({ hours, ...c }) => ({ ...c, medianHoursToConvert: hours.length ? quantile(hours.sort((a, b) => a - b), 0.5) : null }))
        .sort((a, b) => b.lastTouch - a.lastTouch || b.anyTouch - a.anyTouch),
      paths: [...paths.values()].sort((a, b) => b.conversions - a.conversions).slice(0, TOP_PATHS),
      distinctPaths: paths.size,
      ctv: allTouch ? ctv : null,
      publishers: publisherCredit.sort((a, b) => b.anyTouch - a.anyTouch || b.lastTouch - a.lastTouch).slice(0, TOP_PUBLISHERS),
      dma: tally("dma:"),
      state: tally("state:"),
      device: tally("device:"),
      bursts: allTouch
        ? { windowMinutes: BURST_WINDOW_MINUTES, minTouches: BURST_TOUCHES, conversions: bursts, maxInWindow, byMediaType: [...burstMedia.entries()].map(([m, n]) => ({ name: mediaNames[m], conversions: n })).sort((a, b) => b.conversions - a.conversions) }
        : null,
      timesExposed: sortedExposed.length
        ? { median: quantile(sortedExposed, 0.5), max: sortedExposed[sortedExposed.length - 1], matchesPathLength: exposedCompared ? exposedMatches / exposedCompared : null }
        : null,
      anomalies: { revenueDiffersWithinConversion: this.revenueMismatch, impressionAfterConversion: this.afterConversion },
      notes,
    };
  }
}
