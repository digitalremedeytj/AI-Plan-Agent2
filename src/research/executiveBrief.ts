// The executive brief: the one-screen overview at the end of a plan, written after the plan is
// delivered and rewritten on demand. It replaces the single executiveSummary paragraph, which
// was drafted mid-run (before the channel plan existed) and could never catch up with a
// planner's edits.
//
// Two rules shape this module:
// 1. It is written from the plan AS THE PLANNER SEES IT: channel field edits, removed or forced
//    channels, and sections hidden from the share link. buildBriefSnapshot is that view, and its
//    fingerprint is how the UI knows the brief has gone out of date.
// 2. Facts come from the plan, words come from the model. Channel names, allocations and
//    measurement products are filled in from the snapshot; the model only writes the
//    connective sentences, and anything it says about a channel or study the plan does not
//    carry is removed before the planner sees it.
//
// Shared by the server (prompt, normalization) and the client (snapshot, fingerprint, editing).

import type { AudienceProfile, ChannelPanelOverride } from "../types";

// --- types ------------------------------------------------------------------------------

export const BRIEF_SECTION_KEYS = ["understanding", "strategicPov", "audience", "media", "measurement"] as const;
export type BriefSectionKey = (typeof BRIEF_SECTION_KEYS)[number];

export const BRIEF_SECTION_LABELS: Record<BriefSectionKey, { title: string; subtitle: string }> = {
  understanding: { title: "Our Understanding", subtitle: "What we're solving for" },
  strategicPov: { title: "Our Strategic POV", subtitle: "Why we believe this will work" },
  audience: { title: "Audience Strategy", subtitle: "Who we're reaching and how" },
  media: { title: "Media Strategy", subtitle: "The role each channel plays" },
  measurement: { title: "Measurement Strategy", subtitle: "How we'll prove business impact" },
};

export const FUNNEL_ROLES = ["Awareness", "Consideration", "Conversion", "Full funnel"] as const;
export type FunnelRole = (typeof FUNNEL_ROLES)[number];

export interface BriefBullet {
  /** A few bold words that carry the point. */
  lead: string;
  text: string;
}

export interface BriefChannelRole {
  channelId: string;
  channelName: string;
  /** From the plan when the brief was written. The UI shows the live allocation where it can. */
  allocationPercent: number;
  funnelRole: FunnelRole;
  role: string;
}

export interface BriefAudienceMatch {
  /** A core segment from the brief of record, or a persona. */
  audience: string;
  /** Segment, targeting tactic or publisher names from the plan. */
  reachedWith: string[];
  why: string;
}

export interface BriefMeasurementItem {
  capability: string;
  /** Incrementality, halo or consumer-journey measurement: the studies that prove business impact. */
  advanced: boolean;
  proves: string;
  kpi: string;
}

export interface BriefSection {
  key: BriefSectionKey;
  headline: string;
  bullets: BriefBullet[];
  channels?: BriefChannelRole[];
  audienceMatches?: BriefAudienceMatch[];
  measurement?: BriefMeasurementItem[];
}

export interface BriefSectionEdit {
  title?: string;
  content?: string;
}

export interface ExecutiveBrief {
  version: 1;
  generatedAt: string;
  /** briefFingerprint of the snapshot this was written from; a mismatch means the plan changed since. */
  inputFingerprint: string;
  instructions?: string;
  model?: string;
  sections: BriefSection[];
  /** For the planner only (never in the share view): lines removed, figures to check, instructions not followed. */
  plannerNotes: string[];
  /** Hand edits per section, the same shape the channel details use. */
  edits?: Partial<Record<BriefSectionKey, BriefSectionEdit>>;
  /** Sections hidden from the share link. */
  hiddenPanels?: BriefSectionKey[];
  /** The version this one replaced, so a regenerate can be undone. One level deep. */
  previous?: ExecutiveBrief;
}

// --- the plan as the planner sees it -----------------------------------------------------

export interface BriefPlanInputs {
  advertiserName?: string;
  url?: string;
  geography?: string;
  campaignFocus?: string;
  kpis?: string[];
}

export interface BriefSnapshotChannel {
  channelId: string;
  name: string;
  status: string;
  allocationPercent: number;
  role: string;
  gapAddressed: string;
  rationale: string;
  activation: string;
  targeting: string[];
  publishers: string[];
  measurementApproach: string;
  measurement: string[];
}

export interface BriefSnapshotMeasurement {
  name: string;
  advanced: boolean;
  channels: string[];
  rationale: string;
}

export interface BriefSnapshot {
  /** What the planner typed into the brief form. Left out of the fingerprint: it can change without the plan changing. */
  campaign: {
    advertiser: string;
    url: string;
    geography: string;
    campaignFocus: string;
    kpis: string[];
  };
  plan: {
    workingMediaBudget: number;
    flightDays: number | null;
    planningMode: string;
  };
  brief: {
    whatTheySell: string;
    businessModel: string;
    primaryAudience: string;
    coreSegments: string[];
    includedSegments: string[];
    excludedSegments: string[];
    campaignObjective: string;
    funnelEmphasis: string;
    priceTier: string;
    audienceType: string;
  } | null;
  intro: string;
  audienceAnalysis: string;
  takeaways: string[];
  recommendations: Array<{ title: string; action: string; channels: string }>;
  personas: Array<{ name: string; age: string; gender: string; income: string; narrative: string }>;
  segments: Array<{ name: string; dimension: string; dataSignal: string; tier: string; source: string; justification: string; personas: string[] }>;
  channels: BriefSnapshotChannel[];
  measurement: BriefSnapshotMeasurement[];
  nonMediaItems: string[];
  ctvPublishers: string[];
  /** Media types that were evaluated but are not in the plan. The brief must not present them as part of it. */
  notInPlanChannels: string[];
}

const ADVANCED_MEASUREMENT: Array<{ label: string; pattern: RegExp }> = [
  { label: "Incrementality", pattern: /\bincrementality\b|\bincremental(ity)? (lift|study|test)\b/i },
  { label: "Halo effect", pattern: /\bhalo\b/i },
  { label: "Consumer journey", pattern: /\bconsumer journey\b|\bjourney analytics\b/i },
  { label: "Consumer journey", pattern: /\bOPA\b/ },
];

/**
 * Studies whose names can only appear in the brief when the plan carries them. Narrower than
 * ADVANCED_MEASUREMENT: "the full consumer journey" is a fair description of what LeadMatch
 * tracks, so only the product-style names are guarded.
 */
const GUARDED_MEASUREMENT: Array<{ label: string; pattern: RegExp }> = [
  { label: "Incrementality", pattern: /\bincrementality\b|\bincremental(ity)? (lift|study|test)\b/i },
  { label: "Halo effect", pattern: /\bhalo\b/i },
  { label: "Consumer journey analytics", pattern: /\bconsumer journey (analytics|study|measurement)\b|\bjourney analytics\b/i },
  { label: "Consumer journey analytics", pattern: /\bOPA\b/ },
  { label: "Brand lift", pattern: /\bbrand lift\b/i },
  { label: "Foot traffic", pattern: /\bfoot traffic\b|\bstore visit (study|attribution|lift)\b/i },
  { label: "Sales lift", pattern: /\bsales lift\b/i },
  { label: "Matchback", pattern: /\bmatch ?back\b/i },
];

const MEASUREMENT_LINE_ITEM = /measure|lift|incremental|halo|attribution|journey|study|matchback|foot traffic/i;

export const isAdvancedMeasurement = (name: string) => ADVANCED_MEASUREMENT.some(({ pattern }) => pattern.test(name));

const clip = (value: unknown, max: number): string => {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

const clipList = (value: unknown, maxItems: number, maxLength: number): string[] =>
  (Array.isArray(value) ? value : []).map((item) => clip(item, maxLength)).filter(Boolean).slice(0, maxItems);

/** An edited panel's text as a list, the way the channel details store it (comma or line separated). */
const editedList = (content: string): string[] =>
  content.split(/\n|,(?![^()]*\))/).map((part) => part.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);

function channelField(override: ChannelPanelOverride | undefined, key: string, fallback: string): string | null {
  if (override?.hiddenPanels?.includes(key)) return null;
  const edited = override?.fieldEdits?.[key]?.content;
  return edited !== undefined ? edited : fallback;
}

function channelList(override: ChannelPanelOverride | undefined, key: string, records: Array<{ displayName: string }> | undefined): string[] {
  if (override?.hiddenPanels?.includes(key)) return [];
  const edited = override?.fieldEdits?.[key]?.content;
  if (edited !== undefined) return editedList(edited);
  return (records || []).map((record) => record.displayName).filter(Boolean);
}

/**
 * The plan exactly as the planner sees it, trimmed to what an executive summary needs. Sections
 * hidden from the share link are left out, because the brief is client-facing and must not
 * summarise what the planner chose not to show.
 */
export function buildBriefSnapshot(profile: AudienceProfile | null | undefined, inputs: BriefPlanInputs = {}): BriefSnapshot {
  const p: any = profile || {};
  const hidden = new Set<string>(Array.isArray(p.hiddenSections) ? p.hiddenSections : []);
  const strategy = p.channelStrategy || {};
  const mediaPlan = strategy.mediaPlan || {};
  const overrides: Record<string, ChannelPanelOverride> = strategy.channelOverrides || {};
  const candidates: any[] = Array.isArray(mediaPlan.evaluatedCandidates) ? mediaPlan.evaluatedCandidates : [];
  const planChannels: any[] = Array.isArray(mediaPlan.channels) ? mediaPlan.channels : [];

  const channels: BriefSnapshotChannel[] = planChannels.map((channel) => {
    const override = overrides[channel.channelId];
    const candidate = candidates.find((c) => c?.product?.id === channel.channelId);
    return {
      channelId: String(channel.channelId || ""),
      name: clip(channel.channelName, 80),
      status: clip(channel.status, 10),
      allocationPercent: Math.round((Number(channel.allocationPercent) || 0) * 10) / 10,
      role: clip(channel.role, 200),
      gapAddressed: clip(channelField(override, "gapAddressed", channel.gapAddressed || ""), 400),
      rationale: clip(channelField(override, "planningRationale", channel.allocationRationale || ""), 400),
      activation: clip(channelField(override, "activationGuidance", candidate?.activationGuidance || ""), 400),
      targeting: channelList(override, "targetingTactics", channel.targetingTactics).map((t) => clip(t, 100)).slice(0, 10),
      publishers: channelList(override, "publishers", channel.publishers).map((t) => clip(t, 80)).slice(0, 10),
      measurementApproach: clip(channelField(override, "measurementApproach", candidate?.measurementApproach || ""), 400),
      measurement: channelList(override, "measurementCapabilities", channel.measurementCapabilities).map((t) => clip(t, 100)).slice(0, 8),
    };
  }).filter((channel) => channel.channelId && channel.name);

  // Measurement across the plan: what each channel carries, plus measurement line items from an
  // uploaded plan. Keyed by name, since an edited panel keeps names but not record ids.
  const measurementByName = new Map<string, BriefSnapshotMeasurement>();
  for (const channel of channels) {
    const records: any[] = planChannels.find((c) => c.channelId === channel.channelId)?.measurementCapabilities || [];
    for (const name of channel.measurement) {
      const key = name.toLowerCase();
      const entry = measurementByName.get(key) || { name, advanced: isAdvancedMeasurement(name), channels: [], rationale: "" };
      if (!entry.channels.includes(channel.name)) entry.channels.push(channel.name);
      if (!entry.rationale) entry.rationale = clip(records.find((r) => String(r?.displayName || "").toLowerCase() === key)?.rationale, 300);
      measurementByName.set(key, entry);
    }
  }
  const nonMediaItems: string[] = (Array.isArray(mediaPlan.nonMediaCosts) ? mediaPlan.nonMediaCosts : [])
    .map((item: any) => clip(item?.displayName, 100)).filter(Boolean).slice(0, 12);
  for (const name of nonMediaItems) {
    if (!MEASUREMENT_LINE_ITEM.test(name) || measurementByName.has(name.toLowerCase())) continue;
    measurementByName.set(name.toLowerCase(), { name, advanced: isAdvancedMeasurement(name), channels: [], rationale: "Included as a line item in the uploaded media plan." });
  }
  const measurement = Array.from(measurementByName.values())
    .sort((a, b) => Number(b.advanced) - Number(a.advanced) || b.channels.length - a.channels.length)
    .slice(0, 10);

  const planIds = new Set(channels.map((c) => c.channelId));
  const notInPlanChannels = Array.from(new Set(candidates
    .filter((c) => c?.product?.id && !planIds.has(c.product.id))
    .map((c) => clip(c.product.displayName, 80))
    .filter(Boolean)));

  const personas = hidden.has("personas") ? [] : (Array.isArray(p.personas) ? p.personas : [])
    .filter((persona: any) => persona?.name)
    .slice(0, 8)
    .map((persona: any) => ({
      name: clip(persona.name, 80),
      age: clip(persona.age, 40),
      gender: clip(persona.gender, 40),
      income: clip(persona.income, 60),
      narrative: clip(persona.narrative, 350),
    }));
  const personaNames: string[] = (Array.isArray(p.personas) ? p.personas : []).map((persona: any) => clip(persona?.name, 80));

  const segments = hidden.has("segments") ? [] : (Array.isArray(p.segmentRecommendations) ? p.segmentRecommendations : [])
    .filter((s: any) => s?.name)
    .slice(0, 24)
    .map((s: any) => ({
      name: clip(s.name, 80),
      dimension: clip(s.dimension, 40),
      dataSignal: clip(s.dataSignal, 60),
      tier: clip(s.tier, 20),
      source: s.source === "RFP" ? "Media plan" : s.source === "User" ? "Planner" : "ScoutAI",
      justification: clip(s.justification, 220),
      personas: hidden.has("personas") ? [] : (Array.isArray(s.personaIndices) ? s.personaIndices : [])
        .map((i: number) => personaNames[i]).filter(Boolean),
    }));

  const bor = p.briefOfRecord;
  const ctvSource: any[] = Array.isArray(p.ctvPublishers) && p.ctvPublishers.length ? p.ctvPublishers : (Array.isArray(strategy.ctvPublishers) ? strategy.ctvPublishers : []);

  return {
    campaign: {
      advertiser: clip(inputs.advertiserName || bor?.advertiser, 120),
      url: clip(inputs.url, 200),
      geography: clip(inputs.geography || bor?.geography, 200),
      campaignFocus: clip(inputs.campaignFocus, 80),
      kpis: clipList((inputs.kpis || []).filter((k) => k && k.trim()), 8, 120),
    },
    plan: {
      workingMediaBudget: Number(mediaPlan.workingMediaBudget) || 0,
      flightDays: Number(mediaPlan.flightDays) || null,
      planningMode: clip(mediaPlan.planningMode, 20),
    },
    brief: bor ? {
      whatTheySell: clip(bor.whatTheySell, 300),
      businessModel: clip(bor.businessModel, 300),
      primaryAudience: clip(bor.primaryAudience, 300),
      coreSegments: clipList(bor.coreSegments, 6, 120),
      includedSegments: clipList(bor.includedSegments, 10, 120),
      excludedSegments: clipList(bor.excludedSegments, 8, 120),
      campaignObjective: clip(bor.campaignObjective, 300),
      funnelEmphasis: clip(bor.funnelEmphasis, 20),
      priceTier: clip(bor.priceTier, 20),
      audienceType: clip(bor.audienceType, 10),
    } : null,
    intro: hidden.has("intro") ? "" : clip(p.intro, 400),
    audienceAnalysis: hidden.has("intro") ? "" : clip(p.audienceAnalysis, 900),
    takeaways: hidden.has("insights") ? [] : clipList(p.takeaways, 6, 300),
    recommendations: hidden.has("insights") ? [] : (Array.isArray(p.recommendations) ? p.recommendations : []).slice(0, 6).map((r: any) => ({
      title: clip(r?.title, 120),
      action: clip(r?.action, 300),
      channels: clip(r?.channels, 160),
    })).filter((r: any) => r.title),
    personas,
    segments,
    channels,
    measurement,
    nonMediaItems,
    ctvPublishers: ctvSource.map((pub: any) => clip(pub?.name || pub?.publisher || pub?.displayName, 60)).filter(Boolean).slice(0, 10),
    notInPlanChannels,
  };
}

// --- fingerprint ---------------------------------------------------------------------------

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.keys(value as Record<string, unknown>).sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(",")}}`;
}

function fnv1a(text: string, seed: number): string {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Identifies the plan content a brief was written from. The form inputs are left out on purpose. */
export function briefFingerprint(snapshot: BriefSnapshot): string {
  const { campaign: _campaign, ...content } = snapshot;
  const text = stableStringify(content);
  return `${fnv1a(text, 0x811c9dc5)}${fnv1a(text, 0x5bd1e995)}`;
}

// --- prompt --------------------------------------------------------------------------------

export const MAX_BRIEF_INSTRUCTIONS = 600;

export const BRIEF_SYSTEM_INSTRUCTION = `You are the senior media strategist presenting this plan to the client's leadership. Write the plan's executive summary: a one-screen overview a busy executive can read in two minutes.

FORMAT
- Short, scannable, confident. Bullets, not paragraphs. No bullet over 25 words; most under 18.
- Each bullet has a "lead" of 2-5 words that carries the point, and "text" that completes it.
- Each section has a one-sentence "headline" of at most 20 words that states its main point.
- 3 bullets per section (4 only when the plan genuinely needs it).

SECTIONS
1. understanding - What we're solving for: the business, the objective, the audience and the KPIs, in the client's terms. Built mainly from the brief of record.
2. strategicPov - Why we believe this will work: the insight about the audience and the strategic bet the plan makes, grounded in the research, personas and channel plan.
3. audience - Who we're reaching and how. Lean into audience definitions and targeting: how the plan's segments, data signals and targeting tactics find the core segments and serve the goals. In 'audienceMatches', validate each core segment (or persona) against the specific segments, tactics or publishers that reach it, and say why that data is a good signal for that audience. Name a data provider only if its name appears in the plan's segments or targeting tactics. ScoutAI is our planning tool, not a data source.
4. media - The role each channel plays. For EVERY channel in the plan, return its funnel role and a one-line role (at most 18 words). Bullets cover how the channels work together.
5. measurement (only when the plan includes measurement) - How we'll prove business impact with the measurement the plan includes. For each capability, say what it proves and which KPI it serves. Lead with incrementality, halo and consumer-journey measurement when the plan includes them.

RULES
1. ONLY WHAT IS IN THE PLAN. Name only channels, tactics, publishers, segments and measurement capabilities listed in the plan. Never mention a media type listed under NOT IN THIS PLAN. Never describe a measurement study the plan does not include.
2. NUMBERS. Use a figure only if it appears in the plan below. Do not restate dollar amounts; allocations are shown beside your text.
3. ONE STORY. The sections describe the same audience, personas and channel plan. Refer to personas and core segments by name.
4. VOICE. A planner recommending a plan: specific, no hedging, no compliance boilerplate, no commentary about how the plan was produced.
5. PLANNER INSTRUCTIONS change emphasis, order and wording only. They never add facts. If an instruction asks you to highlight something the plan does not include, do not claim it; add a short 'plannerNotes' entry saying what is missing and what to add to the plan instead.`;

const bulletSchema = {
  type: "object",
  properties: {
    lead: { type: "string", description: "2-5 words." },
    text: { type: "string", description: "At most 20 words." },
  },
  required: ["lead", "text"],
};

const sectionProperties = {
  headline: { type: "string", description: "One sentence, at most 20 words." },
  bullets: { type: "array", minItems: 2, maxItems: 4, items: bulletSchema },
};

export function buildBriefResponseSchema(snapshot: BriefSnapshot) {
  const channelIds = snapshot.channels.map((c) => c.channelId);
  const measurementNames = snapshot.measurement.map((m) => m.name);
  const properties: Record<string, unknown> = {
    understanding: { type: "object", properties: sectionProperties, required: ["headline", "bullets"] },
    strategicPov: { type: "object", properties: sectionProperties, required: ["headline", "bullets"] },
    audience: {
      type: "object",
      properties: {
        ...sectionProperties,
        audienceMatches: {
          type: "array",
          maxItems: 4,
          items: {
            type: "object",
            properties: {
              audience: { type: "string", description: "A core segment from the brief of record, or a persona name." },
              reachedWith: { type: "array", maxItems: 4, items: { type: "string" }, description: "Exact segment, targeting tactic or publisher names from the plan." },
              why: { type: "string", description: "At most 22 words: why this data is a good signal for this audience and goal." },
            },
            required: ["audience", "reachedWith", "why"],
          },
        },
      },
      required: ["headline", "bullets", "audienceMatches"],
    },
    media: {
      type: "object",
      properties: {
        ...sectionProperties,
        channels: {
          type: "array",
          items: {
            type: "object",
            properties: {
              channelId: channelIds.length ? { type: "string", enum: channelIds } : { type: "string" },
              funnelRole: { type: "string", enum: [...FUNNEL_ROLES] },
              role: { type: "string", description: "At most 18 words." },
            },
            required: ["channelId", "funnelRole", "role"],
          },
        },
      },
      required: ["headline", "bullets", "channels"],
    },
    plannerNotes: { type: "array", maxItems: 4, items: { type: "string" }, description: "Notes for the planner only, e.g. an instruction that could not be followed. Empty when there is nothing to say." },
  };
  const required = ["understanding", "strategicPov", "audience", "media", "plannerNotes"];
  if (measurementNames.length) {
    properties.measurement = {
      type: "object",
      properties: {
        ...sectionProperties,
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              capability: { type: "string", enum: measurementNames },
              proves: { type: "string", description: "At most 18 words: what it proves." },
              kpi: { type: "string", description: "The KPI it serves, from the campaign KPIs." },
            },
            required: ["capability", "proves", "kpi"],
          },
        },
      },
      required: ["headline", "bullets", "items"],
    };
    required.push("measurement");
  }
  return { type: "object", properties, required };
}

export function buildBriefPrompt(snapshot: BriefSnapshot, instructions?: string): { systemInstruction: string; input: string } {
  const lines: string[] = [];
  const c = snapshot.campaign;
  lines.push("CAMPAIGN");
  lines.push(`Advertiser: ${c.advertiser || "n/a"}${c.url ? ` (${c.url})` : ""}`);
  lines.push(`Geography: ${c.geography || "n/a"}`);
  if (c.campaignFocus) lines.push(`Campaign focus: ${c.campaignFocus}`);
  lines.push(`KPIs: ${c.kpis.join("; ") || "n/a"}`);
  if (snapshot.plan.flightDays) lines.push(`Flight: ${snapshot.plan.flightDays} days`);
  if (snapshot.plan.planningMode) lines.push(`Planning mode: ${snapshot.plan.planningMode}`);

  if (snapshot.brief) {
    const b = snapshot.brief;
    lines.push("", "BRIEF OF RECORD (who the plan is for)");
    lines.push(`What they sell: ${b.whatTheySell}`);
    lines.push(`Business model: ${b.businessModel}`);
    lines.push(`Primary audience: ${b.primaryAudience}`);
    if (b.coreSegments.length) lines.push(`Core segments: ${b.coreSegments.join("; ")}`);
    if (b.includedSegments.length) lines.push(`Also on-target: ${b.includedSegments.join("; ")}`);
    if (b.excludedSegments.length) lines.push(`Excluded: ${b.excludedSegments.join("; ")}`);
    lines.push(`Objective: ${b.campaignObjective} (funnel emphasis: ${b.funnelEmphasis}; ${b.audienceType}; price tier: ${b.priceTier})`);
  }
  if (snapshot.intro || snapshot.audienceAnalysis) {
    lines.push("", "AUDIENCE OVERVIEW");
    if (snapshot.intro) lines.push(snapshot.intro);
    if (snapshot.audienceAnalysis) lines.push(snapshot.audienceAnalysis);
  }
  if (snapshot.personas.length) {
    lines.push("", "PERSONAS");
    for (const persona of snapshot.personas) {
      lines.push(`- ${persona.name} (${[persona.age, persona.gender, persona.income].filter(Boolean).join(", ")}): ${persona.narrative}`);
    }
  }
  if (snapshot.segments.length) {
    lines.push("", "AUDIENCE SEGMENTS (targetable data segments on the plan)");
    for (const s of snapshot.segments) {
      lines.push(`- ${s.name} [${s.dimension}; data signal: ${s.dataSignal || "n/a"}; ${s.tier || "n/a"} tier; ${s.source === "Media plan" ? "from the client's media plan" : s.source === "Planner" ? "added by the planner" : "recommended by ScoutAI"}]${s.personas.length ? ` serves ${s.personas.join(", ")}` : ""}: ${s.justification}`);
    }
  }
  if (snapshot.takeaways.length) {
    lines.push("", "PLANNING TAKEAWAYS");
    for (const t of snapshot.takeaways) lines.push(`- ${t}`);
  }
  if (snapshot.recommendations.length) {
    lines.push("", "STRATEGIC RECOMMENDATIONS");
    for (const r of snapshot.recommendations) lines.push(`- ${r.title}: ${r.action}${r.channels ? ` (${r.channels})` : ""}`);
  }

  lines.push("", "CHANNEL PLAN (every channel in the plan; allocations are shown to the reader separately)");
  if (!snapshot.channels.length) lines.push("- No channels.");
  for (const ch of snapshot.channels) {
    lines.push(`- [${ch.channelId}] ${ch.name} (${ch.status}, ${ch.allocationPercent}% of budget)`);
    if (ch.role) lines.push(`  Role: ${ch.role}`);
    if (ch.gapAddressed) lines.push(`  Gap addressed: ${ch.gapAddressed}`);
    if (ch.rationale) lines.push(`  Rationale: ${ch.rationale}`);
    if (ch.activation) lines.push(`  Activation: ${ch.activation}`);
    if (ch.targeting.length) lines.push(`  Targeting tactics: ${ch.targeting.join("; ")}`);
    if (ch.publishers.length) lines.push(`  Publishers: ${ch.publishers.join("; ")}`);
    if (ch.measurementApproach) lines.push(`  Measurement approach: ${ch.measurementApproach}`);
    if (ch.measurement.length) lines.push(`  Measurement: ${ch.measurement.join("; ")}`);
  }
  if (snapshot.ctvPublishers.length) lines.push("", `CTV PUBLISHERS: ${snapshot.ctvPublishers.join(", ")}`);
  if (snapshot.nonMediaItems.length) lines.push("", `NON-MEDIA LINE ITEMS: ${snapshot.nonMediaItems.join("; ")}`);

  lines.push("", "MEASUREMENT INCLUDED IN THE PLAN");
  if (!snapshot.measurement.length) {
    lines.push("None. Omit the measurement section and do not describe any measurement study.");
  } else {
    for (const m of snapshot.measurement) {
      lines.push(`- ${m.name}${m.advanced ? " (advanced: proves business impact)" : ""}${m.channels.length ? ` on ${m.channels.join(", ")}` : ""}${m.rationale ? `: ${m.rationale}` : ""}`);
    }
  }
  if (snapshot.notInPlanChannels.length) {
    lines.push("", `NOT IN THIS PLAN (evaluated but not selected; never present these as part of the plan): ${snapshot.notInPlanChannels.join("; ")}`);
  }

  const cleanInstructions = clip(instructions, MAX_BRIEF_INSTRUCTIONS);
  if (cleanInstructions) {
    lines.push("", "PLANNER INSTRUCTIONS (emphasis and wording only; they never add facts):", cleanInstructions);
  }
  lines.push("", "Write the executive summary.");
  return { systemInstruction: BRIEF_SYSTEM_INSTRUCTION, input: lines.join("\n") };
}

// --- normalization ------------------------------------------------------------------------

const MAX_BULLETS = 4;

const words = (text: string, max: number) => {
  const parts = text.split(/\s+/).filter(Boolean);
  return parts.length > max ? `${parts.slice(0, max).join(" ").replace(/[,;:]$/, "")}…` : parts.join(" ");
};

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const mentions = (text: string, name: string) =>
  name.length >= 3 && new RegExp(`(^|[^a-z0-9])${escapeRegExp(name.toLowerCase())}($|[^a-z0-9])`).test(text.toLowerCase());

/** Why a line must not reach the client, or null when it is safe. */
export function unsupportedMention(text: string, snapshot: BriefSnapshot): string | null {
  // Blank out what the plan does carry first, so an included "CTV Sports" does not trip on an
  // excluded "CTV".
  let rest = text;
  const included = [
    ...snapshot.channels.map((c) => c.name),
    ...snapshot.measurement.map((m) => m.name),
    ...snapshot.channels.flatMap((c) => [...c.targeting, ...c.publishers]),
  ].filter((n) => n.length >= 3).sort((a, b) => b.length - a.length);
  for (const name of included) rest = rest.replace(new RegExp(escapeRegExp(name), "gi"), " ");

  const excluded = snapshot.notInPlanChannels.find((name) => mentions(rest, name));
  if (excluded) return `${excluded} is not in this plan`;
  const planMeasurement = snapshot.measurement.map((m) => m.name).join(" | ") + " | " + snapshot.nonMediaItems.join(" | ");
  const study = GUARDED_MEASUREMENT.find(({ pattern }) => pattern.test(rest) && !pattern.test(planMeasurement));
  if (study) return `${study.label} measurement is not in this plan`;
  return null;
}

const FIGURE = /\$\s?\d[\d,.]*\s?[kKmMbB]?|\d+(?:\.\d+)?\s?%/g;

function unsupportedFigures(text: string, snapshotText: string): string[] {
  return (text.match(FIGURE) || []).filter((figure) => {
    const digits = figure.replace(/[^\d.]/g, "").replace(/\.$/, "");
    return digits && !snapshotText.includes(digits);
  });
}

export interface NormalizeBriefOptions {
  instructions?: string;
  model?: string;
  now?: string;
}

/**
 * Turns the model's answer into a brief the planner can trust: plan facts are filled in from the
 * snapshot, lines naming things the plan does not carry are dropped (with a planner note), and
 * figures that do not appear in the plan are flagged for checking.
 */
export function normalizeBrief(raw: unknown, snapshot: BriefSnapshot, options: NormalizeBriefOptions = {}): ExecutiveBrief {
  const data: Record<string, any> = raw && typeof raw === "object" ? (raw as Record<string, any>) : {};
  const notes: string[] = clipList(data.plannerNotes, 4, 300);
  const snapshotText = JSON.stringify(snapshot);
  const title = (key: BriefSectionKey) => BRIEF_SECTION_LABELS[key].title;

  const guard = (key: BriefSectionKey, text: string): boolean => {
    const reason = unsupportedMention(text, snapshot);
    if (reason) {
      notes.push(`${title(key)}: removed a line because ${reason} ("${words(text, 12)}").`);
      return false;
    }
    for (const figure of unsupportedFigures(text, snapshotText)) {
      notes.push(`${title(key)}: check "${figure}"; it does not appear in the plan.`);
    }
    return true;
  };

  const baseSection = (key: BriefSectionKey): BriefSection => {
    const source = data[key] && typeof data[key] === "object" ? data[key] : {};
    let headline = words(clip(source.headline, 300), 25);
    if (headline && !guard(key, headline)) headline = "";
    const bullets: BriefBullet[] = (Array.isArray(source.bullets) ? source.bullets : [])
      .map((b: any) => ({ lead: words(clip(b?.lead, 80), 6).replace(/[.:]+$/, ""), text: words(clip(b?.text, 400), 32) }))
      .filter((b: BriefBullet) => b.text && guard(key, `${b.lead} ${b.text}`))
      .slice(0, MAX_BULLETS);
    return { key, headline, bullets };
  };

  const sections: BriefSection[] = [baseSection("understanding"), baseSection("strategicPov")];

  // Audience: every name in reachedWith must be something on the plan.
  const audience = baseSection("audience");
  const reachable = new Map<string, string>();
  for (const name of [
    ...snapshot.segments.map((s) => s.name),
    ...snapshot.channels.flatMap((c) => [...c.targeting, ...c.publishers]),
    ...snapshot.ctvPublishers,
  ]) reachable.set(name.toLowerCase(), name);
  audience.audienceMatches = (Array.isArray(data.audience?.audienceMatches) ? data.audience.audienceMatches : [])
    .map((m: any) => ({
      audience: clip(m?.audience, 100),
      reachedWith: Array.from(new Set((Array.isArray(m?.reachedWith) ? m.reachedWith : [])
        .map((n: unknown) => reachable.get(clip(n, 120).toLowerCase()))
        .filter((n: string | undefined): n is string => Boolean(n)))).slice(0, 4),
      why: words(clip(m?.why, 300), 30),
    }))
    .filter((m: BriefAudienceMatch) => m.audience && m.reachedWith.length > 0 && m.why && guard("audience", m.why))
    .slice(0, 4);
  sections.push(audience);

  // Media: one row per plan channel, in allocation order. Names and allocations are the plan's.
  const media = baseSection("media");
  const modelRows = new Map<string, any>();
  for (const row of Array.isArray(data.media?.channels) ? data.media.channels : []) {
    if (row?.channelId && !modelRows.has(row.channelId)) modelRows.set(String(row.channelId), row);
  }
  media.channels = [...snapshot.channels]
    .sort((a, b) => b.allocationPercent - a.allocationPercent)
    .map((channel) => {
      const row = modelRows.get(channel.channelId);
      const funnelRole = (FUNNEL_ROLES as readonly string[]).includes(row?.funnelRole) ? row.funnelRole as FunnelRole : "Full funnel";
      let role = words(clip(row?.role, 300), 24);
      if (!role || !guard("media", role)) role = words(channel.role || channel.gapAddressed, 24);
      return { channelId: channel.channelId, channelName: channel.name, allocationPercent: channel.allocationPercent, funnelRole, role };
    });
  sections.push(media);

  // Measurement: only when the plan carries some, and only the capabilities it carries.
  if (snapshot.measurement.length) {
    const measurement = baseSection("measurement");
    const modelItems = new Map<string, any>();
    for (const item of Array.isArray(data.measurement?.items) ? data.measurement.items : []) {
      const key = clip(item?.capability, 120).toLowerCase();
      if (key && !modelItems.has(key)) modelItems.set(key, item);
    }
    measurement.measurement = snapshot.measurement.map((m) => {
      const item = modelItems.get(m.name.toLowerCase());
      let proves = words(clip(item?.proves, 300), 24);
      // The catalog rationale is terse shorthand ("exposure -> lead -> sale; ..."); its first clause reads best.
      if (!proves || !guard("measurement", proves)) proves = words(m.rationale.split(/;\s/)[0].replace(/\s*->\s*/g, " → "), 24);
      return { capability: m.name, advanced: m.advanced, proves, kpi: words(clip(item?.kpi, 120), 8) };
    });
    sections.push(measurement);
  }

  // Asked to feature measurement the plan does not have: say so, whatever the model did.
  const asksForImpact = /attribution|incremental|halo|journey|measurement|lift|prove/i.test(options.instructions || "");
  if (asksForImpact && !snapshot.measurement.some((m) => m.advanced)) {
    notes.push("Your instructions ask to feature measurement, but this plan has no incrementality, halo or consumer-journey study. Add one to a channel's measurement to feature it here.");
  }

  const written = sections.filter((s) => s.headline || s.bullets.length > 0);
  if (written.length < 2) throw new Error("The model returned no usable executive summary.");

  const instructions = clip(options.instructions, MAX_BRIEF_INSTRUCTIONS);
  return {
    version: 1,
    generatedAt: options.now || new Date().toISOString(),
    inputFingerprint: briefFingerprint(snapshot),
    ...(instructions ? { instructions } : {}),
    ...(options.model ? { model: options.model } : {}),
    sections,
    plannerNotes: Array.from(new Set(notes)).slice(0, 8),
  };
}

/** Request bodies are untrusted: rebuilds the snapshot's shape with every field capped. */
export function sanitizeBriefSnapshot(body: any): BriefSnapshot {
  const s = body && typeof body === "object" ? body : {};
  const list = <T>(value: unknown, max: number, map: (item: any) => T): T[] =>
    (Array.isArray(value) ? value : []).slice(0, max).map(map);
  return {
    campaign: {
      advertiser: clip(s.campaign?.advertiser, 120),
      url: clip(s.campaign?.url, 200),
      geography: clip(s.campaign?.geography, 200),
      campaignFocus: clip(s.campaign?.campaignFocus, 80),
      kpis: clipList(s.campaign?.kpis, 8, 120),
    },
    plan: {
      workingMediaBudget: Number(s.plan?.workingMediaBudget) || 0,
      flightDays: Number(s.plan?.flightDays) || null,
      planningMode: clip(s.plan?.planningMode, 20),
    },
    brief: s.brief && typeof s.brief === "object" ? {
      whatTheySell: clip(s.brief.whatTheySell, 300),
      businessModel: clip(s.brief.businessModel, 300),
      primaryAudience: clip(s.brief.primaryAudience, 300),
      coreSegments: clipList(s.brief.coreSegments, 6, 120),
      includedSegments: clipList(s.brief.includedSegments, 10, 120),
      excludedSegments: clipList(s.brief.excludedSegments, 8, 120),
      campaignObjective: clip(s.brief.campaignObjective, 300),
      funnelEmphasis: clip(s.brief.funnelEmphasis, 20),
      priceTier: clip(s.brief.priceTier, 20),
      audienceType: clip(s.brief.audienceType, 10),
    } : null,
    intro: clip(s.intro, 400),
    audienceAnalysis: clip(s.audienceAnalysis, 900),
    takeaways: clipList(s.takeaways, 6, 300),
    recommendations: list(s.recommendations, 6, (r) => ({ title: clip(r?.title, 120), action: clip(r?.action, 300), channels: clip(r?.channels, 160) })),
    personas: list(s.personas, 8, (p) => ({ name: clip(p?.name, 80), age: clip(p?.age, 40), gender: clip(p?.gender, 40), income: clip(p?.income, 60), narrative: clip(p?.narrative, 350) })),
    segments: list(s.segments, 24, (g) => ({
      name: clip(g?.name, 80), dimension: clip(g?.dimension, 40), dataSignal: clip(g?.dataSignal, 60), tier: clip(g?.tier, 20),
      source: clip(g?.source, 20), justification: clip(g?.justification, 220), personas: clipList(g?.personas, 8, 80),
    })),
    channels: list(s.channels, 20, (c) => ({
      channelId: clip(c?.channelId, 120), name: clip(c?.name, 80), status: clip(c?.status, 10),
      allocationPercent: Number(c?.allocationPercent) || 0, role: clip(c?.role, 200), gapAddressed: clip(c?.gapAddressed, 400),
      rationale: clip(c?.rationale, 400), activation: clip(c?.activation, 400), targeting: clipList(c?.targeting, 10, 100),
      publishers: clipList(c?.publishers, 10, 80), measurementApproach: clip(c?.measurementApproach, 400), measurement: clipList(c?.measurement, 8, 100),
    })).filter((c) => c.channelId && c.name),
    measurement: list(s.measurement, 10, (m) => ({
      name: clip(m?.name, 100), advanced: isAdvancedMeasurement(clip(m?.name, 100)), channels: clipList(m?.channels, 20, 80), rationale: clip(m?.rationale, 300),
    })).filter((m) => m.name),
    nonMediaItems: clipList(s.nonMediaItems, 12, 100),
    ctvPublishers: clipList(s.ctvPublishers, 10, 60),
    notInPlanChannels: clipList(s.notInPlanChannels, 60, 80),
  };
}

// --- hand edits ----------------------------------------------------------------------------

/**
 * A section as editable text: the headline on the first line, then one "- Lead: text" line per
 * bullet. Channel and measurement rows become bullets too, so an edit can reword any of it.
 */
export function sectionToEditText(section: BriefSection, livePercents: Record<string, number> = {}): string {
  const lines: string[] = [];
  if (section.headline) lines.push(section.headline);
  for (const b of section.bullets) lines.push(`- ${b.lead ? `${b.lead}: ` : ""}${b.text}`);
  for (const m of section.audienceMatches || []) lines.push(`- ${m.audience}: ${m.reachedWith.join(", ")}. ${m.why}`);
  for (const c of section.channels || []) {
    const percent = livePercents[c.channelId] ?? c.allocationPercent;
    lines.push(`- ${c.channelName} (${percent}%, ${c.funnelRole}): ${c.role}`);
  }
  for (const m of section.measurement || []) lines.push(`- ${m.capability}: ${m.proves}${m.kpi ? ` (${m.kpi})` : ""}`);
  return lines.join("\n");
}

/** Reads edited text back: lines starting with "-", "•" or "*" are bullets, the rest is the headline. */
export function parseEditText(content: string): { headline: string; bullets: BriefBullet[] } {
  const headline: string[] = [];
  const bullets: BriefBullet[] = [];
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = line.match(/^[-•*]\s*(.*)$/);
    if (!bullet) {
      headline.push(line);
      continue;
    }
    const body = bullet[1].trim();
    const colon = body.indexOf(": ");
    // A short phrase before the first colon is the bold lead; a long one is just a sentence.
    if (colon > 0 && colon <= 60) bullets.push({ lead: body.slice(0, colon).trim(), text: body.slice(colon + 2).trim() });
    else bullets.push({ lead: "", text: body });
  }
  return { headline: headline.join(" "), bullets };
}

/** A brief without its undo history, for storing as the next version's `previous`. */
export function withoutHistory(brief: ExecutiveBrief): ExecutiveBrief {
  const { previous: _previous, ...rest } = brief;
  return rest;
}
