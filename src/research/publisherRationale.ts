import { formatBriefOfRecord, normalizeBriefOfRecord } from "./briefOfRecord";
import { publisherKey, type PoolPublisher } from "../qa/publisherSelection";
import { isStockPublisherNote } from "../types";

/**
 * The 'why' for a CTV publisher a planner added by hand. Synthesis writes one for every publisher
 * it picks; a planner's addition had none, so the plan and its share link showed a bare logo next
 * to cards that explained themselves.
 *
 * Pure and shared: the server builds the prompt and checks the answer; the browser decides which
 * publishers still need one. The model call lives in server.ts.
 */

export const MAX_RATIONALE_PUBLISHERS = 30;
const MAX_WHY_CHARS = 320;

export interface RationalePublisher {
  publisher: string;
  category: string;
  /** The admin's targeting note from Settings, e.g. "Include for Female Focused Audience". */
  note: string;
}

export interface PublisherRationaleRequest {
  audience: string;
  personas: string[];
  examples: string[];
  publishers: RationalePublisher[];
}

/** Publishers with nothing to show: no 'why', or only the catalog's stock targeting note. */
export function publishersNeedingRationale<T extends { publisher: string; why?: string }>(publishers: T[]): T[] {
  return publishers.filter((pub) => pub?.publisher && (!pub.why?.trim() || isStockPublisherNote(pub.why)));
}

const clip = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * The plan's audience as the browser sends it, for any justification written from it (publishers
 * here, segments in ./segmentRationale). Empty audience when the plan describes none.
 */
export function rationaleAudience(body: any): { audience: string; personas: string[] } {
  const brief = normalizeBriefOfRecord(body?.briefOfRecord, body?.briefOfRecord?.basis);
  // Plans made before the brief of record have only the intro to describe their audience.
  const audience = brief ? formatBriefOfRecord(brief) : clip(body?.intro, 1500);
  const personas = (Array.isArray(body?.personas) ? body.personas : []).slice(0, 6).map((p: any) => {
    const head = [clip(p?.name, 100), clip(p?.age, 40), clip(p?.gender, 60)].filter(Boolean).join(", ");
    const watch = clip(p?.watch, 300);
    const buy = clip(p?.buy, 300);
    return head ? `${head}${watch ? ` - watches: ${watch}` : ""}${buy ? ` - buys: ${buy}` : ""}` : "";
  }).filter(Boolean);
  return { audience, personas };
}

/**
 * The browser sends the plan's audience and the publishers to explain. Targeting notes come from
 * the server's own publisher list, never the request. Null when there is nothing to write.
 */
export function sanitizePublisherRationaleRequest(body: any, pool: Array<PoolPublisher & { notes?: string }>): PublisherRationaleRequest | null {
  const { audience, personas } = rationaleAudience(body);
  const byKey = new Map(pool.filter((p) => p?.name).map((p) => [publisherKey(p.name), p]));
  const seen = new Set<string>();
  const publishers: RationalePublisher[] = [];
  for (const raw of Array.isArray(body?.publishers) ? body.publishers : []) {
    const name = clip(raw?.publisher, 80);
    const key = publisherKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const record = byKey.get(key);
    publishers.push({
      publisher: record?.name || name,
      category: clip(record?.category || raw?.category, 20) || "App",
      note: clip(record?.notes, 200),
    });
    if (publishers.length >= MAX_RATIONALE_PUBLISHERS) break;
  }
  if (!audience || publishers.length === 0) return null;
  const examples = (Array.isArray(body?.examples) ? body.examples : [])
    .map((why: unknown) => clip(why, MAX_WHY_CHARS))
    .filter((why: string) => why && !isStockPublisherNote(why))
    .slice(0, 3);
  return { audience, personas, examples, publishers };
}

export const PUBLISHER_RATIONALE_SYSTEM_INSTRUCTION = `You are a senior CTV media planner. Write the justification shown under each CTV publisher in a client-facing media plan: why that publisher's programming, viewers or platform fit this campaign's audience.

Rules:
1. One or two sentences per publisher, under 45 words. Specific to this audience and this publisher's content; no filler such as "a great choice".
2. No statistics, percentages, audience sizes or rankings. Nothing in this request supports a number.
3. Never mention tiers, internal targeting notes, or who chose the publisher. Write it as a recommendation, like the examples.
4. Describe what the publisher actually programs and who actually watches it. When it is not an obvious match for the audience, say what role it plays (incremental reach, a co-viewing household, a content moment) instead of claiming the audience watches it.
5. If you do not recognise a publisher, write only about how its category (App, Network or OS) reaches this audience. Never invent its programming.
6. Return every publisher you were given, with its name exactly as written and nothing added to it.`;

export function buildPublisherRationaleInput(request: PublisherRationaleRequest): string {
  return [
    request.audience,
    request.personas.length > 0 ? `PERSONAS:\n${request.personas.map((p) => `- ${p}`).join("\n")}` : "",
    request.examples.length > 0 ? `EXAMPLES OF JUSTIFICATIONS ALREADY IN THIS PLAN (match their tone and length):\n${request.examples.map((e) => `- ${e}`).join("\n")}` : "",
    `PUBLISHERS TO JUSTIFY:\n${request.publishers.map((p) => `- "${p.publisher}" - category: ${p.category}${p.note ? `; internal targeting note, do not quote: ${p.note}` : ""}`).join("\n")}`,
  ].filter(Boolean).join("\n\n");
}

export const publisherRationaleSchema = {
  type: "object",
  properties: {
    publishers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          publisher: { type: "string", description: "The publisher name exactly as given." },
          why: { type: "string", description: "One or two sentences, under 45 words." },
        },
        required: ["publisher", "why"],
      },
    },
  },
  required: ["publishers"],
};

/** Drops sentences that break a rule the client must never see broken (tiers, statistics). */
export function scrubRationale(why: string, maxChars = MAX_WHY_CHARS): string {
  const sentences = why.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]*/g) || [];
  const kept = sentences.map((s) => s.trim()).filter((s) => s && !/\btiers?\b/i.test(s) && !/%|\bpercent\b/i.test(s));
  let text = "";
  for (const sentence of kept) {
    if ((text ? `${text} ${sentence}` : sentence).length > maxChars) break;
    text = text ? `${text} ${sentence}` : sentence;
  }
  return text;
}

/** The model's answers for the requested publishers only, keyed by the requested name. */
export function normalizePublisherRationale(raw: unknown, requested: RationalePublisher[]): Array<{ publisher: string; why: string }> {
  const answers = Array.isArray((raw as any)?.publishers) ? (raw as any).publishers : [];
  const whyByKey = new Map<string, string>();
  for (const answer of answers) {
    // The model sometimes echoes the category it was shown: "AMC Networks (Network)".
    const key = publisherKey(String(answer?.publisher ?? "").replace(/\s*\([^)]*\)\s*$/, ""));
    const why = typeof answer?.why === "string" ? scrubRationale(answer.why) : "";
    if (key && why.length >= 20 && !whyByKey.has(key)) whyByKey.set(key, why);
  }
  return requested.flatMap((pub) => {
    const why = whyByKey.get(publisherKey(pub.publisher));
    return why ? [{ publisher: pub.publisher, why }] : [];
  });
}
