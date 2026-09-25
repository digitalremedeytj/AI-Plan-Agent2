// The Brief of Record: one definition of who this plan is for, settled before any research
// runs, which every later step reads instead of inferring the audience for itself.
//
// Without it, each of the four research dossiers guessed the audience independently ("U.S. Pet
// Parents (Inferred from petsmart.com)"), synthesis guessed again, and QA guessed a third time -
// on a Jinx run QA decided cat owners were off-target for a brand that sells cat food, and
// remediation rebuilt every persona around dog owners. A written definition gives all of those
// steps, and the auditor, the same answer to "who is this for?".
//
// It describes the advertiser and the audience; it carries no statistics. Numbers belong to the
// research, where they can be checked against a source.
//
// It also lists the advertiser facts the website states (products, offers, retailers,
// fulfilment). Without them, the writers filled personas and recommendations with plausible
// products and discounts, and QA flagged them as unverified in nine of ten test runs, often as
// critical: the brief kept one sentence about what the advertiser sells, so nothing downstream
// could tell a real product from an invented one.

import type { BriefOfRecord } from "../types";

export type { BriefOfRecord };

export const AUDIENCE_TYPES = ["B2C", "B2B", "B2B2C"] as const;
export const PRICE_TIERS = ["value", "mid-market", "premium", "luxury", "mixed", "unknown"] as const;
export const FUNNEL_EMPHASES = ["awareness", "consideration", "conversion", "full-funnel"] as const;

export interface BriefOfRecordInput {
  advertiserName: string;
  url: string;
  audienceDescription: string;
  targetPersonas: string[];
  kpis: string[];
  campaignFocus: string;
  geography: string;
  additionalContext: string;
  crawlText: string;
  /** Grounded web summary of the advertiser, used when the crawl returned nothing usable. */
  searchSummary: string;
}

export const BRIEF_OF_RECORD_SYSTEM_INSTRUCTION = `You are a senior media planner writing the one-page "brief of record" that every later step of a media plan will follow: the research, the personas, the channel rationale and the QA review.

Describe who the advertiser is and who the campaign is for. Rules:
- The planner's own audience description and target personas come first. Never contradict or narrow them; you may only make them more specific using the advertiser's offering.
- Cover the advertiser's whole relevant offering. If the brand sells to several customer groups (e.g. both dog and cat owners), include every one of them in 'includedSegments'. Do not pick a subset because it seems more typical.
- 'coreSegments' names the one to four groups that drive most of the advertiser's business and matter most for this campaign's objective (for a pet retailer, typically dog and cat owners). Each must also appear in 'includedSegments'. Niche groups the brand serves (e.g. reptile or backyard-bird owners) belong in 'includedSegments' only, unless the brand is built around them or the planner asked for them.
- 'excludedSegments' is only for groups the advertiser clearly does not serve, or that the planner excluded. Leave it empty when nothing is clearly out of scope.
- 'audienceType' is B2B only when the buyer is a business (decision-makers, firms, procurement). A retailer or brand selling to households is B2C. B2B2C is for a business sold through to consumers.
- Write no statistics, percentages, market sizes or rankings. Describe; do not quantify.
- 'advertiserFacts' lists what the WEBSITE TEXT (or, without it, the WEB SEARCH SUMMARY) actually states about the advertiser: named products and product lines, formulations and formats, offers and promotions, prices, subscription or loyalty programs, where it sells (its own site, named retailers, stores) and fulfilment options. One short, specific fact per item, as the source states it. Nothing inferred, typical or assumed; leave it empty when the source states nothing specific. Later steps may present only these as facts about the advertiser.
- If something cannot be known from the inputs, say so in 'uncertainties' rather than guessing.`;

export function buildBriefOfRecordInput(input: BriefOfRecordInput): string {
  const lines = [
    `ADVERTISER: ${input.advertiserName || "Not specified"}`,
    `WEBSITE: ${input.url || "Not provided"}`,
    `PLANNER'S AUDIENCE DESCRIPTION: ${input.audienceDescription || "None - infer it from the advertiser's offering"}`,
    `PLANNER'S TARGET PERSONAS: ${input.targetPersonas.length > 0 ? input.targetPersonas.join("; ") : "None"}`,
    `KPIS: ${input.kpis.length > 0 ? input.kpis.join("; ") : "Not specified"}`,
    `CAMPAIGN FOCUS: ${input.campaignFocus || "Not specified"}`,
    `GEOGRAPHY: ${input.geography || "United States"}`,
    `ADDITIONAL CONTEXT: ${input.additionalContext || "None"}`,
  ];
  if (input.crawlText) lines.push("", "WEBSITE TEXT (homepage crawl):", input.crawlText);
  if (input.searchSummary) lines.push("", "WEB SEARCH SUMMARY OF THE ADVERTISER:", input.searchSummary);
  if (!input.crawlText && !input.searchSummary) lines.push("", "No website text or search summary is available; rely on the brief and say what is uncertain.");
  return lines.join("\n");
}

export function buildAdvertiserSearchPrompt(advertiserName: string, url: string): string {
  return `Search the web and summarize, in 150 words or fewer, what ${advertiserName || url} (${url || "no website given"}) sells, which customer groups it serves, how it sells (stores, e-commerce, subscription, services), and its price positioning. Facts only; no market statistics.`;
}

export const briefOfRecordSchema = {
  type: "object",
  properties: {
    advertiser: { type: "string", description: "Advertiser name as the brand presents itself." },
    whatTheySell: { type: "string", description: "One or two sentences: products and services offered." },
    productCategories: { type: "array", items: { type: "string" }, description: "Main product or service categories, each a short label (e.g. 'Dog food', 'Grooming services')." },
    advertiserFacts: { type: "array", items: { type: "string" }, description: "Specific facts the website text (or search summary) states: products, formats, offers, prices, programs, retailers, fulfilment. One per item; empty if none are stated." },
    businessModel: { type: "string", description: "How it sells, e.g. 'Omnichannel specialty retailer with stores, e-commerce and in-store services'." },
    priceTier: { type: "string", enum: [...PRICE_TIERS] },
    audienceType: { type: "string", enum: [...AUDIENCE_TYPES] },
    primaryAudience: { type: "string", description: "One sentence: who this campaign is for." },
    includedSegments: { type: "array", items: { type: "string" }, description: "Every customer group in scope, each a short label of under 12 words (e.g. 'Cat owners')." },
    coreSegments: { type: "array", items: { type: "string" }, description: "The 1-4 in-scope groups that drive the business and this campaign, copied exactly from includedSegments." },
    excludedSegments: { type: "array", items: { type: "string" }, description: "Groups clearly out of scope. Usually empty." },
    campaignObjective: { type: "string", description: "One sentence tying the KPIs and campaign focus together." },
    funnelEmphasis: { type: "string", enum: [...FUNNEL_EMPHASES] },
    geography: { type: "string" },
    uncertainties: { type: "array", items: { type: "string" }, description: "What the inputs could not establish." },
  },
  required: [
    "advertiser", "whatTheySell", "productCategories", "advertiserFacts", "businessModel", "priceTier", "audienceType",
    "primaryAudience", "includedSegments", "coreSegments", "excludedSegments", "campaignObjective", "funnelEmphasis",
    "geography", "uncertainties",
  ],
};

// Cuts at a word boundary: a hard slice left "fish, birds, and bac" in a live brief.
const text = (value: unknown, max: number) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max / 2)).replace(/[\s,;:]+$/, "")}...`;
};
const list = (value: unknown, maxItems: number, maxLength: number) =>
  Array.isArray(value)
    ? value.map((item) => text(item, maxLength)).filter(Boolean).slice(0, maxItems)
    : [];
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

/**
 * Core segments must be in scope. One the model named but left out of 'includedSegments' is
 * added there rather than dropped; with none named, the first two in-scope groups stand in,
 * which is how the model orders them.
 */
const segmentKey = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "");

function settleCoreSegments(core: string[], included: string[]): string[] {
  const key = segmentKey;
  for (const label of core) {
    if (!included.some((item) => key(item) === key(label))) included.push(label);
  }
  return core.length > 0 ? core : included.slice(0, 2);
}

/**
 * Bounds and validates the model's brief. Returns null when it is unusable - no audience at all -
 * so the pipeline carries on without one rather than steering every step with an empty brief.
 */
export function normalizeBriefOfRecord(raw: unknown, basis: BriefOfRecord["basis"]): BriefOfRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const primaryAudience = text(r.primaryAudience, 300);
  const includedSegments = list(r.includedSegments, 8, 160);
  if (!primaryAudience && includedSegments.length === 0) return null;
  return {
    advertiser: text(r.advertiser, 200),
    whatTheySell: text(r.whatTheySell, 500),
    productCategories: list(r.productCategories, 10, 120),
    advertiserFacts: list(r.advertiserFacts, 15, 200),
    businessModel: text(r.businessModel, 300),
    priceTier: oneOf(r.priceTier, PRICE_TIERS, "unknown"),
    // Unknown defaults to consumer: every brief this tool has run is a consumer brand, and the
    // B2B-only targeting it gates is the more damaging mistake to make by default.
    audienceType: oneOf(r.audienceType, AUDIENCE_TYPES, "B2C"),
    primaryAudience,
    includedSegments,
    coreSegments: settleCoreSegments(list(r.coreSegments, 4, 160), includedSegments),
    excludedSegments: list(r.excludedSegments, 8, 160),
    campaignObjective: text(r.campaignObjective, 300),
    funnelEmphasis: oneOf(r.funnelEmphasis, FUNNEL_EMPHASES, "full-funnel"),
    geography: text(r.geography, 200),
    uncertainties: list(r.uncertainties, 6, 200),
    basis,
  };
}

/** In-scope groups that are not core segments. */
export function alsoServedSegments(brief: Pick<BriefOfRecord, "includedSegments" | "coreSegments">): string[] {
  const coreKeys = new Set((brief.coreSegments ?? []).map(segmentKey));
  return brief.includedSegments.filter((segment) => !coreKeys.has(segmentKey(segment)));
}

/** The block every downstream prompt carries. One wording, so no step reads a different brief. */
export function formatBriefOfRecord(brief: BriefOfRecord | null | undefined): string {
  if (!brief) return "";
  const lines = [
    "BRIEF OF RECORD (the settled definition of this campaign's audience - follow it; do not narrow, widen or redefine it):",
    `- Advertiser: ${brief.advertiser}${brief.whatTheySell ? ` - ${brief.whatTheySell}` : ""}`,
    `- Business model: ${brief.businessModel || "unknown"} (price tier: ${brief.priceTier})`,
    `- Audience type: ${brief.audienceType}`,
    `- Primary audience: ${brief.primaryAudience}`,
  ];
  const core = brief.coreSegments ?? [];
  const alsoServed = alsoServedSegments(brief);
  if (core.length > 0) {
    lines.push(`- Core segments (build the personas and the plan's emphasis around these): ${core.join("; ")}`);
    if (alsoServed.length > 0) lines.push(`- Also served (on-target, but no persona or emphasis of their own unless the research shows they matter for this objective): ${alsoServed.join("; ")}`);
  } else {
    lines.push(`- In scope: ${brief.includedSegments.join("; ") || "see primary audience"}`);
  }
  if (brief.excludedSegments.length > 0) lines.push(`- Out of scope: ${brief.excludedSegments.join("; ")}`);
  // Briefs saved before the facts existed carry no list; saying "none verified" for them would
  // turn every product mention in an older plan into a finding.
  if (Array.isArray(brief.advertiserFacts)) {
    const source = brief.basis === "brief + website" ? "the advertiser's website" : brief.basis === "brief + web search" ? "a web search of the advertiser" : "the brief";
    lines.push(brief.advertiserFacts.length > 0
      ? `- Verified advertiser facts (from ${source}; the ONLY products, offers, prices, retailers and fulfilment options the plan may state as fact): ${brief.advertiserFacts.join("; ")}`
      : `- Verified advertiser facts: none stated by ${source}. Describe the category and shopper behaviour; do not name the advertiser's products, offers, prices, retailers or fulfilment options.`);
  }
  lines.push(`- Objective: ${brief.campaignObjective} (funnel emphasis: ${brief.funnelEmphasis})`);
  if (brief.geography) lines.push(`- Geography: ${brief.geography}`);
  if (brief.uncertainties.length > 0) lines.push(`- Not established: ${brief.uncertainties.join("; ")}`);
  return lines.join("\n");
}
