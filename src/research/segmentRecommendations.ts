import type {
  Persona,
  SegmentDataSignal,
  SegmentDimension,
  SegmentRecommendation,
  SegmentTier,
} from "../types";

/**
 * Segment recommendations: programmatic audience building blocks derived from the finished
 * profile's personas.
 *
 * This module is pure and shared by the server (prompt, schema, validation) and the browser
 * (CSV export, planner-added segments). The model call itself lives server-side in
 * src/server/geminiInteractions.ts so no SDK code reaches the client bundle.
 */

export const SEGMENT_DIMENSIONS: readonly SegmentDimension[] = [
  "Demographics",
  "In-Market / Intent",
  "Interest & Affinity",
  "Behavioral",
];

export const SEGMENT_DATA_SIGNALS: readonly SegmentDataSignal[] = [
  "Transaction & Purchase Data",
  "ACR TV Viewership",
  "Household & Life-Stage Records",
  "High-Intent Digital Behavior",
];

export const SEGMENT_TIERS: readonly SegmentTier[] = ["Core", "Expansion", "Experimental"];

export const MIN_AI_SEGMENTS = 8;
export const MAX_AI_SEGMENTS = 14;
/** Hard ceiling including planner-added segments. */
export const MAX_TOTAL_SEGMENTS = 20;
export const MIN_PER_DIMENSION = 2;
export const MAX_PER_DIMENSION = 5;
/** "Suggest more" adds at least this many once the list is already at the AI target. */
const MIN_TOP_UP = 3;

export const MAX_SEGMENT_NAME_LENGTH = 60;
export const MAX_SEGMENT_JUSTIFICATION_LENGTH = 320;
const MAX_SEGMENT_NAME_WORDS = 8;
const MAX_TAXONOMY_LENGTH = 120;
const MAX_PERSONAS = 4;

// --- identity -------------------------------------------------------------------------

/** Case-, spacing- and punctuation-insensitive key, so "In-Market SUVs" and "in market suvs" collide. */
export function segmentKey(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The server pads short persona lists with generic stand-ins. Feeding those to the model
 * would produce segments "for" an archetype nobody researched, so they are left out.
 */
export function isPlaceholderPersona(persona: Pick<Persona, "name"> | null | undefined): boolean {
  return !persona || /^persona archetype \d+$/i.test(String(persona.name || "").trim());
}

const DIMENSION_ALIASES: Record<string, SegmentDimension> = {
  "demographics": "Demographics",
  "demographic": "Demographics",
  "demographic life stage": "Demographics",
  "demographics life stage": "Demographics",
  "life stage": "Demographics",
  "in market intent": "In-Market / Intent",
  "in market": "In-Market / Intent",
  "intent": "In-Market / Intent",
  "interest and affinity": "Interest & Affinity",
  "interest affinity": "Interest & Affinity",
  "interests": "Interest & Affinity",
  "affinity": "Interest & Affinity",
  "behavioral": "Behavioral",
  "behavioural": "Behavioral",
};

export function coerceDimension(value: unknown): SegmentDimension | null {
  return DIMENSION_ALIASES[segmentKey(String(value ?? ""))] ?? null;
}

function coerceEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  const key = segmentKey(String(value ?? ""));
  return allowed.find((option) => segmentKey(option) === key);
}

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

// --- guardrails -----------------------------------------------------------------------

// Mirrors the prompt's privacy policy. The prompt is the first line of defence; this catches
// what slips through, because a sensitive segment on a client deliverable is worse than a
// missing one. Word-bounded so "Motorsports Race Fans" and "Pet Patients" style false hits stay rare.
const SENSITIVE_PATTERNS: RegExp[] = [
  /\b(diagnos\w*|diseases?|disorders?|cancer|diabet\w*|hiv|depress\w*|anxiety|adhd|autism|alzheimer\w*|dementia|obes\w*|chronic (illness|condition|pain)|patients?|prescriptions?|medications?)\b/i,
  /\b(democrat\w*|republican\w*|political\w*|partisan|voters?|conservatives?|liberals?)\b/i,
  /\b(religio\w*|christian\w*|catholic\w*|evangelical\w*|muslims?|islam\w*|jewish|judaism|hindus?|buddhis\w*|churchgoers?|mosque|synagogue)\b/i,
  /\b(racial|ethnic\w*|hispanic|latin[oax]s?|latinx|african[- ]american|asian[- ]american|caucasian)\b/i,
  /\b(lgbt\w*|gay|lesbian|bisexual|transgender|queer|sexual orientation)\b/i,
  /\b(precise|real[- ]time) (geo)?locations?\b/i,
];

export function isSensitiveSegmentText(text: string | undefined): boolean {
  if (!text) return false;
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(text));
}

/** Long names and "who" clauses are the tell of stacked conditions that will not scale. */
export function isOverStackedSegmentName(name: string): boolean {
  const words = name.split(/\s+/).filter(Boolean);
  return words.length > MAX_SEGMENT_NAME_WORDS || /\bwho\b/i.test(name);
}

// --- objective ------------------------------------------------------------------------

export type CampaignObjectiveClass = "performance" | "awareness" | "conquesting" | "full-funnel";

/**
 * Deterministic so the tier mix the prompt asks for is predictable and testable. An explicit
 * full-funnel focus wins over individual KPIs because that is the planner's stated plan shape.
 */
export function classifyCampaignObjective(kpis: string[], campaignFocus: string): CampaignObjectiveClass {
  const focus = String(campaignFocus || "").toLowerCase();
  const text = [...(kpis || []), focus].join(" ").toLowerCase();

  if (/\b(conquest\w*|competitors?|competitive|switchers?)\b/.test(text)) return "conquesting";
  if (/full[- ]?funnel/.test(focus)) return "full-funnel";

  const performance = /\b(conversions?|convert\w*|roas|cpa|sales|purchases?|revenue|leads?|sign[- ]?ups?|installs?|acquisition|tickets?|bookings?|transactions?|foot traffic|store visits?|commerce)\b/.test(text);
  const awareness = /\b(awareness|reach|brand lift|consideration|recall|impressions?|video completion|vcr|frequency)\b/.test(text);

  if (performance && !awareness) return "performance";
  if (awareness && !performance) return "awareness";
  return "full-funnel";
}

const OBJECTIVE_GUIDANCE: Record<CampaignObjectiveClass, string> = {
  "performance":
    "PERFORMANCE / CONVERSION objective. Make about 60-70% of segments Core (verified category purchasers, active in-market shoppers, recent store or dealership visitors), the rest Expansion, and at most 1 Experimental. Weight In-Market / Intent and Behavioral toward the per-dimension ceiling; keep Demographics and Interest & Affinity near the floor.",
  "awareness":
    "AWARENESS / REACH objective. Make about 35-45% of segments Core as broad living-room scale anchors, 40-50% Expansion (lifestyle affinities, streaming and content genres), and 1-2 Experimental. Weight Interest & Affinity and Demographics heavier.",
  "conquesting":
    "COMPETITIVE CONQUESTING objective. Anchor about half the segments as Core on verified competitor-brand buyers and category switchers, about 35% Expansion, and at most 1 Experimental. Weight Behavioral and In-Market / Intent heavier.",
  "full-funnel":
    "FULL-FUNNEL objective. Make about half the segments Core, 35-40% Expansion, and 1 Experimental, spread evenly across all four dimensions.",
};

// --- request --------------------------------------------------------------------------

export interface SegmentRequestPersona {
  name: string;
  age: string;
  gender: string;
  income: string;
  watch: string;
  browse: string;
  buy: string;
  narrative: string;
  sourceType?: string;
}

export interface SegmentGenerationRequest {
  mode: "initial" | "top-up";
  /** Exact number to add in top-up mode; ignored for the initial 8-14 set. */
  count: number;
  advertiserName: string;
  audienceDescription: string;
  url: string;
  geography: string;
  campaignFocus: string;
  kpis: string[];
  /** Index-preserving: `personaIndices` in the response refer to these positions. */
  personas: Array<SegmentRequestPersona | null>;
  profileContext: {
    intro: string;
    executiveSummary: string;
    takeaways: string[];
    recommendations: string[];
  };
  planAudiences: string[];
  /** Segments already on the plan. The model must not repeat them and should fill thin dimensions. */
  existingSegments: Array<{ name: string; dimension: SegmentDimension }>;
  /** Removed this session; never suggested again during it. */
  removedNames: string[];
}

function cleanStringList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanText(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

/** Request bodies are untrusted: every field is capped so a crafted body cannot blow the context. */
export function sanitizeSegmentRequest(body: any): SegmentGenerationRequest {
  const mode = body?.mode === "top-up" ? "top-up" : "initial";
  const rawCount = Math.floor(Number(body?.count));
  const count = Number.isFinite(rawCount) ? Math.min(MAX_AI_SEGMENTS, Math.max(1, rawCount)) : MIN_TOP_UP;

  const personas: Array<SegmentRequestPersona | null> = (Array.isArray(body?.personas) ? body.personas : [])
    .slice(0, MAX_PERSONAS)
    .map((p: any) => {
      if (!p || typeof p !== "object" || isPlaceholderPersona(p)) return null;
      const name = cleanText(p.name, 120);
      if (!name) return null;
      return {
        name,
        age: cleanText(p.age, 60),
        gender: cleanText(p.gender, 60),
        income: cleanText(p.income, 80),
        watch: cleanText(p.watch, 400),
        browse: cleanText(p.browse, 400),
        buy: cleanText(p.buy, 400),
        narrative: cleanText(p.narrative, 900),
        sourceType: cleanText(p.sourceType, 12) || undefined,
      };
    });

  const existingSegments = (Array.isArray(body?.existingSegments) ? body.existingSegments : [])
    .slice(0, MAX_TOTAL_SEGMENTS)
    .map((s: any) => ({ name: cleanText(s?.name, MAX_SEGMENT_NAME_LENGTH), dimension: coerceDimension(s?.dimension) }))
    .filter((s: any): s is { name: string; dimension: SegmentDimension } => Boolean(s.name && s.dimension));

  const context = body?.profileContext || {};
  return {
    mode,
    count,
    advertiserName: cleanText(body?.advertiserName, 200),
    audienceDescription: cleanText(body?.audienceDescription, 1500),
    url: cleanText(body?.url, 500),
    geography: cleanText(body?.geography, 300),
    campaignFocus: cleanText(body?.campaignFocus, 100),
    kpis: cleanStringList(body?.kpis, 10, 300),
    personas,
    profileContext: {
      intro: cleanText(context.intro, 600),
      executiveSummary: cleanText(context.executiveSummary, 2000),
      takeaways: cleanStringList(context.takeaways, 6, 400),
      recommendations: cleanStringList(context.recommendations, 6, 200),
    },
    planAudiences: cleanStringList(body?.planAudiences, 20, 150),
    existingSegments,
    removedNames: cleanStringList(body?.removedNames, 40, MAX_SEGMENT_NAME_LENGTH),
  };
}

/** Audience names listed on the selected uploaded media-plan scenarios. */
export function extractPlanAudiences(selectedPlanOptions: any[] | null | undefined): string[] {
  if (!Array.isArray(selectedPlanOptions) || selectedPlanOptions.length === 0) return [];
  const audienceSet = new Set<string>();
  for (const opt of selectedPlanOptions) {
    if (!Array.isArray(opt?.placements)) continue;
    for (const placement of opt.placements) {
      const trimmed = String(placement?.audience ?? "").trim();
      const lower = trimmed.toLowerCase();
      if (trimmed && lower !== "n/a" && lower !== "none" && lower !== "unspecified") {
        audienceSet.add(trimmed);
      }
    }
  }
  return Array.from(audienceSet);
}

/** How many "Suggest more" should ask for: back up to the AI target, or a few past it, never over the cap. */
export function topUpCount(currentCount: number): number {
  const room = MAX_TOTAL_SEGMENTS - currentCount;
  if (room <= 0) return 0;
  return Math.min(room, Math.max(MAX_AI_SEGMENTS - currentCount, MIN_TOP_UP));
}

// --- prompt ---------------------------------------------------------------------------

const SEGMENT_SYSTEM_INSTRUCTION = `You are a senior audience strategist for programmatic advertising and CTV media buying.

You are given a finished audience profile - its personas and research summary - for one campaign. Your task is to recommend the audience segments a media buyer should activate so the targeting, the personas and the campaign objective work as one cohesive plan.

CRITICAL DIRECTIVE: REAL-WORLD EXECUTABILITY AND DATA PROVENANCE
Every segment must be a commercially available, syndicated programmatic cohort that verified data providers (Experian, Circana, TransUnion, LiveRamp, ACR TV networks and similar) actually compile. Never invent unverifiable "fantasy" micro-behaviors.

1. DATA SIGNALS. Every segment must be collectible through exactly one of these signal types (the 'dataSignal' field):
- "Transaction & Purchase Data": loyalty cards, credit/debit swipes, SKU-level receipts, 30-180 day category spend.
- "ACR TV Viewership": Smart TV automated content recognition of genres, networks, live sports, streaming apps.
- "Household & Life-Stage Records": census-matched demographics, auto registrations, property records, life events.
- "High-Intent Digital Behavior": comparison engines, configurators, quote requests, booking engines.

2. THE 100,000+ HOUSEHOLD SCALE GUARDRAIL.
- Every segment must be a scalable building block of 100,000+ US households.
- Never stack unrelated conditions into one niche. BANNED: "Millennial dog owners who drink kombucha and bought a tent last week". INSTEAD: "In-Market Outdoor Camping Gear" and "Premium Pet Food Buyers" as two segments.
- Names are short catalog-style labels (2-6 words), never sentences, never containing "who".

3. THE FOUR DIMENSIONS. Each segment belongs to exactly one:
- "Demographics": household income tiers, homeownership, presence of children, life-stage events (new movers, new parents, retirees).
- "In-Market / Intent": active consideration in a 30-90 day window - comparison research, quote requests, configurators, price evaluation.
- "Interest & Affinity": long-term passions, content and streaming genres, sports fandom, lifestyle cohorts.
- "Behavioral": verified purchase history, store or dealership visits, brand loyalty, competitive switching.

4. BANNED VS. EXECUTABLE.
- BANNED "People planning to adopt a puppy in the next 30 days" (unverifiable future intent) -> "In-Market Pet Supplies & Food" or "Recent Pet Adopters".
- BANNED "Homeowners who hate cleaning gutters" (untargetable sentiment) -> "Home Improvement Intenders - Roofing & Gutters".
- BANNED "Ford F-150 owners whose lease expires in November 2026" (too narrow) -> "Near-Term Auto Lease Expiration" or "In-Market Full-Size Pickup Trucks".

5. PRIVACY AND SENSITIVE ATTRIBUTES. Never create segments based on medical diagnoses or conditions, political affiliation, race or ethnicity, religion, sexual orientation, or precise real-time geolocation. For health brands use general wellness, fitness or healthy-lifestyle affinities instead of disease states.

6. PERSONA ALIGNMENT. 'personaIndices' lists the zero-based index of every persona the segment serves. Every persona listed must be served by at least 2 segments. A segment may serve several personas.

7. TAXONOMY. 'taxonomyPath' is the closest IAB Tech Lab Audience Taxonomy 1.1 path written as names separated by " > " (for example "Interest > Automotive > Electric Vehicles"). Never output numeric taxonomy IDs.

8. JUSTIFICATION. 'justification' is at most 30 words, written for a media buyer: why this segment fits these personas and this objective, and what data signal makes it reliable. No budget figures.

9. ORDER. Within each dimension list the most important segment first.`;

function formatPersona(persona: SegmentRequestPersona, index: number): string {
  const origin = persona.sourceType === "User"
    ? " (planner-specified)"
    : persona.sourceType === "RFP"
      ? " (from uploaded media plan)"
      : "";
  return [
    `[${index}] ${persona.name}${origin}`,
    `    Age ${persona.age || "n/a"} | Gender ${persona.gender || "n/a"} | HHI ${persona.income || "n/a"}`,
    `    Watches: ${persona.watch || "n/a"}`,
    `    Browses: ${persona.browse || "n/a"}`,
    `    Buys: ${persona.buy || "n/a"}`,
    `    Narrative: ${persona.narrative || "n/a"}`,
  ].join("\n");
}

export function buildSegmentPrompt(request: SegmentGenerationRequest): { systemInstruction: string; input: string } {
  const objective = classifyCampaignObjective(request.kpis, request.campaignFocus);
  const personaBlock = request.personas
    .map((persona, index) => (persona ? formatPersona(persona, index) : null))
    .filter(Boolean)
    .join("\n\n");
  const reserved = [...request.existingSegments.map((s) => s.name), ...request.removedNames];

  const task = request.mode === "initial"
    ? `Recommend between ${MIN_AI_SEGMENTS} and ${MAX_AI_SEGMENTS} segments. Each dimension gets at least ${MIN_PER_DIMENSION} and at most ${MAX_PER_DIMENSION} segments. Use as many as the brief genuinely supports - quality over count.`
    : `The plan already has the segments listed under EXISTING SEGMENTS. Recommend exactly ${request.count} NEW segments that complement them. Favor dimensions with fewer than ${MIN_PER_DIMENSION} existing segments, and never push a dimension past ${MAX_PER_DIMENSION} in total.`;

  const sections = [
    `CAMPAIGN BRIEF
Advertiser: ${request.advertiserName || "Not specified"}
Website: ${request.url || "Not provided"}
Audience description: ${request.audienceDescription || "Not provided"}
Geography: ${request.geography || "United States"}
Campaign focus: ${request.campaignFocus || "Not specified"}
KPIs: ${request.kpis.length > 0 ? request.kpis.join("; ") : "Not specified"}`,
    `OBJECTIVE-ADAPTIVE TIERING ('tier' field)
${OBJECTIVE_GUIDANCE[objective]}
Core = purchase-proximate, highest-confidence anchors. Expansion = adjacent scale. Experimental = one worthwhile test.`,
    `PERSONAS (zero-based index in brackets)
${personaBlock || "No researched personas are available; align segments to the brief and research summary."}`,
    `RESEARCH SUMMARY
Intro: ${request.profileContext.intro || "n/a"}
Executive summary: ${request.profileContext.executiveSummary || "n/a"}
Key takeaways:
${request.profileContext.takeaways.map((t) => `- ${t}`).join("\n") || "- n/a"}
Recommendation themes: ${request.profileContext.recommendations.join("; ") || "n/a"}`,
  ];

  if (request.planAudiences.length > 0) {
    sections.push(`AUDIENCES NAMED IN THE UPLOADED MEDIA PLAN
${request.planAudiences.map((a) => `- ${a}`).join("\n")}
Each of these must be represented by at least one segment. Translate any that are not directly executable into the closest scalable, executable segment, and set 'fromPlanAudience' to the plan audience's exact text. For every other segment set 'fromPlanAudience' to null.`);
  }

  if (request.existingSegments.length > 0) {
    sections.push(`EXISTING SEGMENTS
${request.existingSegments.map((s) => `- ${s.name} [${s.dimension}]`).join("\n")}`);
  }

  if (reserved.length > 0) {
    sections.push(`DO NOT RECOMMEND any of these names or close variants of them:
${reserved.map((name) => `- ${name}`).join("\n")}`);
  }

  sections.push(`TASK
${task}`);

  return { systemInstruction: SEGMENT_SYSTEM_INSTRUCTION, input: sections.join("\n\n") };
}

// --- response schema ------------------------------------------------------------------

/** JSON Schema for the Interactions API `response_format`; bounds are enforced again in normalizeSegments. */
export function buildSegmentResponseSchema(minItems: number, maxItems: number, personaCount: number) {
  return {
    type: "object",
    properties: {
      segments: {
        type: "array",
        minItems,
        maxItems,
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Short catalog-style segment label, 2-6 words." },
            dimension: { type: "string", enum: [...SEGMENT_DIMENSIONS] },
            justification: { type: "string", description: "At most 30 words for a media buyer." },
            taxonomyPath: { type: "string", description: "IAB Audience Taxonomy 1.1 path as names joined by ' > '. No numeric IDs." },
            dataSignal: { type: "string", enum: [...SEGMENT_DATA_SIGNALS] },
            tier: { type: "string", enum: [...SEGMENT_TIERS] },
            personaIndices: {
              type: "array",
              items: { type: "integer", minimum: 0, maximum: Math.max(0, personaCount - 1) },
            },
            fromPlanAudience: {
              type: ["string", "null"],
              description: "Exact uploaded-plan audience this segment translates, otherwise null.",
            },
          },
          required: ["name", "dimension", "justification", "taxonomyPath", "dataSignal", "tier", "personaIndices", "fromPlanAudience"],
        },
      },
    },
    required: ["segments"],
  };
}

// --- normalization --------------------------------------------------------------------

export interface NormalizeSegmentsOptions {
  /** Persona positions that hold a real, researched persona. Anything else is dropped from personaIndices. */
  usablePersonaIndices: number[];
  /** Names already on the plan or removed this session. */
  reservedNames: string[];
  /** Dimensions of segments already on the plan, counted against the per-dimension ceiling. */
  existingDimensions: SegmentDimension[];
  planAudiences: string[];
  maxCount: number;
}

const TIER_RANK: Record<SegmentTier, number> = { Core: 0, Expansion: 1, Experimental: 2 };

/**
 * Turns raw model output into segments that are safe to render and save. The schema already
 * constrains shape, but the docs are explicit that values still need validating, and a
 * duplicate, sensitive or over-stacked segment is a defect on a client-facing plan.
 */
export function normalizeSegments(raw: unknown, options: NormalizeSegmentsOptions): SegmentRecommendation[] {
  const items: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as any)?.segments)
      ? (raw as any).segments
      : [];

  const usable = new Set(options.usablePersonaIndices);
  const seen = new Set(options.reservedNames.map(segmentKey).filter(Boolean));
  const planKeys = new Set(options.planAudiences.map(segmentKey).filter(Boolean));
  const candidates: SegmentRecommendation[] = [];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;

    const name = cleanText(entry.name, MAX_SEGMENT_NAME_LENGTH);
    const dimension = coerceDimension(entry.dimension);
    const key = segmentKey(name);
    if (!name || !key || !dimension || seen.has(key)) continue;

    const taxonomyPath = cleanText(entry.taxonomyPath, MAX_TAXONOMY_LENGTH) || undefined;
    if (isOverStackedSegmentName(name) || isSensitiveSegmentText(name) || isSensitiveSegmentText(taxonomyPath)) continue;

    const personaIndices = Array.from(new Set(
      (Array.isArray(entry.personaIndices) ? entry.personaIndices : [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && usable.has(value)),
    )).sort((a, b) => a - b);

    const fromPlan = typeof entry.fromPlanAudience === "string" ? segmentKey(entry.fromPlanAudience) : "";

    seen.add(key);
    candidates.push({
      id: `seg-${key.replace(/ /g, "-")}`,
      name,
      dimension,
      justification: cleanText(entry.justification, MAX_SEGMENT_JUSTIFICATION_LENGTH),
      taxonomyPath,
      dataSignal: coerceEnum(entry.dataSignal, SEGMENT_DATA_SIGNALS),
      tier: coerceEnum(entry.tier, SEGMENT_TIERS),
      personaIndices,
      source: fromPlan && planKeys.has(fromPlan) ? "RFP" : "ScoutAI",
    });
  }

  // Stable tier sort before trimming, so the ceiling and the count cap drop Experimental
  // segments first and never a Core anchor.
  const ranked = candidates
    .map((segment, order) => ({ segment, order }))
    .sort((a, b) =>
      (TIER_RANK[a.segment.tier ?? "Expansion"] - TIER_RANK[b.segment.tier ?? "Expansion"]) || a.order - b.order,
    );

  const perDimension = new Map<SegmentDimension, number>();
  for (const dimension of options.existingDimensions) {
    perDimension.set(dimension, (perDimension.get(dimension) ?? 0) + 1);
  }

  const kept: Array<{ segment: SegmentRecommendation; order: number }> = [];
  for (const entry of ranked) {
    if (kept.length >= options.maxCount) break;
    const used = perDimension.get(entry.segment.dimension) ?? 0;
    if (used >= MAX_PER_DIMENSION) continue;
    perDimension.set(entry.segment.dimension, used + 1);
    kept.push(entry);
  }

  return kept.sort((a, b) => a.order - b.order).map((entry) => entry.segment);
}

/** Grouped by dimension in legend order, then by tier, preserving model order within ties. */
export function orderSegmentsForDisplay(segments: SegmentRecommendation[]): SegmentRecommendation[] {
  return segments
    .map((segment, order) => ({ segment, order }))
    .sort((a, b) =>
      (SEGMENT_DIMENSIONS.indexOf(a.segment.dimension) - SEGMENT_DIMENSIONS.indexOf(b.segment.dimension)) ||
      (TIER_RANK[a.segment.tier ?? "Expansion"] - TIER_RANK[b.segment.tier ?? "Expansion"]) ||
      a.order - b.order,
    )
    .map((entry) => entry.segment);
}

// --- planner-added segments -----------------------------------------------------------

export type UserSegmentResult = { segment: SegmentRecommendation; error?: undefined } | { segment?: undefined; error: string };

/**
 * Planner-added segments skip the sensitive-term filter on purpose: the planner owns that
 * call, and blocking a deliberate choice would only push it off-platform.
 */
export function createUserSegment(
  input: { name: string; dimension: string; justification?: string },
  existing: SegmentRecommendation[],
): UserSegmentResult {
  const name = cleanText(input.name, MAX_SEGMENT_NAME_LENGTH);
  if (!name) return { error: "Enter a segment name." };
  const dimension = coerceDimension(input.dimension);
  if (!dimension) return { error: "Choose a dimension." };
  if (existing.length >= MAX_TOTAL_SEGMENTS) return { error: `A plan can hold up to ${MAX_TOTAL_SEGMENTS} segments.` };
  const key = segmentKey(name);
  if (existing.some((segment) => segmentKey(segment.name) === key)) return { error: "That segment is already on the plan." };

  return {
    segment: {
      id: `user-${key.replace(/ /g, "-")}`,
      name,
      dimension,
      justification: cleanText(input.justification, MAX_SEGMENT_JUSTIFICATION_LENGTH),
      personaIndices: [],
      source: "User",
    },
  };
}

// --- auto-save baseline ---------------------------------------------------------------

/**
 * Fingerprint of everything in a profile except its segments and headshots. Segment auto-save
 * only runs while this matches the saved plan, so a regenerated profile is never written over
 * a saved one just because its segments arrived.
 */
export function profileBaselineFingerprint(profile: Record<string, any> | null | undefined): string {
  if (!profile) return "";
  const { segmentRecommendations: _segments, personas, channelStrategy, hiddenSections: _hiddenSections, slideExports: _slideExports, ...rest } = profile;
  const personaCore = Array.isArray(personas)
    ? personas.map((p: any) => {
      const { avatarUrl: _avatar, avatarHistory: _history, ...core } = p || {};
      return core;
    })
    : personas;
  // If channelStrategy exists, strip channelOverrides from baseline check so overrides auto-save seamlessly
  let cleanChannelStrategy = channelStrategy;
  if (channelStrategy && typeof channelStrategy === "object") {
    const { channelOverrides: _overrides, ...csRest } = channelStrategy;
    cleanChannelStrategy = csRest;
  }
  return JSON.stringify({ ...rest, personas: personaCore, channelStrategy: cleanChannelStrategy });
}

// --- CSV export -----------------------------------------------------------------------

const SOURCE_LABELS: Record<SegmentRecommendation["source"], string> = {
  ScoutAI: "ScoutAI",
  RFP: "Media Plan",
  User: "Planner",
};

/**
 * RFC 4180 quoting, plus a leading apostrophe on anything a spreadsheet would evaluate as a
 * formula: segment text originates from a model and from free-text input.
 */
export function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function segmentsToCsv(segments: SegmentRecommendation[], personas: Array<Pick<Persona, "name">>): string {
  const header = ["Segment", "Dimension", "Justification", "IAB Taxonomy Path", "Data Signal", "Tier", "Personas Served", "Source"];
  const rows = orderSegmentsForDisplay(segments).map((segment) => [
    segment.name,
    segment.dimension,
    segment.justification,
    segment.taxonomyPath ?? "",
    segment.dataSignal ?? "",
    segment.tier ?? "",
    segment.personaIndices.map((index) => personas[index]?.name).filter(Boolean).join("; "),
    SOURCE_LABELS[segment.source],
  ]);
  // BOM so Excel opens the file as UTF-8 instead of mangling curly quotes and dashes.
  return "﻿" + [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
