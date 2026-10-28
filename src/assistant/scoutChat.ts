// ScoutAI, the plan assistant in the left column. It answers questions about a saved plan and
// proposes edits as operations (see ./operations); it never writes the plan itself.
//
// The chat is stateless on the server: the browser keeps the session's conversation and sends it
// with each turn, and the plan is always read from storage, so ScoutAI describes the plan that
// Apply would edit rather than whatever the browser happens to hold.

import { AUDIENCE_TYPES, FUNNEL_EMPHASES, PRICE_TIERS } from "../research/briefOfRecord";
import { SEGMENT_DIMENSIONS, SEGMENT_TIERS } from "../research/segmentRecommendations";
import { addableChannels, parseOps, type AssistantOp, type CatalogPublisher, type RejectedOp } from "./operations";
import { PLAN_SECTIONS } from "./narrativeOps";
import { CHANNEL_PANELS, CHANNEL_RECORD_TYPES, RECORD_LABELS } from "./channelDetailOps";
import { channelRecordOptions } from "../planning/engine";
import type { PlanningSettings } from "../planning/settings";
import { MAX_BRIEF_INSTRUCTIONS } from "../research/executiveBrief";
import type { MediaRecommendationPlan } from "../planning/types";
import { BUDGET_STRATEGY_LABELS, normalizeBudgetStrategyMode } from "../planning/budgetStrategy";
import { combinedPlan } from "../planning/planChannels";
import { plannerGuidanceField } from "../planning/effectiveProducts";
import { hasPublisherHighlights, publisherHighlightFields } from "../planning/publisherHighlights";
import { RECAP_BLOCKS } from "../performance/recap";
import { KPI_METRICS } from "../performance/recapKpi";
import { buildGeoFootprint, rehydrateGeoSnapshot } from "../planning/geoFootprint";
import { incrementalityView } from "../planning/incrementality";

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  /** What happened to a proposal ScoutAI made in this turn, so it knows what the plan now holds. */
  proposal?: { summary: string; status: "pending" | "applied" | "dismissed" | "reverted" | "failed" };
}

const MAX_TURNS = 20;
const MAX_TURN_CHARS = 4000;
const MAX_FIELD_CHARS = 1500;
/** Per research dossier. Enough for new personas and segments to rest on the same evidence as the plan. */
const MAX_DOSSIER_CHARS = 3500;

const clip = (value: unknown, max = MAX_FIELD_CHARS) => {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};
const list = (value: unknown): string[] => (Array.isArray(value) ? value.map((v) => clip(v, 300)).filter(Boolean) : []);
const money = (value: unknown) => `$${Math.round(Number(value) || 0).toLocaleString("en-US")}`;

/** Browser-supplied conversation, trimmed to what the prompt can carry. */
export function sanitizeTurns(raw: unknown): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const role = item?.role === "assistant" ? "assistant" : item?.role === "user" ? "user" : null;
    const text = clip(item?.text, MAX_TURN_CHARS);
    if (!role || !text) continue;
    const status = ["pending", "applied", "dismissed", "reverted", "failed"].includes(item?.proposal?.status) ? item.proposal.status : null;
    turns.push({ role, text, ...(status ? { proposal: { summary: clip(item.proposal.summary, 300), status } } : {}) });
  }
  return turns.slice(-MAX_TURNS);
}

/**
 * The plan as ScoutAI reads it. Editable text is labelled with its exact path so an edit can
 * name the field; everything else is read-only context. The generation log, raw chart data and
 * research dossiers are left out: they are large and the planner does not see them.
 */
export function buildPlanContext(
  stored: { title?: string; advertiserName?: string; payload?: any },
  { publisherCatalog = [], planningSettings }: { publisherCatalog?: CatalogPublisher[]; planningSettings?: PlanningSettings } = {},
): string {
  const payload = stored?.payload ?? {};
  const profile = payload.profile ?? {};
  const strategy = profile.channelStrategy;
  const plan: MediaRecommendationPlan | undefined = strategy?.mediaPlan;
  const locked = new Set<string>(strategy?.lockedAllocationChannelIds || []);
  const hidden = new Set<string>(profile.hiddenSections || []);
  const out: string[] = [];

  out.push(`PLAN: ${clip(stored?.title, 200) || "Untitled plan"}`);

  const request = [
    `- Advertiser: ${clip(stored?.advertiserName, 200) || "not given"}${payload.url ? ` (${clip(payload.url, 300)})` : ""}`,
    `- KPIs (editable with set_kpis): ${list(payload.kpis).join("; ") || "not given"}`,
    `- Budget: ${clip(payload.budget, 50) || "not given"}; campaign length: ${payload.campaignLength ? `${clip(String(payload.campaignLength), 20)} days` : "not given"}`,
    `- Geography (editable with set_geography): ${clip(payload.geography, 300) || "not given"}`,
    payload.campaignFocus ? `- Campaign focus: ${clip(payload.campaignFocus)}` : "",
    payload.audienceDescription ? `- Audience description: ${clip(payload.audienceDescription)}` : "",
    list(payload.targetPersonas).length ? `- Target personas asked for: ${list(payload.targetPersonas).join("; ")}` : "",
    payload.additionalContext ? `- Additional context: ${clip(payload.additionalContext)}` : "",
    list(strategy?.analyzedPlanNames).length ? `- Uploaded media plan(s): ${list(strategy.analyzedPlanNames).join("; ")}` : "",
  ].filter(Boolean);
  out.push(`WHAT THE PLANNER ORIGINALLY ASKED FOR:\n${request.join("\n")}`);

  const rfp = profile.additionalRfpRequirements;
  if (rfp?.isRfpDocument) {
    out.push([
      "RFP REQUIREMENTS:",
      rfp.rfpSummary ? `- Summary: ${clip(rfp.rfpSummary)}` : "",
      list(rfp.rfpAsksAndQuestions).length ? `- Asks: ${list(rfp.rfpAsksAndQuestions).join("; ")}` : "",
      rfp.extractedMetadata?.flightDates ? `- Flight dates: ${clip(rfp.extractedMetadata.flightDates, 200)}` : "",
      list(rfp.extractedMetadata?.reportingRequirements).length ? `- Reporting: ${list(rfp.extractedMetadata.reportingRequirements).join("; ")}` : "",
    ].filter(Boolean).join("\n"));
  }

  const brief = profile.briefOfRecord;
  if (brief) {
    const field = (key: string, value: unknown) => `[${key}] ${Array.isArray(value) ? value.map((v) => clip(v, 200)).join("; ") || "(none)" : clip(value, 500) || "(none)"}`;
    out.push([
      `BRIEF OF RECORD (the settled definition of the campaign's audience; edit with edit_brief using the field key in brackets)${profile.briefOfRecordEdited ? `. Edited by a planner since the plan was built (${(profile.briefOfRecordEdited.fields || []).join(", ")})` : ""}:`,
      ...["advertiser", "whatTheySell", "businessModel", "primaryAudience", "campaignObjective", "geography"].map((key) => field(key, brief[key])),
      `[priceTier] ${brief.priceTier} (one of: ${PRICE_TIERS.join(", ")})`,
      `[audienceType] ${brief.audienceType} (one of: ${AUDIENCE_TYPES.join(", ")})`,
      `[funnelEmphasis] ${brief.funnelEmphasis} (one of: ${FUNNEL_EMPHASES.join(", ")})`,
      ...["productCategories", "coreSegments", "includedSegments", "excludedSegments", "advertiserFacts", "uncertainties"].map((key) => field(key, brief[key])),
    ].join("\n"));
  }

  if (plan) {
    const channelLines = plan.channels.map((c, index) => {
      const p = `channelStrategy.mediaPlan.channels[${index}]`;
      return [
        `* ${c.channelName} (channelId: ${c.channelId}) - ${c.status}, ${c.allocationPercent}% = ${money(c.allocationDollars)}${locked.has(c.channelId) ? ", LOCKED" : ""}${c.manuallyForced ? ", added by a planner" : ""}`,
        `  recommended range: ${c.manuallyForced ? 1 : c.minimumAllocationPercent}-${c.maximumAllocationPercent}% of budget (a guide, not a limit), recommended minimum spend ${money(c.minimumTotalSpend)}; typical CPM ${c.typicalCpmLow != null ? `$${c.typicalCpmLow}-$${c.typicalCpmHigh}` : "not set"}; score ${c.recommendationScore}, confidence ${c.confidence}; role: ${clip(c.role, 200)}`,
        ...[plannerGuidanceField(planningSettings, c.channelId).plannerGuidance].filter(Boolean).map((notes) => `  planning team notes (internal, never quote to a client): ${clip(notes, 500)}`),
        `  [${p}.gapAddressed] ${clip(c.gapAddressed)}`,
        `  [${p}.allocationRationale] ${clip(c.allocationRationale)}`,
        ...(c.tradeoffs || []).map((t, i) => `  [${p}.tradeoffs[${i}]] ${clip(t, 400)}`),
        ...channelDetailLines(c, plan, strategy, planningSettings),
      ].filter(Boolean).join("\n");
    });
    // "Add on top of RFP": the RFP media types keep their RFP dollars outside plan.channels, so
    // the plan's total is more than the working media budget the channels below split.
    const combined = combinedPlan(strategy);
    const keptIds = new Set(combined.keptChannels.map((c) => c.channelId));
    if (combined.keptChannels.length) {
      out.push([
        `PLAN TOTAL ${money(combined.total)}: the RFP's media types kept at their RFP budgets (${money(combined.keptAtRfpBudget)}) plus the additional working media budget (${money(combined.allocatedBudget)}) allocated in the MEDIA PLAN below. Quote this total, and these shares, when asked what the plan spends.`,
        "RFP MEDIA TYPES KEPT AT THEIR RFP BUDGETS (in the plan, outside the allocation; their dollars are the RFP's and are not edited here):",
        ...combined.keptChannels.map((c) => `* ${c.channelName} (channelId: ${c.channelId}) - ${money(c.allocationDollars)}, ${c.allocationPercent}% of the plan total`),
      ].join("\n"));
    }
    // "Use the plan as is" can carry uploaded lines no media type covers; they are still the client's spend.
    if (combined.outsideCatalog.length) {
      out.push([
        `PLAN TOTAL ${money(combined.total)}: the uploaded plan as is, the MEDIA PLAN below (${money(combined.allocatedBudget)}) plus uploaded lines outside Digital Remedy's catalog (${money(combined.outsideCatalogBudget)}). Quote this total, and these shares, when asked what the plan spends.`,
        "UPLOADED LINES OUTSIDE THE CATALOG (in the plan at their uploaded dollars; not media types, so they cannot be edited or moved):",
        ...combined.outsideCatalog.map((c) => `* ${c.name} - ${money(c.dollars)}`),
      ].join("\n"));
    }
    out.push([
      `MEDIA PLAN (${combined.keptChannels.length ? "additional " : ""}working media budget ${money(plan.workingMediaBudget)}${plan.flightDays ? ` over ${plan.flightDays} days` : ""}; ${plan.channels.length} of at most ${plan.maxMediaTypes} media types; budget approach: ${BUDGET_STRATEGY_LABELS[normalizeBudgetStrategyMode(strategy.budgetStrategyMode)]}${strategy.additionalBudget ? ` (additional ${money(strategy.additionalBudget)})` : ""}${strategy.hasManualAllocationChanges ? "; allocations hand-edited" : ""}):`,
      ...channelLines,
    ].join("\n"));

    const addable = addableChannels(plan).filter((c) => !keptIds.has(c.product.id));
    if (addable.length) {
      out.push([
        "MEDIA TYPES THAT CAN BE ADDED (use add_channel with the channelId):",
        ...addable.map((c) => `* ${c.product.displayName} (channelId: ${c.product.id}) - ${c.status}, score ${c.recommendationScore}${c.eligibilityFailures.length ? `; engine concerns: ${c.eligibilityFailures.slice(0, 3).join("; ")}` : ""}${c.aiAssessed && c.gapAddressed ? `; ${clip(c.gapAddressed, 300)}` : ""}`),
      ].join("\n"));
    }
    const unavailable = plan.evaluatedCandidates.filter((c) => !plan.channels.some((ch) => ch.channelId === c.product.id) && !keptIds.has(c.product.id) && !addable.includes(c));
    if (unavailable.length) {
      out.push(`NOT AVAILABLE TO ADD (not sellable in the Digital Remedy catalog right now): ${unavailable.map((c) => c.product.displayName).join(", ")}`);
    }
  } else {
    out.push("MEDIA PLAN: this plan has no channel plan, so allocations and channels cannot be edited.");
  }

  const geo = buildGeoFootprint({ targeting: rehydrateGeoSnapshot(profile.geoTargeting), plannedBudget: plan ? combinedPlan(strategy).total : 0 });
  if (geo) {
    out.push([
      `GEO FOOTPRINT SECTION (${hidden.has("geo") ? "hidden from" : "shown on"} the share link; computed from the targeting, read-only): ${geo.title}, ${geo.scope === "dma" ? "DMA" : "State"} targeting, ${geo.households.toLocaleString("en-US")} TV households (${geo.usSharePct.toFixed(1)}% of US).`,
      ...geo.rows.map((row) => `* ${row.name}: ${row.households.toLocaleString("en-US")} TV households, ${row.sharePct}% of the footprint${row.budget !== undefined ? `, ${money(row.budget)} (budget split by households)` : ""}`),
      geo.scope === "dma" ? `- States the markets deliver into: ${geo.coveredStates.join(", ")}` : "- Delivery is limited to the targeted states.",
      ...geo.precision.map((target) => `- Precision targeting: ${target.label} -> ${target.action}`),
      "- There is no matched-market or holdout-state test design in this plan.",
    ].join("\n"));
  }

  const incrementality = incrementalityView({ strategy, kpis: list(payload.kpis), ctvPublishers: profile.ctvPublishers, threshold: planningSettings?.incrementalityMinMonthlySpend });
  if (incrementality?.metric) {
    out.push([
      `INCREMENTALITY MEASUREMENT (Digital Remedy's measurement product, not yet released. ${profile.shareIncrementality === true ? "A planner has turned it on for the share link" : "Shown to planners only; hidden from the share link"}. Explain it when asked; never write it into plan text or the executive summary, and never name its data vendors):`,
      `- ${incrementality.eligible ? "This plan qualifies, so it is included at no cost." : `This plan does not qualify yet: it spends ${money(incrementality.monthlySpend)}/mo and plans need ${money(incrementality.threshold)}/mo or more (${money(incrementality.shortfall)}/mo short).`} Qualifying plans have a performance KPI and spend at least the threshold per month (the whole plan's spend).`,
      "- How it works: every exposure is tied to a household across devices; lift compares exposed households with matched control households modeled from pre-campaign attributes, so it needs no PSA impressions, no ghost bids and no held-out markets; path analysis then splits the lift across media combinations, publisher order, frequency and timing.",
      `- The plan's KPI ${incrementality.kpi} is reported as ${incrementality.metric}; also reported: ${incrementality.otherMetrics.join(", ")}.`,
      `- Measured: ${incrementality.measured.map((line) => `${line.name} (${line.sharePct}%)`).join(", ") || "none"}; outside the measurement: ${incrementality.notMeasured.map((line) => `${line.name} (${line.sharePct}%)`).join(", ") || "none"}.`,
      ...incrementality.questions.map((question) => `- Question it will answer: ${question.text}`),
      "- No readouts exist yet: never state or estimate a lift, an incremental ROAS or any other result.",
    ].join("\n"));
  }

  const publishers: any[] = Array.isArray(profile.ctvPublishers) ? profile.ctvPublishers : [];
  if (publishers.length) {
    out.push(["CTV PUBLISHERS IN THE PLAN (remove with remove_ctv_publisher):",
      ...publishers.map((p, i) => `* ${clip(p.publisher, 100)} (${clip(p.category, 50)}) [ctvPublishers[${i}].why] ${clip(p.why, 500)}`)].join("\n"));
  }
  const inPlan = new Set(publishers.map((p) => String(p?.publisher ?? "").toLowerCase()));
  const catalog = publisherCatalog.filter((p) => p.enabled && !inPlan.has(p.name.toLowerCase())).slice(0, 80);
  if (catalog.length) {
    out.push(`CTV PUBLISHERS THAT CAN BE ADDED (add_ctv_publisher with the exact name): ${catalog.map((p) => `${p.name} (${p.category})`).join("; ")}`);
  }
  if (hasPublisherHighlights(profile)) {
    out.push(["PUBLISHER INSIGHTS PANEL (a headline and pillars; each pillar's icon and publishers are fixed):",
      ...publisherHighlightFields(profile).map((f) => `[${f.path}] ${clip(f.text, 300)}`)].join("\n"));
  } else if (profile.publisherInsights) out.push(`[publisherInsights] ${clip(profile.publisherInsights)}`);

  const personas: any[] = Array.isArray(profile.personas) ? profile.personas : [];
  if (personas.length) {
    out.push(["PERSONAS (change with update_persona, add_persona, remove_persona, naming the persona by name):",
      ...personas.map((p) => [
        `* ${clip(p.name, 100)}`,
        `  age: ${clip(p.age, 50)}; income: ${clip(p.income, 50)}; gender: ${clip(p.gender, 50)}`,
        `  watch: ${clip(p.watch, 400)}`,
        `  browse: ${clip(p.browse, 400)}`,
        `  buy: ${clip(p.buy, 400)}`,
        `  narrative: ${clip(p.narrative)}`,
      ].join("\n"))].join("\n"));
  }

  const segments: any[] = Array.isArray(profile.segmentRecommendations) ? profile.segmentRecommendations : [];
  out.push(segments.length
    ? ["AUDIENCE SEGMENTS (change with add_segment, edit_segment, remove_segment; name a segment by its segmentId):",
      ...segments.slice(0, 30).map((s) => `* ${clip(s.name, 120)} (segmentId: ${s.id}) - ${s.dimension}${s.tier ? `, ${s.tier}` : ""}; personas: ${(s.personaIndices || []).map((i: number) => personas[i]?.name).filter(Boolean).join(", ") || "none"}; why: ${clip(s.justification, 320)}`)].join("\n")
    : "AUDIENCE SEGMENTS: none yet (add with add_segment).");

  const narrative = [
    profile.intro ? `[intro] ${clip(profile.intro)}` : "",
    profile.audienceAnalysis ? `[audienceAnalysis] ${clip(profile.audienceAnalysis)}` : "",
    ...(Array.isArray(profile.takeaways) ? profile.takeaways : []).map((t: string, i: number) => `[takeaways[${i}]] ${clip(t, 600)}`),
    ...(Array.isArray(profile.recommendations) ? profile.recommendations : []).flatMap((r: any, i: number) => [
      `[recommendations[${i}].title] ${clip(r?.title, 200)}`,
      `[recommendations[${i}].action] ${clip(r?.action, 600)}`,
      `[recommendations[${i}].why] ${clip(r?.why, 600)}`,
      `[recommendations[${i}].channels] ${clip(r?.channels, 200)}`,
    ]),
  ].filter(Boolean);
  if (narrative.length) out.push(`NARRATIVE:\n${narrative.join("\n")}`);

  const charts = [
    profile.demographics?.overview ? `[demographics.overview] ${clip(profile.demographics.overview, 800)}` : "",
    profile.demographics?.geographyNotes ? `[demographics.geographyNotes] ${clip(profile.demographics.geographyNotes, 600)}` : "",
    profile.deviceTypeIndex?.overview ? `[deviceTypeIndex.overview] ${clip(profile.deviceTypeIndex.overview, 800)}` : "",
    profile.browserAndReach?.overview ? `[browserAndReach.overview] ${clip(profile.browserAndReach.overview, 800)}` : "",
    profile.temporalPatterns?.overview ? `[temporalPatterns.overview] ${clip(profile.temporalPatterns.overview, 800)}` : "",
    profile.temporalPatterns?.activationNotes ? `[temporalPatterns.activationNotes] ${clip(profile.temporalPatterns.activationNotes, 600)}` : "",
  ].filter(Boolean);
  if (charts.length) out.push(`CHART COMMENTARY (the chart figures themselves are read-only):\n${charts.join("\n")}`);

  const executiveBrief = profile.executiveBrief;
  if (executiveBrief?.sections?.length) {
    out.push(["EXECUTIVE SUMMARY (read-only; the planner regenerates it from the plan):",
      ...executiveBrief.sections.map((s: any) => `* ${clip(s.headline, 200)}: ${(s.bullets || []).map((b: any) => `${clip(b.lead, 80)} ${clip(b.text, 300)}`).join(" | ")}`)].join("\n"));
  }

  const audit = profile.auditResult;
  if (audit) {
    const open = (audit.findings || []).filter((f: any) => f?.status !== "resolved");
    out.push([
      `QA AUDIT: score ${audit.finalScore ?? audit.originalScore ?? "n/a"}/100${audit.qaBypassed ? " (QA was unavailable)" : ""}${audit.quickMode ? " (Quick mode: not audited)" : ""}.`,
      ...open.slice(0, 12).map((f: any) => `* ${f.severity} (${f.owner}): ${clip(f.issue, 400)} Fix: ${clip(f.fix, 300)}${f.paths?.length ? ` Fields: ${f.paths.join(", ")}` : ""}`),
    ].join("\n"));
  }

  const dossiers: any[] = Array.isArray(profile.researchSnapshot?.dossiers) ? profile.researchSnapshot.dossiers.filter((d: any) => !d?.failed && d?.text) : [];
  if (dossiers.length) {
    out.push(["RESEARCH THE PLAN WAS BUILT ON (excerpts; ground new personas, segments and claims in this, not in general knowledge):",
      ...dossiers.map((d) => `--- ${clip(d.label, 120)} ---\n${clip(d.text, MAX_DOSSIER_CHARS)}`)].join("\n"));
  }

  const sources: any[] = Array.isArray(profile.sources) ? profile.sources : [];
  if (sources.length) out.push(`SOURCES CITED: ${sources.slice(0, 20).map((s) => clip(s.name, 120)).join("; ")}`);
  out.push(`PLAN SECTIONS (show or hide on the client view with hide_section / show_section): ${Object.entries(PLAN_SECTIONS)
    .map(([key, section]) => `${key} = ${section.label} (${[key, ...section.aliases].some((k) => hidden.has(k)) ? "hidden" : "shown"})`).join("; ")}`);

  return out.join("\n\n");
}

const records = (list: unknown) => (Array.isArray(list) ? list : []).map((r: any) => `${clip(r?.displayName, 80)} [${r?.id}]`).join("; ") || "none";

/** A media type's attached records, what could be attached, and its detail panels' text. */
function channelDetailLines(channel: any, plan: MediaRecommendationPlan, strategy: any, settings: PlanningSettings | undefined): string[] {
  const candidate: any = plan.evaluatedCandidates.find((c) => c.product.id === channel.channelId);
  const options = candidate && settings ? channelRecordOptions(candidate.product, settings) : null;
  const override = strategy?.channelOverrides?.[channel.channelId];
  const lines: string[] = [];
  for (const type of CHANNEL_RECORD_TYPES) {
    const attached = new Set((channel[type] || []).map((r: any) => r?.id));
    const available = (options?.[type] || []).filter((o) => !attached.has(o.id)).slice(0, 12);
    lines.push(`  ${RECORD_LABELS[type]} (${type}): ${records(channel[type])}${available.length ? `; can add: ${available.map((o) => `${clip(o.displayName, 80)} [${o.id}]`).join("; ")}` : ""}`);
  }
  if (candidate?.activationGuidance) lines.push(`  panel activationGuidance: ${clip(candidate.activationGuidance, 600)}`);
  if (candidate?.measurementApproach) lines.push(`  panel measurementApproach: ${clip(candidate.measurementApproach, 600)}`);
  if (channel.decisionRule) lines.push(`  panel decisionRule: ${clip(channel.decisionRule, 400)}`);
  for (const [panel, edit] of Object.entries(override?.fieldEdits || {}) as Array<[string, any]>) {
    if (edit?.content !== undefined) lines.push(`  panel ${panel} is hand-edited to: ${clip(edit.content, 600)}`);
  }
  if (override?.hiddenPanels?.length) lines.push(`  hidden panels: ${override.hiddenPanels.join(", ")}`);
  return lines;
}

export const SCOUT_SYSTEM_INSTRUCTION = `You are ScoutAI, the senior media planner built into Digital Remedy's plan builder. A planner is reviewing a CTV-first media plan with you. You help them understand it, pressure-test it against what the client asked for, and improve it.

How you answer:
- Use only the plan, the Brief of Record, the original request, the research excerpts, the sources and, when given, the past campaign performance provided. If the plan does not contain something (a CPM it does not list, reach it did not estimate, a publisher it does not name), say so plainly. Never invent figures, research, benchmarks or expected results.
- Be concise: you are in a narrow side panel. Lead with the answer. Short paragraphs or a few bullets; markdown is fine in your reply (never in text you write into the plan); no tables. Refer to media types by name, never by channelId or segmentId.
- Check the plan against the original request and the Brief of Record when it matters: budget, KPIs, audience, geography, RFP asks. Point out conflicts the planner may not have noticed.
- Channel numbers come from Digital Remedy's planning engine and its catalog guides (recommended ranges, minimum spend). Explain them from the plan's rationale. The ranges guide the recommendation but do not limit the planner: when asked, set any whole percentage from 0% to 100%, and mention it when a figure falls outside the recommended range. Some media types carry the planning team's internal notes on when to include, skip or lean on them: use them to explain or question a choice, but never write them into the plan or present them as research.

How you edit:
- You never change the plan directly. You return a proposal; the planner sees the exact computed result and approves it before anything is saved. Say in the reply what you are proposing; never claim it is done.
- A proposal is a list of items. Each item is one self-contained recommendation the planner can accept or leave out: a short title, why it helps (tied to the KPIs, the Brief of Record or the research, never a promised lift or number), and its operations.
  * A direct request ("move 2% from Search to Native", "replace this persona") is one item.
  * When asked what you would change or how to improve the plan, return several independent items (usually 2 to 5), ordered by impact, so the planner can pick. Keep each item independent: it should make sense on its own.
- Propose when the planner asks for a change, asks for recommendations, or agrees to one you suggested. If a request is too vague to act on well, you may propose your best reading and say what you assumed.
- Operations. Use the exact channelId, segmentId, persona names, field keys and paths shown in the plan:
  * set_allocation {channelId, percent}: any whole percentage from 0 to 100. Channels you do not set keep their allocation unless your targets do not add up, in which case they absorb the difference in proportion; LOCKED channels never move. To move budget between channels, set both, and set only the channels that should change.
  * add_channel {channelId} / remove_channel {channelId}: only media types listed as addable can be added.
  * lock_channel / unlock_channel {channelId}
  * set_budget {amount}: the working media budget in dollars.
  * remove_ctv_publisher {publisher}
  * edit_text {path, value}: 'path' is one of the bracketed paths shown in the plan; 'value' is the field's complete new text in the plan's voice. See "Text you write into the plan" below.
  * update_persona {persona, fields}: 'persona' is the current name; 'fields' holds only what changes, from name, age, income, gender, watch, browse, buy, narrative. Replacing a persona is update_persona with every field, including a new name; the headshot is regenerated automatically.
  * add_persona {fields} with all eight fields / remove_persona {persona}
  * add_segment {name, dimension, justification, tier, personas}: dimension is one of ${SEGMENT_DIMENSIONS.join(", ")}; tier is one of ${SEGMENT_TIERS.join(", ")}; personas lists the persona names it serves.
  * edit_segment {segmentId, and any of name, dimension, justification, tier, personas} / remove_segment {segmentId}
  * edit_brief {field, value} for a text or choice field, or {field, values} for a list field, using the Brief of Record's field keys.
  * set_kpis {values}: the complete new KPI list.
  * set_geography {value}: "United States", or "State: " or "DMA: " followed by a comma-separated list.
  * add_takeaway {value, position} / remove_takeaway {index}: index is the number in the takeaway's path (takeaways[2] is index 2); position is where it goes, 0 for the top, omitted for the end.
  * add_recommendation {title, action, why, channels, position} / remove_recommendation {index}
  * move_item {list, index, position}: list is "takeaways" or "recommendations". All indexes refer to the lists as shown, even when the same proposal adds or removes items.
  * add_ctv_publisher {publisher, why}: only a publisher listed as one that can be added, with a one-sentence reason it fits this audience.
  * hide_section {section} / show_section {section}: hides or shows a section of the client view; section is one of the section keys shown (for example "domainAffinity").
  * add_channel_record {channelId, recordType, recordId, rationale} / remove_channel_record {channelId, recordType, recordId}: recordType is one of ${CHANNEL_RECORD_TYPES.join(", ")}; recordId is the id in brackets. Only records listed under "can add" for that media type can be added; rationale is one sentence on why it fits this plan. A CTV media type's publishers are the plan's CTV publisher list: use add_ctv_publisher / remove_ctv_publisher for those.
  * edit_channel_panel {channelId, panel, content} / hide_channel_panel {channelId, panel} / show_channel_panel {channelId, panel}: rewrites or hides the text a media type's detail panel shows. panel is one of ${Object.keys(CHANNEL_PANELS).join(", ")}. Use it for activationGuidance, measurementApproach and decisionRule; to reword gapAddressed or the allocation rationale use edit_text on the channel's path; to change a list (targeting, measurement and so on) change its records instead of its text.
- Text you write into the plan (edit_text values, edit_channel_panel content) is plain text shown as-is on the plan, slides and exports. Never use markdown in it: no asterisks, bold, italics or headers.
  * Bullets, when the planner asks for them or a list clearly reads better: an optional one-sentence lead-in, then one bullet per line, each line starting with "- ", separated by real line breaks. A bullet may open with a short label and a colon ("- Family co-viewing (Hulu, Peacock): one sentence."). Keep each bullet to one sentence of about 20 words.
  * Only paragraph fields take bullets: intro, audienceAnalysis, publisherInsights and a media type's panel text. Takeaways, recommendation fields, a publisher's "why", trade-offs and evidence stay a single sentence.
  * Keep a field near its current length unless the planner asks otherwise. publisherInsights is at most about 65 words, bullets included, because it has to fit its slide.
  * The publisher insights panel's headline (at most 8 words), pillar titles (at most 5 words) and pillar details (one sentence, at most 16 words) are single lines: no bullets.
- Numbers: never compute or state the resulting dollars, percentages or totals; the card shows the computed result. You may state the targets you asked for.
- New personas and segments must fit the Brief of Record and rest on the research excerpts. When you change the Brief of Record, KPIs or geography, say that the research, personas and channels were built from the earlier version and that regenerating the plan rebuilds them.
- The executive summary is written from the plan by its own generator. To change it, return "rewriteExecutiveSummary" with instructions for that generator (for example "lead with CTV reach; keep it to four sections") instead of a proposal item; the planner runs it with one click and can undo it in the summary.
- Not editable here: chart figures, research, budget mode and flight length (regenerate the plan). There is no persona editor in the app: persona changes go through you.
- The conversation shows what happened to earlier proposals. An applied proposal is already in the plan you are reading.

Return JSON: { "reply": markdown for the planner, "proposal": { "summary": one short line, "items": [{ "title", "why", "evidence" (only when the item rests on past performance), "ops": [...] }] }, "rewriteExecutiveSummary": { "instructions" } }. Omit "proposal" and "rewriteExecutiveSummary" when you are not proposing them.`;

// Each operation has its own shape, offered to the model as alternatives. One flat shape with
// every field optional did not hold up: Gemini dropped the fields particular operations need
// (recordId, content, rationale) and put the value in whichever generic field it favoured, or
// left it empty. With a shape per operation, its required fields are required.
const S = { type: "string" };
const INT = { type: "integer" };
const oneOf = (values: readonly string[]) => ({ type: "string", enum: [...values] });
const opShape = (type: string, required: Record<string, unknown>, optional: Record<string, unknown> = {}) => ({
  type: "object",
  properties: { type: oneOf([type]), ...required, ...optional },
  required: ["type", ...Object.keys(required)],
});
const PERSONA_KEYS = ["name", "age", "income", "gender", "watch", "browse", "buy", "narrative"];
const personaFields = (allRequired: boolean) => ({
  type: "object",
  properties: Object.fromEntries(PERSONA_KEYS.map((f) => [f, S])),
  ...(allRequired ? { required: PERSONA_KEYS } : {}),
});
const channelPanels = oneOf(Object.keys(CHANNEL_PANELS));

const opSchema = {
  anyOf: [
    opShape("set_allocation", { channelId: S, percent: INT }),
    ...["add_channel", "remove_channel", "lock_channel", "unlock_channel"].map((type) => opShape(type, { channelId: S })),
    opShape("set_budget", { amount: { type: "number" } }),
    opShape("remove_ctv_publisher", { publisher: S }),
    opShape("add_ctv_publisher", { publisher: S, why: S }),
    opShape("edit_text", { path: S, value: S }),
    opShape("update_persona", { persona: S, fields: personaFields(false) }),
    opShape("add_persona", { fields: personaFields(true) }),
    opShape("remove_persona", { persona: S }),
    opShape("add_segment", { name: S, dimension: oneOf(SEGMENT_DIMENSIONS), justification: S }, { tier: oneOf(SEGMENT_TIERS), personas: { type: "array", items: S } }),
    opShape("edit_segment", { segmentId: S }, { name: S, dimension: oneOf(SEGMENT_DIMENSIONS), justification: S, tier: oneOf(SEGMENT_TIERS), personas: { type: "array", items: S } }),
    opShape("remove_segment", { segmentId: S }),
    opShape("edit_brief", { field: S }, { value: S, values: { type: "array", items: S } }),
    opShape("set_kpis", { values: { type: "array", items: S } }),
    opShape("set_geography", { value: S }),
    opShape("add_takeaway", { value: S }, { position: INT }),
    opShape("remove_takeaway", { index: INT }),
    opShape("add_recommendation", { title: S, action: S, why: S, channels: S }, { position: INT }),
    opShape("remove_recommendation", { index: INT }),
    opShape("move_item", { list: oneOf(["takeaways", "recommendations"]), index: INT, position: INT }),
    opShape("hide_section", { section: oneOf(Object.keys(PLAN_SECTIONS)) }),
    opShape("show_section", { section: oneOf(Object.keys(PLAN_SECTIONS)) }),
    opShape("add_channel_record", { channelId: S, recordType: oneOf(CHANNEL_RECORD_TYPES), recordId: S, rationale: S }),
    opShape("remove_channel_record", { channelId: S, recordType: oneOf(CHANNEL_RECORD_TYPES), recordId: S }),
    opShape("edit_channel_panel", { channelId: S, panel: channelPanels, content: S }),
    opShape("hide_channel_panel", { channelId: S, panel: channelPanels }),
    opShape("show_channel_panel", { channelId: S, panel: channelPanels }),
    opShape("add_learning", { campaignId: S, findingId: S, learning: S, action: S }, { position: INT }),
    opShape("edit_learning", { index: INT }, { learning: S, action: S }),
    opShape("remove_learning", { index: INT }),
    opShape("mark_recap_recommendation", { id: S }),
    opShape("remove_recap_item", { kind: oneOf(["card", "recommendation"]), id: S }),
    opShape("set_recap_block", { campaignId: S, block: oneOf([...RECAP_BLOCKS]), hidden: { type: "boolean" } }),
    opShape("set_recap_kpi", { campaignId: S, metric: oneOf([...KPI_METRICS]) }),
  ],
};

export const scoutResponseSchema = {
  type: "object",
  properties: {
    reply: { type: "string" },
    proposal: {
      type: "object",
      properties: {
        summary: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              why: { type: "string" },
              evidence: { type: "string" },
              ops: { type: "array", items: opSchema },
            },
            required: ["title", "why", "ops"],
          },
        },
      },
      required: ["summary", "items"],
    },
    rewriteExecutiveSummary: {
      type: "object",
      properties: { instructions: { type: "string" } },
      required: ["instructions"],
    },
    needsFullData: { type: "string", description: "Leave empty. Only when the campaign data is marked SUMMARY and a proper answer needs rows it does not show, say which (e.g. 'publisher rows for ESPN and Hulu'); the question is then answered again with the full data, and this reply is discarded." },
  },
  required: ["reply"],
};

export function buildScoutInput(context: string, turns: ChatTurn[], performance = ""): string {
  const history = turns.slice(0, -1).map((turn) => {
    const note = turn.proposal ? `\n(Proposed: ${turn.proposal.summary} - ${turn.proposal.status})` : "";
    return `${turn.role === "user" ? "PLANNER" : "SCOUTAI"}: ${turn.text}${note}`;
  });
  const latest = turns[turns.length - 1];
  return [
    "THE PLAN (as currently saved):",
    context,
    performance,
    history.length ? `CONVERSATION SO FAR:\n${history.join("\n\n")}` : "",
    `PLANNER'S LATEST MESSAGE:\n${latest?.text ?? ""}`,
  ].filter(Boolean).join("\n\n");
}

export interface ScoutItem {
  title: string;
  why: string;
  /** The past-performance figures an item rests on, when it rests on any. */
  evidence: string | null;
  ops: AssistantOp[];
  rejected: RejectedOp[];
}

export interface ScoutResponse {
  reply: string;
  summary: string | null;
  items: ScoutItem[];
  /** Instructions for the executive summary generator, which the planner runs with one click. */
  executiveSummaryInstructions: string | null;
  /** Set when the model read summary campaign data and needs the full rows to answer. */
  needsFullData: string | null;
}

const MAX_ITEMS = 6;

export function normalizeScoutResponse(raw: any): ScoutResponse {
  const reply = typeof raw?.reply === "string" && raw.reply.trim() ? raw.reply.trim() : "I couldn't put an answer together. Try asking again.";
  const items: ScoutItem[] = (Array.isArray(raw?.proposal?.items) ? raw.proposal.items : []).slice(0, MAX_ITEMS).map((item: any) => {
    const { ops, rejected } = parseOps(item?.ops);
    return { title: clip(item?.title, 160) || "Proposed change", why: clip(item?.why, 600), evidence: clip(item?.evidence, 600) || null, ops, rejected };
  });
  const usable = items.filter((item) => item.ops.length > 0);
  const summary = typeof raw?.proposal?.summary === "string" ? clip(raw.proposal.summary, 200) : "";
  const instructions = clip(raw?.rewriteExecutiveSummary?.instructions, MAX_BRIEF_INSTRUCTIONS);
  return { reply, summary: usable.length ? summary || usable[0].title : null, items, executiveSummaryInstructions: instructions || null, needsFullData: clip(raw?.needsFullData, 300) || null };
}
