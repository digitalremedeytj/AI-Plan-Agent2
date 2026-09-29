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
import { MAX_BRIEF_INSTRUCTIONS } from "../research/executiveBrief";
import type { MediaRecommendationPlan } from "../planning/types";

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
const names = (records: unknown, max = 6) => (Array.isArray(records) ? records.slice(0, max).map((r: any) => r?.displayName || r?.name).filter(Boolean).join(", ") : "");

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
export function buildPlanContext(stored: { title?: string; advertiserName?: string; payload?: any }, { publisherCatalog = [] }: { publisherCatalog?: CatalogPublisher[] } = {}): string {
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
        `  limits: ${c.manuallyForced ? 1 : c.minimumAllocationPercent}-${c.maximumAllocationPercent}% of budget, minimum spend ${money(c.minimumTotalSpend)}; typical CPM ${c.typicalCpmLow != null ? `$${c.typicalCpmLow}-$${c.typicalCpmHigh}` : "not set"}; score ${c.recommendationScore}, confidence ${c.confidence}; role: ${clip(c.role, 200)}`,
        `  [${p}.gapAddressed] ${clip(c.gapAddressed)}`,
        `  [${p}.allocationRationale] ${clip(c.allocationRationale)}`,
        ...(c.tradeoffs || []).map((t, i) => `  [${p}.tradeoffs[${i}]] ${clip(t, 400)}`),
        names(c.targetingTactics) ? `  targeting: ${names(c.targetingTactics)}` : "",
        names(c.publishers) ? `  publishers: ${names(c.publishers)}` : "",
        names(c.measurementCapabilities) ? `  measurement: ${names(c.measurementCapabilities)}` : "",
      ].filter(Boolean).join("\n");
    });
    out.push([
      `MEDIA PLAN (working media budget ${money(plan.workingMediaBudget)}${plan.flightDays ? ` over ${plan.flightDays} days` : ""}; ${plan.channels.length} of at most ${plan.maxMediaTypes} media types; budget mode: ${strategy.budgetStrategyMode || "reallocation"}${strategy.hasManualAllocationChanges ? "; allocations hand-edited" : ""}):`,
      ...channelLines,
    ].join("\n"));

    const addable = addableChannels(plan);
    if (addable.length) {
      out.push([
        "MEDIA TYPES THAT CAN BE ADDED (use add_channel with the channelId):",
        ...addable.map((c) => `* ${c.product.displayName} (channelId: ${c.product.id}) - ${c.status}, score ${c.recommendationScore}${c.eligibilityFailures.length ? `; engine concerns: ${c.eligibilityFailures.slice(0, 3).join("; ")}` : ""}${c.aiAssessed && c.gapAddressed ? `; ${clip(c.gapAddressed, 300)}` : ""}`),
      ].join("\n"));
    }
    const unavailable = plan.evaluatedCandidates.filter((c) => !plan.channels.some((ch) => ch.channelId === c.product.id) && !addable.includes(c));
    if (unavailable.length) {
      out.push(`NOT AVAILABLE TO ADD (not sellable in the Digital Remedy catalog right now): ${unavailable.map((c) => c.product.displayName).join(", ")}`);
    }
  } else {
    out.push("MEDIA PLAN: this plan has no channel plan, so allocations and channels cannot be edited.");
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
  if (profile.publisherInsights) out.push(`[publisherInsights] ${clip(profile.publisherInsights)}`);

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

export const SCOUT_SYSTEM_INSTRUCTION = `You are ScoutAI, the senior media planner built into Digital Remedy's plan builder. A planner is reviewing a CTV-first media plan with you. You help them understand it, pressure-test it against what the client asked for, and improve it.

How you answer:
- Use only the plan, the Brief of Record, the original request, the research excerpts and the sources provided. If the plan does not contain something (a CPM it does not list, reach it did not estimate, a publisher it does not name), say so plainly. Never invent figures, research, benchmarks or expected results.
- Be concise: you are in a narrow side panel. Lead with the answer. Short paragraphs or a few bullets; markdown is fine; no tables. Refer to media types by name, never by channelId or segmentId.
- Check the plan against the original request and the Brief of Record when it matters: budget, KPIs, audience, geography, RFP asks. Point out conflicts the planner may not have noticed.
- Channel numbers come from Digital Remedy's planning engine and its catalog rules (minimums, maximums, minimum spend). Explain them from the plan's rationale and limits; do not second-guess the catalog.

How you edit:
- You never change the plan directly. You return a proposal; the planner sees the exact computed result and approves it before anything is saved. Say in the reply what you are proposing; never claim it is done.
- A proposal is a list of items. Each item is one self-contained recommendation the planner can accept or leave out: a short title, why it helps (tied to the KPIs, the Brief of Record or the research, never a promised lift or number), and its operations.
  * A direct request ("move 2% from Search to Native", "replace this persona") is one item.
  * When asked what you would change or how to improve the plan, return several independent items (usually 2 to 5), ordered by impact, so the planner can pick. Keep each item independent: it should make sense on its own.
- Propose when the planner asks for a change, asks for recommendations, or agrees to one you suggested. If a request is too vague to act on well, you may propose your best reading and say what you assumed.
- Operations. Use the exact channelId, segmentId, persona names, field keys and paths shown in the plan:
  * set_allocation {channelId, percent}: a whole percentage. Channels you do not set keep their allocation unless your targets do not add up, in which case they absorb the difference in proportion; LOCKED channels never move. To move budget between channels, set both, and set only the channels that should change.
  * add_channel {channelId} / remove_channel {channelId}: only media types listed as addable can be added.
  * lock_channel / unlock_channel {channelId}
  * set_budget {amount}: the working media budget in dollars.
  * remove_ctv_publisher {publisher}
  * edit_text {path, value}: 'path' is one of the bracketed paths shown in the plan; 'value' is the field's complete new text in the plan's voice.
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
- Numbers: never compute or state the resulting dollars, percentages or totals; the card shows the computed result. You may state the targets you asked for.
- New personas and segments must fit the Brief of Record and rest on the research excerpts. When you change the Brief of Record, KPIs or geography, say that the research, personas and channels were built from the earlier version and that regenerating the plan rebuilds them.
- The executive summary is written from the plan by its own generator. To change it, return "rewriteExecutiveSummary" with instructions for that generator (for example "lead with CTV reach; keep it to four sections") instead of a proposal item; the planner runs it with one click and can undo it in the summary.
- Not editable here: chart figures, research, channel tactics, measurement and panel details, budget mode and flight length (regenerate the plan). There is no persona editor in the app: persona changes go through you.
- The conversation shows what happened to earlier proposals. An applied proposal is already in the plan you are reading.

Return JSON: { "reply": markdown for the planner, "proposal": { "summary": one short line, "items": [{ "title", "why", "ops": [...] }] }, "rewriteExecutiveSummary": { "instructions" } }. Omit "proposal" and "rewriteExecutiveSummary" when you are not proposing them.`;

const opSchema = {
  type: "object",
  properties: {
    type: { type: "string", description: "set_allocation | add_channel | remove_channel | lock_channel | unlock_channel | set_budget | remove_ctv_publisher | edit_text | update_persona | add_persona | remove_persona | add_segment | edit_segment | remove_segment | edit_brief | set_kpis | set_geography | add_takeaway | remove_takeaway | add_recommendation | remove_recommendation | move_item | hide_section | show_section | add_ctv_publisher" },
    channelId: { type: "string" },
    percent: { type: "integer" },
    amount: { type: "number" },
    publisher: { type: "string" },
    path: { type: "string" },
    value: { type: "string" },
    persona: { type: "string" },
    fields: {
      type: "object",
      properties: Object.fromEntries(["name", "age", "income", "gender", "watch", "browse", "buy", "narrative"].map((f) => [f, { type: "string" }])),
    },
    segmentId: { type: "string" },
    name: { type: "string" },
    dimension: { type: "string" },
    justification: { type: "string" },
    tier: { type: "string" },
    personas: { type: "array", items: { type: "string" } },
    field: { type: "string" },
    values: { type: "array", items: { type: "string" } },
    index: { type: "integer" },
    position: { type: "integer" },
    list: { type: "string" },
    section: { type: "string" },
    hidden: { type: "boolean" },
    title: { type: "string" },
    action: { type: "string" },
    why: { type: "string" },
    channels: { type: "string" },
  },
  required: ["type"],
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
  },
  required: ["reply"],
};

export function buildScoutInput(context: string, turns: ChatTurn[]): string {
  const history = turns.slice(0, -1).map((turn) => {
    const note = turn.proposal ? `\n(Proposed: ${turn.proposal.summary} - ${turn.proposal.status})` : "";
    return `${turn.role === "user" ? "PLANNER" : "SCOUTAI"}: ${turn.text}${note}`;
  });
  const latest = turns[turns.length - 1];
  return [
    "THE PLAN (as currently saved):",
    context,
    history.length ? `CONVERSATION SO FAR:\n${history.join("\n\n")}` : "",
    `PLANNER'S LATEST MESSAGE:\n${latest?.text ?? ""}`,
  ].filter(Boolean).join("\n\n");
}

export interface ScoutItem {
  title: string;
  why: string;
  ops: AssistantOp[];
  rejected: RejectedOp[];
}

export interface ScoutResponse {
  reply: string;
  summary: string | null;
  items: ScoutItem[];
  /** Instructions for the executive summary generator, which the planner runs with one click. */
  executiveSummaryInstructions: string | null;
}

const MAX_ITEMS = 6;

export function normalizeScoutResponse(raw: any): ScoutResponse {
  const reply = typeof raw?.reply === "string" && raw.reply.trim() ? raw.reply.trim() : "I couldn't put an answer together. Try asking again.";
  const items: ScoutItem[] = (Array.isArray(raw?.proposal?.items) ? raw.proposal.items : []).slice(0, MAX_ITEMS).map((item: any) => {
    const { ops, rejected } = parseOps(item?.ops);
    return { title: clip(item?.title, 160) || "Proposed change", why: clip(item?.why, 600), ops, rejected };
  });
  const usable = items.filter((item) => item.ops.length > 0);
  const summary = typeof raw?.proposal?.summary === "string" ? clip(raw.proposal.summary, 200) : "";
  const instructions = clip(raw?.rewriteExecutiveSummary?.instructions, MAX_BRIEF_INSTRUCTIONS);
  return { reply, summary: usable.length ? summary || usable[0].title : null, items, executiveSummaryInstructions: instructions || null };
}
