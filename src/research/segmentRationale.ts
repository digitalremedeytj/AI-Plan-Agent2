import type { SegmentRecommendation } from "../types";
import { rationaleAudience, scrubRationale } from "./publisherRationale";
import { MAX_SEGMENT_JUSTIFICATION_LENGTH, segmentKey } from "./segmentRecommendations";

/**
 * The justification for an audience segment a planner added without one. Its card read "Added by
 * planner." - on the share link too - beside segments that explain themselves. Same shape as
 * ./publisherRationale: the server writes the text, the browser merges it and auto-save keeps it.
 */

export const MAX_RATIONALE_SEGMENTS = 20;

export interface RationaleSegment {
  id: string;
  name: string;
  dimension: string;
}

export interface SegmentRationaleRequest {
  audience: string;
  personas: string[];
  examples: string[];
  segments: RationaleSegment[];
}

/** Segments a planner added that have no justification yet. */
export function segmentsNeedingRationale<T extends Pick<SegmentRecommendation, "source" | "justification">>(segments: T[]): T[] {
  return segments.filter((segment) => segment?.source === "User" && !segment.justification?.trim());
}

const clip = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

export function sanitizeSegmentRationaleRequest(body: any): SegmentRationaleRequest | null {
  const { audience, personas } = rationaleAudience(body);
  const seen = new Set<string>();
  const segments: RationaleSegment[] = [];
  for (const raw of Array.isArray(body?.segments) ? body.segments : []) {
    const id = clip(raw?.id, 120);
    const name = clip(raw?.name, 120);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    segments.push({ id, name, dimension: clip(raw?.dimension, 60) });
    if (segments.length >= MAX_RATIONALE_SEGMENTS) break;
  }
  if (!audience || segments.length === 0) return null;
  const examples = (Array.isArray(body?.examples) ? body.examples : [])
    .map((text: unknown) => clip(text, MAX_SEGMENT_JUSTIFICATION_LENGTH))
    .filter(Boolean)
    .slice(0, 3);
  return { audience, personas, examples, segments };
}

export const SEGMENT_RATIONALE_SYSTEM_INSTRUCTION = `You are a senior programmatic audience planner. Write the justification shown under each audience segment in a client-facing media plan: why targeting that segment reaches this campaign's audience and serves its objective.

Rules:
1. One sentence (two at most), under 40 words, written for a media buyer. Specific to this audience and to what the segment's data identifies; no filler.
2. No statistics, percentages, audience sizes or match rates. Nothing in this request supports a number.
3. Never name a data provider, and never say who added the segment. Write it as a recommendation, like the examples.
4. When the segment is a loose fit for the audience, say what role it plays (prospecting, a lookalike pool, an adjacent life stage) instead of overstating the fit.
5. Return every segment you were given, with its id exactly as written.`;

export function buildSegmentRationaleInput(request: SegmentRationaleRequest): string {
  return [
    request.audience,
    request.personas.length > 0 ? `PERSONAS:\n${request.personas.map((p) => `- ${p}`).join("\n")}` : "",
    request.examples.length > 0 ? `EXAMPLES OF JUSTIFICATIONS ALREADY IN THIS PLAN (match their tone and length):\n${request.examples.map((e) => `- ${e}`).join("\n")}` : "",
    `SEGMENTS TO JUSTIFY:\n${request.segments.map((s) => `- id "${s.id}": ${s.name}${s.dimension ? ` (${s.dimension})` : ""}`).join("\n")}`,
  ].filter(Boolean).join("\n\n");
}

export const segmentRationaleSchema = {
  type: "object",
  properties: {
    segments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "The segment id exactly as given." },
          justification: { type: "string", description: "One sentence, under 40 words." },
        },
        required: ["id", "justification"],
      },
    },
  },
  required: ["segments"],
};

/** The model's answers for the requested segments only. Matched by id, or by name if the id came back altered. */
export function normalizeSegmentRationale(raw: unknown, requested: RationaleSegment[]): Array<{ id: string; justification: string }> {
  const answers = Array.isArray((raw as any)?.segments) ? (raw as any).segments : [];
  const byId = new Map(requested.map((s) => [s.id, s]));
  const byName = new Map(requested.map((s) => [segmentKey(s.name), s]));
  const out = new Map<string, string>();
  for (const answer of answers) {
    const id = clip(answer?.id, 120).replace(/^id\s+/i, "").replace(/^"|"$/g, "");
    const target = byId.get(id) ?? byName.get(segmentKey(id));
    const justification = typeof answer?.justification === "string" ? scrubRationale(answer.justification, MAX_SEGMENT_JUSTIFICATION_LENGTH) : "";
    if (target && justification.length >= 20 && !out.has(target.id)) out.set(target.id, justification);
  }
  return requested.flatMap((s) => (out.has(s.id) ? [{ id: s.id, justification: out.get(s.id)! }] : []));
}
