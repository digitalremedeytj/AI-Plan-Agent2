// The QA audit, the fix routing and the verify pass. The auditor is a different provider
// (OpenAI) from the writer (Gemini), so the two do not share blind spots.
//
// What changed from the original scorer, and why:
//   * It sees what it is judging against: the brief of record, the research dossiers, the chart
//     sources, the channel plan and the number check. It used to see only the plan, so it
//     called research figures "unsupported" and could not tell a misapplied figure from an
//     invented one.
//   * Its rubric scores what a senior planner would. The old one asked for mutually exclusive
//     personas and operational completeness, and the fixer answered by filling personas with
//     assignment rules and the prose with consent and match-rate caveats.
//   * Findings are structured, and each names who may fix it. Code owns the channel plan and
//     the charts, so the prose fixer is only ever handed prose.
//   * A verify pass re-scores the plan after fixes, so the score shown is the score of the plan
//     that ships.

import { EVIDENCE_RULES } from "./evidenceRules";

export const AUDIT_CATEGORIES = [
  "Evidence & Data Integrity",
  "Audience & Brief Fit",
  "Cohesion",
  "Strategic Quality",
  "Clarity & Client Readiness",
] as const;

export const FINDING_OWNERS = ["narrative", "personas", "publisherRationale", "channelRationale", "chart", "channelStrategy", "planner"] as const;
export type FindingOwner = (typeof FINDING_OWNERS)[number];
export const FINDING_SEVERITIES = ["critical", "major", "minor"] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

/**
 * Owners whose findings the prose fixer is allowed to act on. A channel's written rationale is
 * prose too: findings about it used to belong to "channelStrategy", which nothing can fix, so the
 * same evidence errors stayed open every run. The channel decisions stay with a planner.
 */
export const PROSE_OWNERS: ReadonlySet<FindingOwner> = new Set(["narrative", "personas", "publisherRationale", "channelRationale"]);

export interface AuditFinding {
  id: string;
  severity: FindingSeverity;
  category: string;
  owner: FindingOwner;
  paths: string[];
  issue: string;
  evidence: string;
  fix: string;
  /** Set by the verify pass. */
  status?: "resolved" | "partially_resolved" | "unresolved";
  verifyNote?: string;
}

export interface AuditScore {
  category: string;
  score: number;
  notes: string;
}

export interface NormalizedAudit {
  executiveSummary: string;
  scorecard: AuditScore[];
  totalScore: number;
  findings: AuditFinding[];
  strategicHighlights: string[];
}

const RUBRIC = `Score five categories, 0-20 each:
1. Evidence & Data Integrity: every figure traces to the research, a chart or the plan's own inputs (the NUMBER CHECK shows which do); figures are applied to the population the research describes; estimates are labelled; nothing is statistically implausible. The writers were given the EVIDENCE RULES below; a breach of one is a finding.
2. Audience & Brief Fit: the plan serves the brief of record (core segments emphasised, nothing aimed outside it), the KPIs, the geography and any planner-named personas.
3. Cohesion: the plan reads as if one expert planner wrote it. Personas, charts, narrative, channel rationale and publisher choices describe the same people and do not contradict each other (e.g. a high-income persona reached through a channel justified by low-income reach; a narrative peak the chart does not show; a device called dominant that the chart ranks second).
4. Strategic Quality: channel roles follow from the audience and the KPIs, recommendations are specific and actionable, measurement fits the objective.
5. Clarity & Client Readiness: clear, confident and concise; free of contradictions, jargon and filler.

Calibration: 90-100 client-ready as is; 75-89 good, minor edits; 60-74 usable with specific fixes; below 60 needs rework. Score what is there, consistently.

Do NOT mark down, or raise findings, for:
- Missing compliance, consent, privacy, match-rate or legal caveats. The plan is a strategy document, not a contract.
- Personas that are not mutually exclusive or lack assignment/suppression rules. Personas are audience portraits, not targeting logic.
- Missing operational detail (bid rules, frequency caps, supply-path plans). The channel plan carries execution.
- Charts marked as ScoutAI estimates, or built from U.S. Census/BLS national baselines adjusted for this audience. They are labelled; judge only whether the prose uses them correctly.
- A figure the NUMBER CHECK found in the research. You may still flag it as misapplied (wrong population, stated as the advertiser's own behaviour) - say so, and quote the research.

${EVIDENCE_RULES}`;

const OWNERSHIP = `Each finding names its 'owner' - who can fix it:
- "narrative": intro, takeaways, recommendations, section overviews, activation notes, publisherInsights, the publisher insights panel (publisherHighlights headline, pillar titles and details), and a source's supportedClaims (what the citation is said to support).
- "personas": a persona's watch/browse/buy/narrative/gender text. Not its name, age or income, and never which groups the personas cover.
- "publisherRationale": a CTV publisher's 'why'. Not which publishers are selected.
- "chart": chart values (code settles these; a finding here is reported to the planner).
- "channelRationale": a channel's written rationale - its 'why' (gapAddressed), allocationRationale, tradeoffs and the wording of its research evidence lines. Text only; fixed automatically.
- "channelStrategy": the channel plan's decisions - which channels, allocations, targeting tactics, measurement and publishers (built by the planning engine; reported to the planner). A problem in what a channel's text claims is channelRationale; a problem in what the plan does is channelStrategy.
- "planner": anything needing a human decision, including any change to who the plan targets.
'paths' lists the exact fields, e.g. "intro", "takeaways[2]", "recommendations[1].why", "personas[0].narrative", "ctvPublishers[3].why", "channelStrategy.mediaPlan.channels[2].gapAddressed", "channelStrategy.mediaPlan.channels[2].tradeoffs[0]", "channelStrategy.mediaPlan.channels[2].evidence[1].detail".`;

export function auditSystemInstruction(today: string, currentYear: number): string {
  return `You are a principal media planning director doing the final quality review of an AI-generated audience profile and media plan before it goes to a client. Be exacting and fair: a finding must be specific, evidenced and worth fixing.

Today's date is ${today}. Data dated ${currentYear} or ${currentYear - 1} is current.

${RUBRIC}

${OWNERSHIP}

Severity: "critical" = would embarrass the agency or mislead the client; "major" = a real error or contradiction a planner must fix; "minor" = polish. List each distinct problem once, most severe first, at most 15 findings.

Return JSON: { "executiveSummary": string (2-3 sentences on client readiness), "scorecard": [{ "category": one of ${JSON.stringify(AUDIT_CATEGORIES)}, "score": 0-20, "notes": string }], "findings": [{ "id": "F1"..., "severity", "category", "owner", "paths": [string], "issue": string, "evidence": string (quote the plan, and the research or chart where relevant), "fix": string (the specific change) }], "strategicHighlights": [string] }`;
}

export function verifySystemInstruction(today: string, currentYear: number): string {
  return `You are the principal media planning director who audited this plan. Fixes have now been applied. Re-review the plan as it stands.

Today's date is ${today}. Data dated ${currentYear} or ${currentYear - 1} is current.

${RUBRIC}

For each earlier finding, decide whether it is now "resolved", "partially_resolved" or "unresolved", with a one-sentence note. A finding owned by "chart", "channelStrategy" or "planner" was not eligible for automatic fixes; mark it resolved only if the plan no longer has the problem. Then re-score all five categories for the plan as it now stands, and list any NEW problem the fixes introduced as a finding with an id starting "N".

Return JSON: { "executiveSummary": string, "scorecard": [{ "category", "score", "notes" }], "findingStatus": [{ "id", "status", "note" }], "findings": [ new findings only, same shape as before ], "strategicHighlights": [string] }`;
}

export interface AuditContext {
  briefBlock: string;
  campaign: string;
  planJson: string;
  personas: string;
  charts: string;
  channelPlan: string;
  publishers: string;
  ledger: string;
  alerts: string;
  research: string;
}

export function buildAuditInput(ctx: AuditContext, extra = ""): string {
  return [
    ctx.briefBlock,
    ctx.campaign,
    "THE PLAN (narrative, personas, CTV publishers and sources; charts and the channel plan are described below):",
    ctx.planJson,
    ctx.personas,
    ctx.charts,
    ctx.channelPlan,
    ctx.publishers,
    ctx.ledger,
    ctx.alerts,
    extra,
    ctx.research,
  ].filter(Boolean).join("\n\n");
}

/** The plan as the auditor reads it: everything the prose says, without the parts described separately. */
export function planForAudit(profile: any): string {
  // executiveSummary is synthesis's early draft: planners see the executive brief, written after
  // QA, so auditing the draft only produced findings about text nobody reads. Plans saved before
  // the brief still carry it; it is left out for them too, so every plan is scored the same way.
  const { channelStrategy, researchSnapshot, auditResult, generationAlerts, generationLog, segmentRecommendations, briefOfRecord, executiveSummary, executiveBrief, ...rest } = profile || {};
  const stripCharts = (section: any, keys: string[]) => {
    if (!section || typeof section !== "object") return section;
    const copy = { ...section };
    for (const key of keys) delete copy[key];
    return copy;
  };
  const view = {
    ...rest,
    personas: (rest.personas || []).map(({ avatarUrl, avatarHistory, portrait, ...p }: any) => p),
    demographics: stripCharts(rest.demographics, ["ageChartData", "genderChartData", "incomeChartData"]),
    browserAndReach: stripCharts(rest.browserAndReach, ["chartData"]),
    deviceTypeIndex: stripCharts(rest.deviceTypeIndex, ["chartData"]),
    temporalPatterns: stripCharts(rest.temporalPatterns, ["dayOfWeekChartData", "hourOfDayChartData"]),
  };
  return JSON.stringify(view, null, 1);
}

const clamp = (n: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));
const s = (v: unknown, max = 1200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function normalizeScorecard(raw: unknown): AuditScore[] {
  const items = Array.isArray(raw) ? raw : [];
  return AUDIT_CATEGORIES.map((category) => {
    const match = items.find((i: any) => typeof i?.category === "string" && i.category.toLowerCase().startsWith(category.toLowerCase().split(" ")[0]));
    return { category, score: clamp(match?.score, 0, 20), notes: s(match?.notes, 800) || "Not scored." };
  });
}

function normalizeFindings(raw: unknown, idPrefix: string): AuditFinding[] {
  const items = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  return items.slice(0, 20).flatMap((f: any, i: number): AuditFinding[] => {
    const issue = s(f?.issue, 600);
    if (!issue) return [];
    let id = s(f?.id, 12) || `${idPrefix}${i + 1}`;
    if (seen.has(id)) id = `${idPrefix}${i + 1}`;
    seen.add(id);
    const owner = (FINDING_OWNERS as readonly string[]).includes(f?.owner) ? f.owner : "planner";
    const severity = (FINDING_SEVERITIES as readonly string[]).includes(f?.severity) ? f.severity : "major";
    return [{
      id,
      severity,
      category: s(f?.category, 60) || "Uncategorized",
      owner,
      paths: Array.isArray(f?.paths) ? f.paths.map((p: unknown) => s(p, 120)).filter(Boolean).slice(0, 8) : [],
      issue,
      evidence: s(f?.evidence, 900),
      fix: s(f?.fix, 600),
    }];
  });
}

/** The total is the sum of the categories, whatever the model wrote for it. */
export function normalizeAudit(raw: unknown): NormalizedAudit | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const scorecard = normalizeScorecard(r.scorecard);
  if (scorecard.every((c) => c.notes === "Not scored.")) return null;
  return {
    executiveSummary: s(r.executiveSummary, 900),
    scorecard,
    totalScore: scorecard.reduce((sum, c) => sum + c.score, 0),
    findings: normalizeFindings(r.findings, "F"),
    strategicHighlights: Array.isArray(r.strategicHighlights) ? r.strategicHighlights.map((h) => s(h, 400)).filter(Boolean).slice(0, 6) : [],
  };
}

export interface NormalizedVerify extends NormalizedAudit {
  findingStatus: Map<string, { status: NonNullable<AuditFinding["status"]>; note: string }>;
}

export function normalizeVerify(raw: unknown): NormalizedVerify | null {
  const base = normalizeAudit(raw);
  if (!base) return null;
  const statuses = new Map<string, { status: NonNullable<AuditFinding["status"]>; note: string }>();
  for (const item of Array.isArray((raw as any)?.findingStatus) ? (raw as any).findingStatus : []) {
    const id = s(item?.id, 12);
    const status = ["resolved", "partially_resolved", "unresolved"].includes(item?.status) ? item.status : null;
    if (id && status) statuses.set(id, { status, note: s(item?.note, 400) });
  }
  return { ...base, findings: base.findings.map((f) => ({ ...f, id: f.id.startsWith("N") ? f.id : `N${f.id.replace(/^\D+/, "")}` })), findingStatus: statuses };
}

/** Red flags as the existing QA panel shows them: what is still wrong, worst first. */
export function openFindingsAsFlags(findings: AuditFinding[]): string[] {
  const rank = { critical: 0, major: 1, minor: 2 } as const;
  return findings
    .filter((f) => f.status !== "resolved" && f.severity !== "minor")
    .sort((a, b) => rank[a.severity] - rank[b.severity])
    .map((f) => `${f.issue}${f.status === "partially_resolved" ? " (partially resolved)" : ""}${PROSE_OWNERS.has(f.owner) ? "" : ` [needs ${f.owner === "planner" ? "planner decision" : `${f.owner} change`}]`}`);
}
