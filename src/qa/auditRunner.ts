// The audit, fix and verify steps, shared by plan generation and the manual "Run QA Audit" on a
// saved plan, so both judge a plan the same way. Generation applies fixes as it goes; the manual
// audit returns them as proposals for a planner to approve first.

import type OpenAI from "openai";
import type { GoogleGenAI } from "@google/genai";
import type { GenerationAlert } from "../types";
import { generateStructuredJson } from "../server/geminiInteractions";
import { openAiJson, type OpenAiEffort } from "../server/openaiJson";
import { buildClaimLedger, formatClaimLedger, type ResearchDossierText } from "./claimLedger";
import { describeChannelPlan, describeCharts, describePersonas, researchForPrompt } from "./planContext";
import {
  AUDIT_CATEGORIES,
  PROSE_OWNERS,
  auditSystemInstruction,
  buildAuditInput,
  normalizeAudit,
  normalizeVerify,
  openFindingsAsFlags,
  planForAudit,
  verifySystemInstruction,
  type AuditContext,
  type AuditFinding,
  type NormalizedAudit,
  type NormalizedVerify,
} from "./planAudit";
import { REMEDIATION_SYSTEM_INSTRUCTION, buildRemediationInput, remediationSchema, type AppliedPatch } from "./planRemediation";


export interface AuditInputs {
  briefBlock: string;
  campaignLine: string;
  research: Array<ResearchDossierText & { failed?: boolean }>;
  planInputs: { workingMediaBudget?: number; flightDays?: number | null };
  alerts: GenerationAlert[];
  /** Said to the auditor when the plan has no saved research to check figures against. */
  researchNote?: string;
}

export interface CampaignLineInput {
  advertiser: string;
  kpis: string[];
  campaignFocus: string;
  geography: string;
  workingMediaBudget: number;
  flightDays: number | null;
  targetPersonas: string[];
  uploadedPlan: boolean;
  rfp: boolean;
}

export function campaignLineFrom(c: CampaignLineInput): string {
  return `CAMPAIGN: advertiser ${c.advertiser || "not specified"}; KPIs: ${c.kpis.join("; ") || "not specified"}; campaign focus: ${c.campaignFocus || "not specified"}; geography: ${c.geography || "United States"}; working media budget $${Number(c.workingMediaBudget || 0).toLocaleString()} over ${c.flightDays || "an unspecified number of"} days; planner-named personas: ${c.targetPersonas.join("; ") || "none"}; uploaded media plan: ${c.uploadedPlan ? "yes" : "none"}${c.rfp ? "; an RFP was uploaded" : ""}.`;
}

export function publishersLine(profile: any): string {
  return `CTV PUBLISHERS (chosen from the enabled list; the selection is settled): ${(profile?.ctvPublishers || []).map((p: any) => `${p.publisher} (${p.category})`).join(", ") || "none"}`;
}

function alertsLine(alerts: GenerationAlert[], note?: string): string {
  const lines = alerts.length > 0
    ? [`GENERATION ALERTS (already shown to the planner):`, ...alerts.map((a) => `- [${a.severity}] ${a.message}`)]
    : ["GENERATION ALERTS: none."];
  if (note) lines.push(note);
  return lines.join("\n");
}

export function ledgerFor(profile: any, inputs: AuditInputs): string {
  return formatClaimLedger(buildClaimLedger(profile, inputs.research, inputs.planInputs));
}

export function auditContextFor(profile: any, inputs: AuditInputs): AuditContext {
  return {
    briefBlock: inputs.briefBlock,
    campaign: inputs.campaignLine,
    planJson: planForAudit(profile),
    personas: describePersonas(profile),
    charts: describeCharts(profile),
    channelPlan: describeChannelPlan(profile),
    publishers: publishersLine(profile),
    ledger: ledgerFor(profile, inputs),
    alerts: alertsLine(inputs.alerts, inputs.researchNote),
    research: researchForPrompt(inputs.research),
  };
}

export interface ModelOptions {
  model: string;
  effort: OpenAiEffort;
  timeoutMs: number;
  today: string;
  currentYear: number;
  /** Reasoning-summary headlines for the live console, while the call runs. */
  onThought?: (line: string) => void;
}

export async function runAudit(openai: OpenAI, profile: any, inputs: AuditInputs, opts: ModelOptions): Promise<NormalizedAudit> {
  const result = await openAiJson(openai, {
    model: opts.model,
    effort: opts.effort,
    system: auditSystemInstruction(opts.today, opts.currentYear),
    input: buildAuditInput(auditContextFor(profile, inputs)),
    timeoutMs: opts.timeoutMs,
    label: "QA audit",
    onThought: opts.onThought,
  });
  const audit = normalizeAudit(result.data);
  if (!audit) throw new Error("the audit response had no usable scorecard");
  return audit;
}

/** Gemini's patches for the findings the prose fixer may act on. Nothing is applied here. */
export async function proposeFixes(
  ai: GoogleGenAI,
  findings: AuditFinding[],
  profile: any,
  inputs: AuditInputs,
  timeoutMs: number,
  onThought?: (line: string) => void,
): Promise<{ patches: unknown; notes: unknown }> {
  const fixable = findings.filter((f) => PROSE_OWNERS.has(f.owner));
  if (fixable.length === 0) return { patches: [], notes: [] };
  const fix: any = await generateStructuredJson(ai, {
    systemInstruction: REMEDIATION_SYSTEM_INSTRUCTION,
    input: buildRemediationInput(fixable, profile, [
      inputs.briefBlock,
      describePersonas(profile),
      describeCharts(profile),
      describeChannelPlan(profile),
      publishersLine(profile),
      ledgerFor(profile, inputs),
      researchForPrompt(inputs.research),
    ].filter(Boolean).join("\n\n")),
    schema: remediationSchema,
    thinkingLevel: "medium",
    timeoutMs,
    onThought,
  });
  return { patches: fix?.patches, notes: fix?.notes };
}

export async function runVerify(
  openai: OpenAI,
  profile: any,
  inputs: AuditInputs,
  audit: NormalizedAudit,
  applied: AppliedPatch[],
  opts: ModelOptions,
): Promise<NormalizedVerify> {
  const result = await openAiJson(openai, {
    model: opts.model,
    effort: opts.effort,
    system: verifySystemInstruction(opts.today, opts.currentYear),
    input: buildAuditInput(auditContextFor(profile, inputs), [
      "EARLIER FINDINGS:",
      JSON.stringify(audit.findings.map(({ id, severity, owner, paths, issue, fix }) => ({ id, severity, owner, paths, issue, fix })), null, 1),
      "CHANGES APPLIED SINCE (field: before -> after):",
      JSON.stringify(applied.map(({ findingId, path, before, value }) => ({ findingId, path, before, after: value })), null, 1),
    ].join("\n")),
    timeoutMs: opts.timeoutMs,
    label: "QA verify",
    onThought: opts.onThought,
  });
  const verify = normalizeVerify(result.data);
  if (!verify) throw new Error("the verify response had no usable scorecard");
  return verify;
}

/** Earlier findings with their verified status, then any new ones verify raised. */
export function mergeFindings(audit: NormalizedAudit, verify: NormalizedVerify | null): AuditFinding[] {
  if (!verify) return audit.findings;
  return [
    ...audit.findings.map((f) => {
      const status = verify.findingStatus.get(f.id);
      return status ? { ...f, status: status.status, verifyNote: status.note } : f;
    }),
    ...verify.findings,
  ];
}

/** The auditResult object the plan carries and the QA panel reads. */
export function buildAuditResult(args: {
  audit: NormalizedAudit | null;
  verify: NormalizedVerify | null;
  findings: AuditFinding[];
  autoFixes: Array<{ issue: string; resolution: string }>;
  qaBypassed: boolean;
  /** Generated in Quick mode: the audit was skipped on purpose, not unavailable. */
  quickMode?: boolean;
  auditModel: string;
}) {
  const { audit, verify, findings, autoFixes, qaBypassed, auditModel } = args;
  const quickMode = Boolean(args.quickMode);
  const scored = verify ?? audit;
  const openFlags = openFindingsAsFlags(findings);
  return {
    executiveSummary: scored?.executiveSummary || (quickMode
      ? "Generated in Quick mode, so the QA audit was skipped. Run QA Audit on the saved plan before sharing it with a client."
      : "The independent QA audit was unavailable, so this profile has not been externally verified. Review it before client presentation."),
    scorecard: scored?.scorecard ?? AUDIT_CATEGORIES.map((category) => ({ category, score: 0, notes: quickMode ? "Not evaluated - Quick mode" : "Not evaluated - QA audit unavailable" })),
    originalScore: audit?.totalScore ?? 0,
    // The verified score when fixes were re-scored; otherwise the audit's own score, which then
    // describes the plan as it stands because nothing changed after it.
    finalScore: scored?.totalScore ?? 0,
    verified: Boolean(verify),
    remediationApplied: autoFixes.length > 0,
    criticalRedFlags: quickMode
      ? ["Not audited - generated in Quick mode."]
      : qaBypassed
      ? ["QA scoring did not run - this profile has not been independently verified."]
      : openFlags.length > 0 ? openFlags : ["Clean - no open major issues."],
    strategicHighlights: scored?.strategicHighlights || [],
    autoFixes,
    findings,
    auditModel,
    qaBypassed,
    ...(quickMode ? { quickMode: true } : {}),
  };
}
