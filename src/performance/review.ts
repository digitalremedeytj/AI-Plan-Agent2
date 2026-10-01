// The saved Performance Review: one considered read of a past campaign, written once when its
// reports are uploaded and kept with the campaign. It is about the campaign alone, not any plan,
// so every plan for the advertiser can build on it; ScoutAI turns it into changes to a plan, and
// its findings are what the client-facing learnings are drawn from. Each finding's figures are
// checked against the data before it is saved.

import type { CampaignAnalysis } from "./campaign";
import { CAMPAIGN_GOALS } from "./constants";
import { renderDigest } from "./digest";
import { figureReference, unverifiedFigures } from "./figureCheck";
import { READING_RULES } from "./readingRules";

export type FindingKind = "worked" | "didnt" | "watch";
export type Confidence = "high" | "medium" | "low";

export interface ReviewFinding {
  id: string;
  kind: FindingKind;
  headline: string;
  detail: string;
  /** The rows and figures it rests on, quoted from the data. */
  evidence: string;
  confidence: Confidence;
  /** Media type, publisher, audience, creative, timing, measurement... */
  area: string;
  /** Figures in the finding that are not in the data. A finding with any is never shown to a client. */
  unverified: string[];
  /** Cause-and-effect wording the data cannot show ("as spend expanded to address pacing"). */
  causalClaim: string | null;
  /** Why code lowered the model's confidence, when it did. */
  confidenceNote: string | null;
}

export interface PerformanceReview {
  generatedAt: string;
  generatedBy: string;
  /** The files and details it was written from; a different fingerprint means it is out of date. */
  fingerprint: string;
  summary: string;
  findings: ReviewFinding[];
}

const REVIEW_DIGEST_CHARS = 20000;
const MAX_FINDINGS = 10;

export const REVIEW_SYSTEM_INSTRUCTION = `You are a senior media analyst at Digital Remedy reviewing a campaign that has finished. A planner will use your review to plan the advertiser's next campaign, and parts of it may be shown to the client. Be accurate before you are interesting.

Rules for reading the data:
${READING_RULES}

What to write:
- "summary": two or three sentences on how the campaign did against what it optimised for.
- "findings": 4 to ${MAX_FINDINGS}, the ones that would change how the next campaign is planned, most important first. Each is one of:
  * "worked": something to keep or do more of;
  * "didnt": something to cut, fix or avoid;
  * "watch": a caveat that changes how the results should be read (attribution, sample size, pacing, a one-off event, a data problem in the notes).
- Each finding has a "headline" of at most 12 words, a "detail" of one or two sentences, "evidence" that quotes the rows and figures it rests on exactly as given, a "confidence" (high: a large sample and consistent across reports; medium: one report or last-touch only; low: a thin or event-driven sample) and an "area" (media type, publisher, audience, creative, timing, geography or measurement).
- Plain text only: no markdown.`;

export const reviewSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["worked", "didnt", "watch"] },
          headline: { type: "string" },
          detail: { type: "string" },
          evidence: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          area: { type: "string" },
        },
        required: ["kind", "headline", "detail", "evidence", "confidence", "area"],
      },
    },
  },
  required: ["summary", "findings"],
};

export interface ReviewSubject {
  name: string;
  advertiserName: string;
  campaignGoal: string | null;
  notes: string | null;
}

export const reviewDigest = (analysis: CampaignAnalysis) => renderDigest(analysis, { maxChars: REVIEW_DIGEST_CHARS });

export function buildReviewInput(subject: ReviewSubject, analysis: CampaignAnalysis): string {
  const goal = CAMPAIGN_GOALS.find((g) => g.id === subject.campaignGoal)?.label;
  return [
    `CAMPAIGN: ${subject.name} for ${subject.advertiserName}.`,
    `It optimised for: ${goal ?? "not stated"}.`,
    subject.notes ? `Planner's notes: ${subject.notes}` : "",
    reviewDigest(analysis),
  ].filter(Boolean).join("\n\n");
}

const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\*\*|__|^#+\s*/gm, "").trim().slice(0, max) : "");
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);

export function normalizeReview(raw: any, analysis: CampaignAnalysis, meta: { actor: string; fingerprint: string; now?: string }): PerformanceReview {
  const reference = figureReference(renderDigest(analysis, { maxChars: 1_000_000 }));
  const findings: ReviewFinding[] = (Array.isArray(raw?.findings) ? raw.findings : [])
    .slice(0, MAX_FINDINGS)
    .map((f: any, i: number) => {
      const finding = {
        id: `f${i + 1}`,
        kind: oneOf(f?.kind, ["worked", "didnt", "watch"] as const, "watch"),
        headline: text(f?.headline, 140),
        detail: text(f?.detail, 600),
        evidence: text(f?.evidence, 600),
        confidence: oneOf(f?.confidence, ["high", "medium", "low"] as const, "low"),
        area: text(f?.area, 40) || "campaign",
      };
      const capped = capConfidence(finding, analysis);
      return {
        ...finding,
        ...capped,
        unverified: unverifiedFigures(`${finding.headline} ${finding.detail} ${finding.evidence}`, reference),
        causalClaim: findCausalClaim(`${finding.headline} ${finding.detail}`),
      };
    })
    .filter((f: ReviewFinding) => f.headline && f.detail);
  return { generatedAt: meta.now ?? new Date().toISOString(), generatedBy: meta.actor, fingerprint: meta.fingerprint, summary: text(raw?.summary, 800), findings };
}

// Live reviews broke the "report what happened, not why" rule ("CPA rose as spend expanded to
// address pacing") even with it in the prompt, so the wording is caught in code. The list is
// narrow on purpose: "driven by" and "from" describe credit, not cause.
const CAUSAL = /\b(because( of)?|due to|as a result( of)?|led to|leading to|caused|causing|resulted in|resulting from|in order to|to address|in response to|thanks to)\b/i;

export function findCausalClaim(text: string): string | null {
  return CAUSAL.exec(text)?.[0] ?? null;
}

// The model's confidence was not consistent between runs (one marked an event buy with 44
// conversions "high"), so code caps it from what the finding cites: a thin or one-off row can
// only support low confidence, and with last-touch data alone a judgement about a media type,
// publisher or retargeting can only be medium.
const ATTRIBUTION_SENSITIVE = /media|channel|publisher|retarget|ctv|ott|video|display/i;
const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

export function capConfidence(finding: Pick<ReviewFinding, "headline" | "detail" | "evidence" | "area" | "confidence">, analysis: CampaignAnalysis): Pick<ReviewFinding, "confidence" | "confidenceNote"> {
  const text = `${finding.headline} ${finding.detail} ${finding.evidence}`.toLowerCase();
  const cited = analysis.breakdowns
    .filter((b) => b.role !== "reference")
    .flatMap((b) => b.rows)
    .filter((row) => row.name.length >= 4 && text.includes(row.name.toLowerCase()));
  const thin = cited.find((row) => row.flags.includes("low-sample") || row.flags.includes("event"));
  let cap: Confidence = "high";
  let note: string | null = null;
  if (thin) {
    cap = "low";
    note = `${thin.name} is ${thin.flags.includes("event") ? "an event or one-off buy" : "under 30 conversions"}`;
  } else if (!analysis.touches.some((t) => t.role !== "reference" && t.summary.attribution === "all-touch") && ATTRIBUTION_SENSITIVE.test(`${finding.area} ${finding.headline}`)) {
    cap = "medium";
    note = "the evidence is last-touch only";
  }
  return RANK[finding.confidence] > RANK[cap] ? { confidence: cap, confidenceNote: note } : { confidence: finding.confidence, confidenceNote: null };
}

/** A stored review, rebuilt field by field: it round-trips through storage as plain JSON. */
export function readStoredReview(raw: any): PerformanceReview | null {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.findings)) return null;
  return {
    generatedAt: text(raw.generatedAt, 40),
    generatedBy: text(raw.generatedBy, 120),
    fingerprint: text(raw.fingerprint, 80),
    summary: text(raw.summary, 800),
    findings: raw.findings.slice(0, MAX_FINDINGS).map((f: any, i: number) => ({
      id: text(f?.id, 10) || `f${i + 1}`,
      kind: oneOf(f?.kind, ["worked", "didnt", "watch"] as const, "watch"),
      headline: text(f?.headline, 140),
      detail: text(f?.detail, 600),
      evidence: text(f?.evidence, 600),
      confidence: oneOf(f?.confidence, ["high", "medium", "low"] as const, "low"),
      area: text(f?.area, 40),
      unverified: Array.isArray(f?.unverified) ? f.unverified.map((u: unknown) => text(u, 40)).filter(Boolean) : [],
      causalClaim: text(f?.causalClaim, 80) || null,
      confidenceNote: text(f?.confidenceNote, 200) || null,
    })),
  };
}
