import type { ChannelStrategyData, ExtractedPlacement, GeographyType, ParsedPlanOption, RfpAnalysis } from "../types";
import { parseGeoTextInput } from "../utils/geoReference";
import { buildAllocationView } from "./allocationRows";
import { rfpLineLabel } from "./engine";

/**
 * Uploading a media plan onto a plan that has already been generated. The upload is the truth:
 * its budget, flight and locations replace the brief's, and a new upload replaces the last one.
 * Nothing here touches the plan; these are the pieces the review step shows before the planner
 * approves (src/components/PlanUploadModal.tsx).
 */

export interface BriefFields {
  budget: string;
  campaignLength: string;
  geographyType: GeographyType;
  geoTargets: string[];
}

export interface UploadedGeography {
  type: GeographyType;
  targets: string[];
  /** Locations in the upload that matched no state or DMA. */
  unrecognized: string[];
}

export interface UploadedBrief {
  budget: number | null;
  flightDays: number | null;
  /** Null when the upload names no locations, or none that can be read, so the brief's stay. */
  geography: UploadedGeography | null;
  /** Locations the upload names that matched no state or DMA; the planner is told, nothing is guessed. */
  unreadLocations: string[];
  /** Who the upload says it targets; compared with the research by the planner, never applied. */
  audiences: string[];
}

export interface BriefChange {
  field: "budget" | "flight" | "geography";
  label: string;
  from: string;
  to: string;
}

const NATIONAL = /\b(national|nationwide|united states|usa|u\.s\.a?\.?|all (us )?markets)\b/i;

/** The brief's one-line geography, as saved on a plan and sent to the engine. */
export function describeGeography(type: GeographyType, targets: string[]): string {
  if (type === "National") return "National";
  if (targets.length === 0) return type;
  if (type === "State") {
    const code = (target: string) => target.match(/\(([^)]+)\)/)?.[1] || target;
    if (targets.length <= 4) return `State (${targets.map(code).join(", ")})`;
    return `State (${targets.length} States: ${targets.slice(0, 3).map(code).join(", ")}, +${targets.length - 3} more)`;
  }
  if (type === "DMA") {
    const market = (target: string) => target.split(",")[0];
    if (targets.length <= 3) return `DMA (${targets.map(market).join(", ")})`;
    return `DMA (${targets.length} Markets: ${targets.slice(0, 2).map(market).join(", ")}, +${targets.length - 2} more)`;
  }
  return type;
}

/**
 * The upload's locations as a brief geography. Uploads name places loosely ("Nationwide",
 * "CA, NV", "Los Angeles DMA"), so each scope is tried and the one that recognises more wins;
 * what neither recognises is reported rather than guessed. Null geography when nothing is readable.
 */
export function geographyFrom(texts: string[]): { geography: UploadedGeography | null; unread: string[] } {
  const cleaned = texts.map((text) => text.trim()).filter(Boolean);
  if (cleaned.length === 0) return { geography: null, unread: [] };
  if (cleaned.some((text) => NATIONAL.test(text))) return { geography: { type: "National", targets: [], unrecognized: [] }, unread: [] };
  const joined = cleaned.map((text) => text.replace(/\bDMAs?\b/gi, "")).join(", ");
  const states = parseGeoTextInput(joined, "State");
  const dmas = parseGeoTextInput(joined, "DMA");
  const best = dmas.valid.length > states.valid.length ? { type: "DMA" as const, ...dmas } : { type: "State" as const, ...states };
  const unread = Array.from(new Set(best.unrecognized));
  if (best.valid.length === 0) return { geography: null, unread };
  return { geography: { type: best.type, targets: best.valid, unrecognized: unread }, unread };
}

/** Days from the earliest start to the latest end of the chosen options, inclusive. */
export function flightDaysFrom(options: ParsedPlanOption[]): number | null {
  const starts = options.map((option) => option.flightDates?.start).filter(Boolean) as string[];
  const ends = options.map((option) => option.flightDates?.end).filter(Boolean) as string[];
  if (starts.length === 0 || ends.length === 0) return null;
  const start = new Date([...starts].sort()[0]);
  const end = new Date([...ends].sort().at(-1)!);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) return null;
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

export function uploadedBrief(selected: ParsedPlanOption[], metadata?: RfpAnalysis["extractedMetadata"]): UploadedBrief {
  const placements = selected.flatMap((option) => option.placements || []);
  const budget = selected.reduce((sum, option) => sum + (Number(option.budget) || 0), 0);
  // Locations on the lines themselves are the plan's; the RFP's stated geographies are the fallback.
  const lineGeos = placements.map((placement) => placement.locationDetails || "").filter((text) => text.trim());
  const audiences = Array.from(new Set([
    ...(metadata?.targetAudiences || []),
    ...placements.map((placement) => placement.audience || ""),
  ].map((text) => text.trim()).filter(Boolean)));
  const geo = geographyFrom(Array.from(new Set(lineGeos.length > 0 ? lineGeos : metadata?.geographies || [])));
  return {
    budget: budget > 0 ? budget : null,
    flightDays: flightDaysFrom(selected),
    geography: geo.geography,
    unreadLocations: geo.unread,
    audiences,
  };
}

const money = (value: number) => `$${Math.round(value).toLocaleString()}`;

/** What approving the upload changes in the brief. Only fields the upload actually states. */
export function briefChanges(current: BriefFields, next: UploadedBrief): BriefChange[] {
  const changes: BriefChange[] = [];
  const currentBudget = Number(String(current.budget).replace(/[^0-9.]/g, "")) || 0;
  if (next.budget !== null && Math.round(next.budget) !== Math.round(currentBudget)) {
    changes.push({ field: "budget", label: "Budget", from: currentBudget ? money(currentBudget) : "Not set", to: money(next.budget) });
  }
  const currentDays = Number(current.campaignLength) || 0;
  if (next.flightDays !== null && next.flightDays !== currentDays) {
    changes.push({ field: "flight", label: "Flight", from: currentDays ? `${currentDays} days` : "Not set", to: `${next.flightDays} days` });
  }
  if (next.geography) {
    const from = describeGeography(current.geographyType, current.geoTargets);
    const to = describeGeography(next.geography.type, next.geography.targets);
    if (from !== to) changes.push({ field: "geography", label: "Locations", from, to });
  }
  return changes;
}

/** Applies the planner's mapping (by line label) onto the uploaded lines; unmapped lines are unchanged. */
export function withChannelMapping(placements: ExtractedPlacement[], mapping: Record<string, string>): ExtractedPlacement[] {
  return placements.map((placement) => {
    const channelId = mapping[rfpLineLabel(placement)];
    return channelId ? { ...placement, channelId } : placement;
  });
}

export interface LineMapping {
  label: string;
  dollars: number;
  /** The media type the lines landed in, or null when outside the catalog. */
  channelId: string | null;
  channelName: string | null;
}

/** Each distinct uploaded line and the media type the engine put it in, largest first. */
export function lineMappings(strategy: ChannelStrategyData): LineMapping[] {
  const baseline = strategy.mediaPlan?.rfpBaseline;
  if (!baseline) return [];
  const byLabel = new Map<string, LineMapping>();
  const add = (label: string, dollars: number, channelId: string | null, channelName: string | null) => {
    const entry = byLabel.get(label) ?? { label, dollars: 0, channelId, channelName };
    entry.dollars += dollars;
    byLabel.set(label, entry);
  };
  baseline.channels.forEach((channel) => channel.lines.forEach((line) => add(line.label, line.budget, channel.channelId, channel.channelName)));
  baseline.unmatchedLines.forEach((line) => add(line.label, line.budget, null, null));
  return [...byLabel.values()].sort((a, b) => b.dollars - a.dollars || a.label.localeCompare(b.label));
}

export interface AllocationChange {
  name: string;
  before: number | null;
  after: number | null;
}

/** The plan's media types before and after, by name, with totals. Rows in neither plan are left out. */
export function allocationChanges(before: ChannelStrategyData | null | undefined, after: ChannelStrategyData): { rows: AllocationChange[]; beforeTotal: number; afterTotal: number } {
  const rowsOf = (strategy: ChannelStrategyData | null | undefined) => {
    if (!strategy?.mediaPlan) return { rows: new Map<string, number>(), total: 0 };
    const view = buildAllocationView(strategy);
    const rows = new Map<string, number>();
    [...view.rfpRows, ...view.addedRows].forEach((row) => rows.set(row.channelName, (rows.get(row.channelName) || 0) + (row.dollars || 0)));
    return { rows, total: view.planTotal };
  };
  const was = rowsOf(before);
  const now = rowsOf(after);
  const names = Array.from(new Set([...now.rows.keys(), ...was.rows.keys()]));
  const rows = names.map((name) => ({ name, before: was.rows.has(name) ? was.rows.get(name)! : null, after: now.rows.has(name) ? now.rows.get(name)! : null }));
  rows.sort((a, b) => (b.after ?? -1) - (a.after ?? -1) || (b.before ?? 0) - (a.before ?? 0));
  return { rows, beforeTotal: was.total, afterTotal: now.total };
}
