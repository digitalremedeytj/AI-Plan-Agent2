// The edits ScoutAI may propose. The model never writes the plan: it names an operation ("set CTV
// to 30%") and this module performs it with the same functions the manual controls use, so a
// proposal can only produce a plan a planner could have produced by hand. Allocations stay whole
// percentages at exactly 100%, locks and floors hold, and the dollars are computed, not written.
//
// The planner sees the diff this module computes from the result, not the model's description of
// it, so the before/after on the approval card is always what Apply will save.

import {
  addMediaTypeAndRebalance,
  allocationBasisPoints,
  allocationsEqual,
  applyBasisPointAllocations,
  effectiveBounds,
  rebalanceBasisPoints,
  removeMediaTypeAndRebalance,
  type AllocationBasisPoints,
} from "../planning/manualAllocations";
import type { MediaRecommendationPlan } from "../planning/types";
import { getAtPath, writeProseField } from "../qa/planRemediation";
import { normalizePlanText } from "../utils/planText";
import { applyAudienceOps, applyBriefOps, PERSONA_FIELDS, type PersonaFields } from "./profileOps";
import { applyListOps, applySectionOps, NARRATIVE_LISTS, type NarrativeList } from "./narrativeOps";
import { syncCtvChannelPublishers } from "../planning/ctvChannel";
import { applyChannelDetailOps } from "./channelDetailOps";
import { applyLearningOps, type LearningCampaign } from "./learningOps";
import { applyRecapOps } from "./recapOps";
import type { PlanningSettings } from "../planning/settings";

export type AssistantOp =
  | { type: "set_allocation"; channelId: string; percent: number }
  | { type: "add_channel"; channelId: string }
  | { type: "remove_channel"; channelId: string }
  | { type: "set_budget"; amount: number }
  | { type: "lock_channel"; channelId: string }
  | { type: "unlock_channel"; channelId: string }
  | { type: "remove_ctv_publisher"; publisher: string }
  | { type: "edit_text"; path: string; value: string }
  // `avatar` comes only from a revert, putting back the headshot a rename replaced.
  | { type: "update_persona"; persona: string; fields: PersonaFields; avatar?: { avatarUrl?: string; avatarHistory?: unknown } }
  | { type: "add_persona"; fields: PersonaFields }
  | { type: "remove_persona"; persona: string }
  | { type: "add_segment"; name: string; dimension: string; justification: string; tier?: string; personas?: string[] }
  | { type: "edit_segment"; segmentId: string; name?: string; dimension?: string; justification?: string; tier?: string; personas?: string[] }
  | { type: "remove_segment"; segmentId: string }
  | { type: "edit_brief"; field: string; value?: string; values?: string[] }
  | { type: "set_kpis"; values: string[] }
  // `config` comes only from a revert, restoring the structured geography picker state.
  | { type: "set_geography"; value: string; config?: unknown }
  | { type: "add_takeaway"; value: string; position?: number }
  | { type: "remove_takeaway"; index: number }
  | { type: "add_recommendation"; title: string; action: string; why: string; channels: string; position?: number }
  | { type: "remove_recommendation"; index: number }
  | { type: "move_item"; list: NarrativeList; index: number; position: number }
  | { type: "set_section_visibility"; section: string; hidden: boolean }
  | { type: "hide_section"; section: string }
  | { type: "show_section"; section: string }
  | { type: "add_ctv_publisher"; publisher: string; why: string }
  | { type: "add_channel_record"; channelId: string; recordType: string; recordId: string; rationale?: string }
  | { type: "remove_channel_record"; channelId: string; recordType: string; recordId: string }
  | { type: "edit_channel_panel"; channelId: string; panel: string; content: string }
  | { type: "hide_channel_panel"; channelId: string; panel: string }
  | { type: "show_channel_panel"; channelId: string; panel: string }
  | { type: "add_learning"; campaignId: string; findingId: string; learning: string; action: string; position?: number }
  | { type: "edit_learning"; index: number; learning?: string; action?: string }
  | { type: "remove_learning"; index: number }
  // Restores come only from a revert: they put back exactly what a change removed, which the
  // model has no way to describe (a publisher from the catalog, a persona's headshot).
  | { type: "restore_ctv_publisher"; publisher: string; category: string; why: string; index: number; isUserAdded?: boolean }
  | { type: "restore_persona"; index: number; persona: any; segmentIds: string[] }
  | { type: "restore_segment"; index: number; segment: any; personas: string[] }
  | { type: "set_list"; list: NarrativeList; items: any[] }
  | { type: "set_channel_records"; channelId: string; recordType: string; records: any[] }
  | { type: "set_channel_override"; channelId: string; override: any | null }
  | { type: "set_learnings"; items: any[] }
  // The Campaign Recap (see recapOps): marking a recommendation applied, removing a card or
  // recommendation, and the restore an undo uses.
  | { type: "mark_recap_recommendation"; id: string; applied: boolean }
  | { type: "remove_recap_item"; kind: "card" | "recommendation"; id: string }
  | { type: "set_campaign_recap"; recap: any | null };

export type AssistantOpType = AssistantOp["type"];

export const MODEL_OP_TYPES: ReadonlySet<AssistantOpType> = new Set([
  "set_allocation", "add_channel", "remove_channel", "set_budget", "lock_channel", "unlock_channel", "remove_ctv_publisher", "edit_text",
  "update_persona", "add_persona", "remove_persona", "add_segment", "edit_segment", "remove_segment", "edit_brief", "set_kpis", "set_geography",
  "add_takeaway", "remove_takeaway", "add_recommendation", "remove_recommendation", "move_item", "set_section_visibility", "hide_section", "show_section", "add_ctv_publisher",
  "add_channel_record", "remove_channel_record", "edit_channel_panel", "hide_channel_panel", "show_channel_panel",
  "add_learning", "edit_learning", "remove_learning", "mark_recap_recommendation", "remove_recap_item",
]);
const RESTORE_OP_TYPES: ReadonlySet<AssistantOpType> = new Set(["restore_ctv_publisher", "restore_persona", "restore_segment", "set_list", "set_channel_records", "set_channel_override", "set_learnings", "set_campaign_recap"]);

/** A CTV publisher the plan may add: the shared publisher catalog, as settings store it. */
export interface CatalogPublisher {
  name: string;
  category: string;
  enabled: boolean;
}

export interface ApplyContext {
  /** Needed only to add CTV publishers; without it, adding one is refused. */
  publisherCatalog?: CatalogPublisher[];
  /** The settings the plan was built with, whose catalog channel records are added from. */
  planningSettings?: PlanningSettings;
  /** Past campaigns linked to the plan, which client learnings are drawn from. */
  learningCampaigns?: LearningCampaign[];
}

export interface ProposalChange {
  kind:
    | "allocation" | "channel_added" | "channel_removed" | "budget" | "lock" | "publisher" | "text"
    | "persona" | "persona_added" | "persona_removed" | "segment" | "segment_added" | "segment_removed" | "brief" | "input"
    | "item_added" | "item_removed" | "item_moved" | "section" | "channel_detail";
  label: string;
  before: string;
  after: string;
  /** Set on channel changes so the plan view can highlight the row. */
  channelId?: string;
  /** Set on text changes so the plan view can highlight the field. */
  path?: string;
}

export interface RejectedOp {
  op: unknown;
  reason: string;
}

export interface OpsResult {
  /** A new payload; the input is never mutated. */
  payload: any;
  ops: AssistantOp[];
  changes: ProposalChange[];
  rejected: RejectedOp[];
  /** Operations that undo this change set when applied to the resulting plan. */
  revertOps: AssistantOp[];
}

const MAX_OPS = 30;

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const strList = (value: unknown): string[] | undefined => (Array.isArray(value) ? value.map(str).filter(Boolean) : undefined);
const personaFields = (value: unknown): PersonaFields => {
  const out: PersonaFields = {};
  if (value && typeof value === "object") for (const field of PERSONA_FIELDS) { const v = str((value as any)[field]); if (v) out[field] = v; }
  return out;
};

/** Parses untrusted operations (from the model or the browser). Unknown shapes are rejected, never guessed at. */
export function parseOps(raw: unknown, { allowRestore = false } = {}): { ops: AssistantOp[]; rejected: RejectedOp[] } {
  const ops: AssistantOp[] = [];
  const rejected: RejectedOp[] = [];
  const list = Array.isArray(raw) ? raw : [];
  for (const item of list.slice(0, MAX_OPS)) {
    const type = str((item as any)?.type) as AssistantOpType;
    const reject = (reason: string) => rejected.push({ op: item, reason });
    if (!MODEL_OP_TYPES.has(type) && !(allowRestore && RESTORE_OP_TYPES.has(type))) { reject(`unknown operation "${type}"`); continue; }
    const channelId = str((item as any).channelId);
    const it = item as any;
    switch (type) {
      case "set_allocation": {
        const percent = Number((item as any).percent);
        if (!channelId || !Number.isFinite(percent)) { reject("needs a channelId and a percent"); break; }
        if (!Number.isInteger(percent)) { reject("allocations are whole percentages"); break; }
        if (percent < 1 || percent > 100) { reject("allocation must be between 1% and 100%"); break; }
        ops.push({ type, channelId, percent });
        break;
      }
      case "add_channel":
      case "remove_channel":
      case "lock_channel":
      case "unlock_channel":
        if (!channelId) { reject("needs a channelId"); break; }
        ops.push({ type, channelId });
        break;
      case "set_budget": {
        const amount = Math.round(Number((item as any).amount) * 100) / 100;
        if (!Number.isFinite(amount) || amount <= 0) { reject("budget must be a positive dollar amount"); break; }
        ops.push({ type, amount });
        break;
      }
      case "remove_ctv_publisher": {
        const publisher = str((item as any).publisher);
        if (!publisher) { reject("needs a publisher name"); break; }
        ops.push({ type, publisher });
        break;
      }
      case "edit_text": {
        const path = str((item as any).path);
        // Plan text is plain text; a revert restores exactly what was there.
        const value = allowRestore ? str((item as any).value) : normalizePlanText(str((item as any).value));
        if (!path || !value) { reject("needs a path and a value"); break; }
        ops.push({ type, path, value });
        break;
      }
      case "restore_ctv_publisher": {
        const publisher = str((item as any).publisher);
        const index = Number((item as any).index);
        if (!publisher || !Number.isInteger(index) || index < 0) { reject("needs a publisher and an index"); break; }
        ops.push({ type, publisher, category: str((item as any).category), why: str((item as any).why), index, isUserAdded: Boolean((item as any).isUserAdded) });
        break;
      }
      case "update_persona": {
        const persona = str(it.persona);
        const fields = personaFields(it.fields);
        if (!persona || Object.keys(fields).length === 0) { reject("needs a persona name and the fields to change"); break; }
        const avatar = allowRestore && it.avatar && typeof it.avatar === "object"
          ? { avatarUrl: typeof it.avatar.avatarUrl === "string" ? it.avatar.avatarUrl : undefined, avatarHistory: Array.isArray(it.avatar.avatarHistory) ? it.avatar.avatarHistory : undefined }
          : undefined;
        ops.push({ type, persona, fields, ...(avatar ? { avatar } : {}) });
        break;
      }
      case "add_persona":
        ops.push({ type, fields: personaFields(it.fields) });
        break;
      case "remove_persona": {
        const persona = str(it.persona);
        if (!persona) { reject("needs a persona name"); break; }
        ops.push({ type, persona });
        break;
      }
      case "add_segment": {
        const name = str(it.name);
        if (!name) { reject("needs a segment name"); break; }
        ops.push({ type, name, dimension: str(it.dimension), justification: str(it.justification), ...(str(it.tier) ? { tier: str(it.tier) } : {}), ...(strList(it.personas) ? { personas: strList(it.personas) } : {}) });
        break;
      }
      case "edit_segment": {
        const segmentId = str(it.segmentId);
        if (!segmentId) { reject("needs a segmentId"); break; }
        ops.push({
          type, segmentId,
          ...(str(it.name) ? { name: str(it.name) } : {}),
          ...(str(it.dimension) ? { dimension: str(it.dimension) } : {}),
          ...(str(it.justification) ? { justification: str(it.justification) } : {}),
          // An empty tier clears one; only a revert sends that, but it is harmless from anyone.
          ...(typeof it.tier === "string" ? { tier: str(it.tier) } : {}),
          ...(strList(it.personas) ? { personas: strList(it.personas) } : {}),
        });
        break;
      }
      case "remove_segment": {
        const segmentId = str(it.segmentId);
        if (!segmentId) { reject("needs a segmentId"); break; }
        ops.push({ type, segmentId });
        break;
      }
      case "edit_brief": {
        const field = str(it.field);
        if (!field) { reject("needs a Brief of Record field"); break; }
        ops.push({ type, field, ...(typeof it.value === "string" ? { value: it.value } : {}), ...(strList(it.values) ? { values: strList(it.values) } : {}) });
        break;
      }
      case "set_kpis": {
        const values = strList(it.values) || [];
        if (values.length === 0) { reject("needs at least one KPI"); break; }
        ops.push({ type, values });
        break;
      }
      case "set_geography": {
        const value = str(it.value);
        if (!value) { reject("needs a geography"); break; }
        ops.push({ type, value, ...(allowRestore && it.config && typeof it.config === "object" ? { config: it.config } : {}) });
        break;
      }
      case "add_learning": {
        const campaignId = str(it.campaignId);
        const findingId = str(it.findingId);
        if (!campaignId || !findingId || !str(it.learning) || !str(it.action)) { reject("needs a campaignId, a findingId, the learning and the action"); break; }
        ops.push({ type, campaignId, findingId, learning: str(it.learning), action: str(it.action), ...(Number.isInteger(it.position) && it.position >= 0 ? { position: it.position } : {}) });
        break;
      }
      case "edit_learning":
      case "remove_learning": {
        const index = Number(it.index);
        if (!Number.isInteger(index) || index < 0) { reject("needs the learning's index"); break; }
        if (type === "remove_learning") ops.push({ type, index });
        else ops.push({ type, index, ...(str(it.learning) ? { learning: str(it.learning) } : {}), ...(str(it.action) ? { action: str(it.action) } : {}) });
        break;
      }
      case "set_learnings": {
        ops.push({ type, items: Array.isArray(it.items) ? it.items : [] });
        break;
      }
      case "mark_recap_recommendation": {
        const id = str(it.id);
        if (!id) { reject("needs the recommendation's id"); break; }
        ops.push({ type, id, applied: it.applied !== false });
        break;
      }
      case "remove_recap_item": {
        const id = str(it.id);
        if (!id || (it.kind !== "card" && it.kind !== "recommendation")) { reject("needs kind (card or recommendation) and the item's id"); break; }
        ops.push({ type, kind: it.kind, id });
        break;
      }
      case "set_campaign_recap": {
        ops.push({ type, recap: it.recap && typeof it.recap === "object" ? it.recap : null });
        break;
      }
      case "add_takeaway": {
        const value = str(it.value);
        if (!value) { reject("needs the takeaway's text"); break; }
        ops.push({ type, value, ...(Number.isInteger(it.position) && it.position >= 0 ? { position: it.position } : {}) });
        break;
      }
      case "add_recommendation":
        ops.push({ type, title: str(it.title), action: str(it.action), why: str(it.why), channels: str(it.channels), ...(Number.isInteger(it.position) && it.position >= 0 ? { position: it.position } : {}) });
        break;
      case "remove_takeaway":
      case "remove_recommendation": {
        const index = Number(it.index);
        if (!Number.isInteger(index) || index < 0) { reject("needs the item's index"); break; }
        ops.push({ type, index });
        break;
      }
      case "move_item": {
        const index = Number(it.index);
        const position = Number(it.position);
        if (!(NARRATIVE_LISTS as readonly string[]).includes(it.list) || !Number.isInteger(index) || index < 0 || !Number.isInteger(position) || position < 0) {
          reject("needs a list (takeaways or recommendations), an index and a position");
          break;
        }
        ops.push({ type, list: it.list, index, position });
        break;
      }
      // The model asks with hide_section / show_section; a true/false flag is the easiest field
      // for it to send as text or leave out, so set_section_visibility (what a revert sends) also
      // reads "true"/"false".
      case "hide_section":
      case "show_section":
      case "set_section_visibility": {
        const section = str(it.section);
        const flag = typeof it.hidden === "boolean" ? it.hidden : it.hidden === "true" ? true : it.hidden === "false" ? false : undefined;
        const hidden = type === "hide_section" ? true : type === "show_section" ? false : flag;
        if (!section || hidden === undefined) { reject("needs a section and whether it is hidden"); break; }
        ops.push({ type: "set_section_visibility", section, hidden });
        break;
      }
      case "add_ctv_publisher": {
        const publisher = str(it.publisher);
        if (!publisher) { reject("needs a publisher from the catalog"); break; }
        ops.push({ type, publisher, why: str(it.why) });
        break;
      }
      case "add_channel_record":
      case "remove_channel_record": {
        const recordType = str(it.recordType);
        // The record's name or the end of its id finds it as well as the full id (see
        // matchesRecord), and a reason sent as "why" is still the reason.
        // Gemini tends to send the record in "value", and as the end of its id ("brand_lift").
        const recordId = str(it.recordId) || str(it.value) || str(it.record) || str(it.recordName) || str(it.name);
        const rationale = str(it.rationale) || str(it.why);
        if (!channelId || !recordType || !recordId) { reject("needs a channelId, a recordType and a recordId"); break; }
        ops.push(type === "add_channel_record"
          ? { type, channelId, recordType, recordId, ...(rationale ? { rationale } : {}) }
          : { type, channelId, recordType, recordId });
        break;
      }
      case "edit_channel_panel": {
        const panel = str(it.panel);
        const content = allowRestore ? str(it.content) : normalizePlanText(str(it.content));
        if (!channelId || !panel || !content) { reject("needs a channelId, a panel and the panel's new text"); break; }
        ops.push({ type, channelId, panel, content });
        break;
      }
      case "hide_channel_panel":
      case "show_channel_panel": {
        const panel = str(it.panel);
        if (!channelId || !panel) { reject("needs a channelId and a panel"); break; }
        ops.push({ type, channelId, panel });
        break;
      }
      case "set_channel_records": {
        if (!channelId || !str(it.recordType) || !Array.isArray(it.records)) { reject("needs a channelId, a recordType and its records"); break; }
        ops.push({ type, channelId, recordType: str(it.recordType), records: it.records });
        break;
      }
      case "set_channel_override": {
        if (!channelId || (it.override !== null && typeof it.override !== "object")) { reject("needs a channelId and an override"); break; }
        ops.push({ type, channelId, override: it.override ?? null });
        break;
      }
      case "set_list": {
        if (!(NARRATIVE_LISTS as readonly string[]).includes(it.list) || !Array.isArray(it.items)) { reject("needs a list and its items"); break; }
        ops.push({ type, list: it.list, items: it.items });
        break;
      }
      case "restore_persona": {
        const index = Number(it.index);
        if (!it.persona || typeof it.persona !== "object" || !str(it.persona.name) || !Number.isInteger(index) || index < 0) { reject("needs a persona and an index"); break; }
        ops.push({ type, index, persona: it.persona, segmentIds: strList(it.segmentIds) || [] });
        break;
      }
      case "restore_segment": {
        const index = Number(it.index);
        if (!it.segment || typeof it.segment !== "object" || !str(it.segment.id) || !Number.isInteger(index) || index < 0) { reject("needs a segment and an index"); break; }
        ops.push({ type, index, segment: it.segment, personas: strList(it.personas) || [] });
        break;
      }
    }
  }
  if (list.length > MAX_OPS) rejected.push({ op: null, reason: `only the first ${MAX_OPS} operations are considered` });
  return { ops, rejected };
}

const money = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;
const pct = (value: number) => `${Math.round(value * 10) / 10}%`;

function textLabel(profile: any, path: string): string {
  const channel = path.match(/^channelStrategy\.mediaPlan\.channels\[(\d+)\]\.(gapAddressed|allocationRationale|tradeoffs|evidence)(?:\[(\d+)\])?/);
  if (channel) {
    const [, index, field, item] = channel;
    const name = profile?.channelStrategy?.mediaPlan?.channels?.[Number(index)]?.channelName || `Channel ${Number(index) + 1}`;
    const part = { gapAddressed: "why it's in the plan", allocationRationale: "allocation rationale", tradeoffs: "trade-off", evidence: "evidence" }[field];
    return `${name} – ${part}${item !== undefined ? ` ${Number(item) + 1}` : ""}`;
  }
  const publisher = path.match(/^ctvPublishers\[(\d+)\]\.why$/);
  if (publisher) return `${profile?.ctvPublishers?.[Number(publisher[1])]?.publisher || "CTV publisher"} – why`;
  const pillar = path.match(/^publisherHighlights\.(?:headline|pillars\[(\d+)\]\.(title|detail))$/);
  if (pillar) return pillar[1] === undefined ? "Publisher insights – headline" : `Publisher insights – ${profile?.publisherHighlights?.pillars?.[Number(pillar[1])]?.title || `pillar ${Number(pillar[1]) + 1}`} ${pillar[2]}`;
  const persona = path.match(/^personas\[(\d+)\]\.(\w+)$/);
  if (persona) return `${profile?.personas?.[Number(persona[1])]?.name || `Persona ${Number(persona[1]) + 1}`} – ${persona[2]}`;
  const labels: Record<string, string> = {
    intro: "Introduction", publisherInsights: "Publisher insights", audienceAnalysis: "Audience analysis",
    takeaways: "Takeaway", recommendations: "Recommendation", sources: "Citation", demographics: "Demographics",
    browserAndReach: "Web & domains", deviceTypeIndex: "Devices", temporalPatterns: "Timing",
  };
  const match = path.match(/^([A-Za-z]+)(?:\[(\d+)\])?(?:\.([A-Za-z]+))?$/);
  if (!match) return path;
  const [, root, index, field] = match;
  return `${labels[root] ?? root}${index !== undefined ? ` ${Number(index) + 1}` : ""}${field ? ` – ${field}` : ""}`;
}

function channelName(plan: MediaRecommendationPlan | undefined, channelId: string): string {
  return plan?.channels.find((c) => c.channelId === channelId)?.channelName
    || plan?.evaluatedCandidates.find((c) => c.product.id === channelId)?.product.displayName
    || channelId;
}

/** Channels the planner could add: in the catalog for this plan, sellable, and not already selected. */
export function addableChannels(plan: MediaRecommendationPlan | undefined) {
  if (!plan) return [];
  const selected = new Set(plan.channels.map((c) => c.channelId));
  return plan.evaluatedCandidates.filter(({ product }) =>
    !selected.has(product.id) && product.digitalRemedyExecutable && product.recommendationEligible && product.status === "live");
}

/**
 * Applies operations to a copy of the payload, in a fixed order whatever order they arrive in:
 * text edits (against the positions the model read), the brief, personas, segments, then the
 * channel plan (locks, adds and removals, then every allocation target and any budget change
 * solved together), then publishers. Solving allocations together matters: applied one at a
 * time, the second target would rebalance the first away.
 *
 * An operation that cannot be performed is reported in `rejected` and skipped; the rest still
 * apply, so the planner sees exactly what would change and why anything was left out.
 */
export function applyOps(payload: any, rawOps: AssistantOp[], context: ApplyContext = {}): OpsResult {
  const next = JSON.parse(JSON.stringify(payload ?? {}));
  const profile = next.profile ?? (next.profile = {});
  const rejected: RejectedOp[] = [];
  const applied: AssistantOp[] = [];
  const textChanges: ProposalChange[] = [];
  const publisherChanges: ProposalChange[] = [];
  const revertPublishers: AssistantOp[] = [];

  const strategyBefore = profile.channelStrategy;
  const planBefore: MediaRecommendationPlan | undefined = strategyBefore?.mediaPlan;
  const lockedBefore: string[] = [...(strategyBefore?.lockedAllocationChannelIds || [])];

  const byType = (types: AssistantOpType[]) => rawOps.filter((op) => types.includes(op.type));

  // Text runs first, against the positions the model read. Each edit also records what it
  // edited (a channel id, a publisher record) so its revert can find that item wherever the
  // rest of the proposal moves it. Editing an item the same proposal removes is refused.
  const removedChannels = new Set(byType(["remove_channel"]).map((op) => (op as { channelId: string }).channelId));
  const removedPublishers = new Set(byType(["remove_ctv_publisher"]).map((op) => (op as { publisher: string }).publisher.toLowerCase()));
  const removedItems = new Set([
    ...byType(["remove_takeaway"]).map((op) => `takeaways[${(op as { index: number }).index}]`),
    ...byType(["remove_recommendation"]).map((op) => `recommendations[${(op as { index: number }).index}]`),
  ]);
  const listsBefore = Object.fromEntries(NARRATIVE_LISTS.map((list) => [list, JSON.parse(JSON.stringify(profile[list] ?? []))])) as Record<NarrativeList, unknown[]>;
  const textTargets: Array<{ op: AssistantOp; path: string; before: string; channelId?: string; publisher?: any }> = [];
  for (const op of byType(["edit_text"]) as Array<{ type: "edit_text"; path: string; value: string }>) {
    if (/^personas\[/.test(op.path)) { rejected.push({ op, reason: "persona fields are changed with update_persona" }); continue; }
    const channelMatch = op.path.match(/^channelStrategy\.mediaPlan\.channels\[(\d+)\]\./);
    const channelId = channelMatch ? profile.channelStrategy?.mediaPlan?.channels?.[Number(channelMatch[1])]?.channelId : undefined;
    const publisherMatch = op.path.match(/^ctvPublishers\[(\d+)\]\./);
    const publisher = publisherMatch ? profile.ctvPublishers?.[Number(publisherMatch[1])] : undefined;
    const listItem = op.path.match(/^((?:takeaways|recommendations)\[\d+\])/)?.[1];
    if ((channelId && removedChannels.has(channelId)) || (publisher && removedPublishers.has(str(publisher.publisher).toLowerCase())) || (listItem && removedItems.has(listItem))) {
      rejected.push({ op, reason: "that item is removed in the same proposal" });
      continue;
    }
    const label = textLabel(profile, op.path);
    const result = writeProseField(profile, op.path, op.value);
    if ("reason" in result) { rejected.push({ op, reason: result.reason }); continue; }
    textChanges.push({ kind: "text", label, before: result.before, after: String(getAtPath(profile, op.path)), path: op.path });
    textTargets.push({ op, path: op.path, before: result.before, channelId, publisher });
    applied.push(op);
  }

  const lists = applyListOps(profile, byType(["add_takeaway", "remove_takeaway", "add_recommendation", "remove_recommendation", "move_item", "set_list"]), listsBefore);
  const sections = applySectionOps(profile, byType(["set_section_visibility"]));
  const brief = applyBriefOps(next, byType(["edit_brief", "set_kpis", "set_geography"]));
  const audience = applyAudienceOps(next, byType(["update_persona", "add_persona", "remove_persona", "restore_persona", "add_segment", "edit_segment", "remove_segment", "restore_segment"]));
  for (const outcome of [lists, sections, brief, audience]) {
    applied.push(...outcome.applied);
    rejected.push(...outcome.rejected);
  }
  const channelOps = byType(["lock_channel", "unlock_channel", "add_channel", "remove_channel", "set_allocation", "set_budget"]);

  if (channelOps.length > 0 && (!strategyBefore || !planBefore)) {
    channelOps.forEach((op) => rejected.push({ op, reason: "this plan has no channel plan to edit" }));
  } else if (strategyBefore && planBefore) {
    let strategy = { ...strategyBefore };
    let plan: MediaRecommendationPlan = planBefore;
    let locked = [...lockedBefore];
    const included = new Set<string>(strategy.manualIncludedChannelIds || []);
    const excluded = new Set<string>(strategy.manualExcludedChannelIds || []);
    let portfolioChanged = false;

    for (const op of byType(["lock_channel", "unlock_channel"])) {
      const { channelId } = op as { channelId: string };
      if (!plan.channels.some((c) => c.channelId === channelId)) { rejected.push({ op, reason: `${channelId} is not in the plan` }); continue; }
      if (op.type === "lock_channel" && !locked.includes(channelId)) locked.push(channelId);
      if (op.type === "unlock_channel") locked = locked.filter((id) => id !== channelId);
      applied.push(op);
    }

    for (const op of byType(["add_channel", "remove_channel"])) {
      const { channelId } = op as { channelId: string };
      try {
        if (op.type === "add_channel") {
          if (plan.channels.some((c) => c.channelId === channelId)) { rejected.push({ op, reason: `${channelName(plan, channelId)} is already in the plan` }); continue; }
          plan = addMediaTypeAndRebalance(plan, channelId, locked);
          included.add(channelId);
          excluded.delete(channelId);
        } else {
          if (!plan.channels.some((c) => c.channelId === channelId)) { rejected.push({ op, reason: `${channelId} is not in the plan` }); continue; }
          plan = removeMediaTypeAndRebalance(plan, channelId, locked);
          included.delete(channelId);
          excluded.add(channelId);
          locked = locked.filter((id) => id !== channelId);
        }
        portfolioChanged = true;
        applied.push(op);
      } catch (err: any) {
        rejected.push({ op, reason: err?.message || String(err) });
      }
    }

    // As the manual add/remove does: a changed portfolio gets a new baseline to reset to.
    const baseline: AllocationBasisPoints = portfolioChanged
      ? allocationBasisPoints(plan)
      : strategy.allocationBaselineBasisPoints || allocationBasisPoints(plan);

    const budgetOps = byType(["set_budget"]) as Array<{ type: "set_budget"; amount: number }>;
    const budgetOp = budgetOps[budgetOps.length - 1];
    budgetOps.slice(0, -1).forEach((op) => rejected.push({ op, reason: "only one budget change is applied per proposal" }));
    const targetOps = byType(["set_allocation"]) as Array<{ type: "set_allocation"; channelId: string; percent: number }>;
    const targets: AllocationBasisPoints = {};
    const validTargets: AssistantOp[] = [];
    for (const op of targetOps) {
      if (!plan.channels.some((c) => c.channelId === op.channelId)) { rejected.push({ op, reason: `${channelName(plan, op.channelId)} is not in the plan` }); continue; }
      targets[op.channelId] = op.percent * 100;
      validTargets.push(op);
    }

    let budgetChanged = false;
    let rebalanced = false;
    if (budgetOp || validTargets.length > 0) {
      const budget = budgetOp?.amount ?? plan.workingMediaBudget;
      const current = allocationBasisPoints(plan);
      try {
        let basisPoints: AllocationBasisPoints;
        if (validTargets.length === 0) {
          // A budget change alone keeps the mix if it still fits the new budget's minimums.
          try {
            applyBasisPointAllocations(plan, current, "check", budget);
            basisPoints = current;
          } catch {
            const fixedLocks = Object.fromEntries(locked.filter((id) => current[id] !== undefined).map((id) => [id, current[id]]));
            basisPoints = rebalanceBasisPoints(plan, fixedLocks, budget);
          }
        } else {
          try {
            basisPoints = minimalRebalance(plan, current, targets, locked, budget);
          } catch {
            // No small adjustment fits the limits; the engine's full rebalance explains why, or finds a way.
            const fixed: AllocationBasisPoints = { ...targets };
            locked.forEach((id) => { if (fixed[id] === undefined && current[id] !== undefined) fixed[id] = current[id]; });
            basisPoints = rebalanceBasisPoints(plan, fixed, budget);
          }
        }
        budgetChanged = budget !== plan.workingMediaBudget;
        plan = applyBasisPointAllocations(
          plan,
          basisPoints,
          `ScoutAI change approved by the planner${budgetChanged ? ` with budget $${budget.toLocaleString("en-US")}` : ""}; unlocked media types were proportionally rebalanced within the working-media budget.`,
          budget,
        );
        rebalanced = true;
        if (budgetOp) applied.push(budgetOp);
        applied.push(...validTargets);
      } catch (err: any) {
        const reason = err?.message || String(err);
        if (budgetOp) rejected.push({ op: budgetOp, reason });
        validTargets.forEach((op) => rejected.push({ op, reason }));
      }
    }

    if (plan !== planBefore || locked.join() !== lockedBefore.join()) {
      // Same rule as the manual controls: an add or removal resets the baseline, and the plan
      // counts as hand-edited only while its allocations or budget differ from that baseline.
      const hasManualAllocationChanges = rebalanced
        ? !allocationsEqual(baseline, allocationBasisPoints(plan)) || budgetChanged
        : portfolioChanged ? false : Boolean(strategyBefore.hasManualAllocationChanges);
      strategy = {
        ...strategy,
        generatedAt: new Date().toISOString(),
        manualIncludedChannelIds: Array.from(included),
        manualExcludedChannelIds: Array.from(excluded),
        allocationBaselineBasisPoints: baseline,
        lockedAllocationChannelIds: locked.filter((id) => plan.channels.some((c) => c.channelId === id)),
        hasManualAllocationChanges,
        mediaPlan: plan,
      };
      profile.channelStrategy = strategy;
      // The brief's budget field is what the form shows and what a regeneration starts from.
      if (budgetChanged) next.budget = `$${plan.workingMediaBudget.toLocaleString("en-US")}`;
    }
  }

  const syncStrategyPublishers = () => {
    if (profile.channelStrategy) profile.channelStrategy = { ...profile.channelStrategy, ctvPublishers: profile.ctvPublishers };
  };

  for (const op of byType(["remove_ctv_publisher", "restore_ctv_publisher", "add_ctv_publisher"]) as Array<Extract<AssistantOp, { type: "remove_ctv_publisher" | "restore_ctv_publisher" | "add_ctv_publisher" }>>) {
    const list: any[] = Array.isArray(profile.ctvPublishers) ? profile.ctvPublishers : [];
    if (op.type === "add_ctv_publisher") {
      const entry = context.publisherCatalog?.find((p) => p.enabled && str(p.name).toLowerCase() === op.publisher.toLowerCase());
      if (!entry) { rejected.push({ op, reason: `${op.publisher} is not an available publisher in the catalog` }); continue; }
      if (list.some((p) => str(p?.publisher).toLowerCase() === entry.name.toLowerCase())) { rejected.push({ op, reason: `${entry.name} is already in the plan` }); continue; }
      profile.ctvPublishers = [...list, { publisher: entry.name, category: entry.category, why: op.why }];
      syncStrategyPublishers();
      publisherChanges.push({ kind: "publisher", label: `CTV publisher – ${entry.name}`, before: "Not in plan", after: op.why || "Included" });
      revertPublishers.unshift({ type: "remove_ctv_publisher", publisher: entry.name });
      applied.push(op);
    } else if (op.type === "remove_ctv_publisher") {
      const index = list.findIndex((p) => str(p?.publisher).toLowerCase() === op.publisher.toLowerCase());
      if (index < 0) { rejected.push({ op, reason: `${op.publisher} is not one of the plan's CTV publishers` }); continue; }
      const [removed] = list.splice(index, 1);
      profile.ctvPublishers = [...list];
      syncStrategyPublishers();
      publisherChanges.push({ kind: "publisher", label: `CTV publisher – ${removed.publisher}`, before: "Included", after: "Removed" });
      revertPublishers.unshift({ type: "restore_ctv_publisher", publisher: removed.publisher, category: removed.category || "", why: removed.why || "", index, isUserAdded: removed.isUserAdded });
      applied.push(op);
    } else {
      if (list.some((p) => str(p?.publisher).toLowerCase() === op.publisher.toLowerCase())) { rejected.push({ op, reason: `${op.publisher} is already in the plan` }); continue; }
      const restored = { publisher: op.publisher, category: op.category, why: op.why, ...(op.isUserAdded ? { isUserAdded: true } : {}) };
      profile.ctvPublishers = [...list.slice(0, op.index), restored, ...list.slice(op.index)];
      syncStrategyPublishers();
      publisherChanges.push({ kind: "publisher", label: `CTV publisher – ${op.publisher}`, before: "Removed", after: "Included" });
      revertPublishers.unshift({ type: "remove_ctv_publisher", publisher: op.publisher });
      applied.push(op);
    }
  }

  const details = applyChannelDetailOps(
    profile,
    byType(["add_channel_record", "remove_channel_record", "set_channel_records", "edit_channel_panel", "hide_channel_panel", "show_channel_panel", "set_channel_override"]),
    context.planningSettings,
    new Set((planBefore?.channels || []).map((c) => c.channelId)),
  );
  applied.push(...details.applied);
  rejected.push(...details.rejected);

  // Last of the content changes: a learning's action must name what the plan holds once the rest
  // of the proposal has run, so "this plan adds online video" can ride with the add_channel.
  const learnings = applyLearningOps(profile, byType(["add_learning", "edit_learning", "remove_learning", "set_learnings"]), context.learningCampaigns);
  const recap = applyRecapOps(profile, byType(["mark_recap_recommendation", "remove_recap_item", "set_campaign_recap"]));
  applied.push(...learnings.applied, ...recap.applied);
  rejected.push(...learnings.rejected, ...recap.rejected);

  if (textTargets.some((t) => t.publisher)) syncStrategyPublishers();
  if (publisherChanges.length > 0 || textTargets.some((t) => t.publisher)) {
    profile.channelStrategy = syncCtvChannelPublishers(profile).channelStrategy;
  }
  const revertText: AssistantOp[] = [];
  for (const target of textTargets) {
    // A list this proposal reshaped is restored whole by its revert, text included.
    if (NARRATIVE_LISTS.some((list) => lists.reshaped.has(list) && target.path.startsWith(`${list}[`))) continue;
    // Where the edited item sits once everything else in the proposal has run.
    let path = target.path;
    if (target.channelId) {
      const index = (profile.channelStrategy?.mediaPlan?.channels || []).findIndex((c: any) => c.channelId === target.channelId);
      path = path.replace(/^channelStrategy\.mediaPlan\.channels\[\d+\]/, `channelStrategy.mediaPlan.channels[${index}]`);
    } else if (target.publisher) {
      path = path.replace(/^ctvPublishers\[\d+\]/, `ctvPublishers[${(profile.ctvPublishers || []).indexOf(target.publisher)}]`);
    }
    revertText.unshift({ type: "edit_text", path, value: target.before });
  }

  next.profile = profile;
  const channel = diffChannelPlan(strategyBefore, profile.channelStrategy, lockedBefore);
  return {
    payload: next,
    ops: applied,
    changes: [...brief.changes, ...audience.changes, ...channel.changes, ...details.changes, ...publisherChanges, ...lists.changes, ...learnings.changes, ...recap.changes, ...sections.changes, ...textChanges],
    rejected,
    revertOps: [...brief.revertOps, ...audience.revertOps, ...channel.revertOps, ...details.revertOps, ...revertPublishers, ...lists.revertOps, ...learnings.revertOps, ...recap.revertOps, ...sections.revertOps, ...revertText],
  };
}

/**
 * Hits the targets while moving the other channels as little as possible. The manual editor's
 * rebalance starts every unlocked channel from its minimum and redistributes, which reshuffles
 * channels a planner never mentioned; "move 2% from Search to Native" should change exactly those
 * two. Only when the targets do not net to 100% is the difference spread, one point at a time,
 * over the unlocked channels that were not named, in proportion to their current size.
 */
function minimalRebalance(
  plan: MediaRecommendationPlan,
  current: AllocationBasisPoints,
  targets: AllocationBasisPoints,
  locked: string[],
  budget: number,
): AllocationBasisPoints {
  const next: AllocationBasisPoints = { ...current, ...targets };
  let remaining = 10_000 - Object.values(next).reduce((sum, value) => sum + value, 0);
  const adjustable = plan.channels.filter((c) => targets[c.channelId] === undefined && !locked.includes(c.channelId));
  const step = remaining > 0 ? 100 : -100;
  while (remaining !== 0) {
    const candidates = adjustable.filter((c) => {
      const bounds = effectiveBounds(c, budget);
      const value = next[c.channelId] + step;
      return value >= bounds.minimum && value <= bounds.maximum;
    });
    if (candidates.length === 0) throw new Error("The other media types cannot absorb this change within their limits.");
    // Proportional: give to the channel that has grown least relative to its size, take from the one
    // that has shrunk least; ties go to the larger channel.
    const ratio = (c: typeof adjustable[number]) => next[c.channelId] / Math.max(1, current[c.channelId]);
    candidates.sort((a, b) => (step > 0 ? ratio(a) - ratio(b) : ratio(b) - ratio(a)) || current[b.channelId] - current[a.channelId]);
    next[candidates[0].channelId] += step;
    remaining -= step;
  }
  // The same validation the manual save runs; a failure falls back to the full rebalance.
  applyBasisPointAllocations(plan, next, "check", budget);
  return next;
}

/** The planner-facing diff of two channel strategies, and the operations that turn the second back into the first. */
function diffChannelPlan(before: any, after: any, lockedBefore: string[]): { changes: ProposalChange[]; revertOps: AssistantOp[] } {
  const changes: ProposalChange[] = [];
  const revertOps: AssistantOp[] = [];
  const planA: MediaRecommendationPlan | undefined = before?.mediaPlan;
  const planB: MediaRecommendationPlan | undefined = after?.mediaPlan;
  if (!planA || !planB) return { changes, revertOps };
  const byIdA = new Map(planA.channels.map((c) => [c.channelId, c]));
  const byIdB = new Map(planB.channels.map((c) => [c.channelId, c]));

  if (planA.workingMediaBudget !== planB.workingMediaBudget) {
    changes.push({ kind: "budget", label: "Working media budget", before: money(planA.workingMediaBudget), after: money(planB.workingMediaBudget) });
  }
  for (const channel of planB.channels) {
    const old = byIdA.get(channel.channelId);
    if (!old) {
      changes.push({ kind: "channel_added", label: channel.channelName, before: "Not in plan", after: `${pct(channel.allocationPercent)} · ${money(channel.allocationDollars)}`, channelId: channel.channelId });
      revertOps.push({ type: "remove_channel", channelId: channel.channelId });
    } else if (old.allocationPercent !== channel.allocationPercent || old.allocationDollars !== channel.allocationDollars) {
      changes.push({
        kind: "allocation",
        label: channel.channelName,
        before: `${pct(old.allocationPercent)} · ${money(old.allocationDollars)}`,
        after: `${pct(channel.allocationPercent)} · ${money(channel.allocationDollars)}`,
        channelId: channel.channelId,
      });
    }
  }
  for (const channel of planA.channels) {
    if (!byIdB.has(channel.channelId)) {
      changes.push({ kind: "channel_removed", label: channel.channelName, before: `${pct(channel.allocationPercent)} · ${money(channel.allocationDollars)}`, after: "Removed", channelId: channel.channelId });
      revertOps.push({ type: "add_channel", channelId: channel.channelId });
    }
  }

  const lockedAfter: string[] = after?.lockedAllocationChannelIds || [];
  for (const id of lockedAfter) {
    if (!lockedBefore.includes(id)) {
      changes.push({ kind: "lock", label: channelName(planB, id), before: "Unlocked", after: "Locked", channelId: id });
      revertOps.push({ type: "unlock_channel", channelId: id });
    }
  }
  for (const id of lockedBefore) {
    if (!lockedAfter.includes(id) && byIdB.has(id)) {
      changes.push({ kind: "lock", label: channelName(planB, id), before: "Locked", after: "Unlocked", channelId: id });
      revertOps.push({ type: "lock_channel", channelId: id });
    }
  }

  const allocationsChanged = changes.some((c) => c.kind === "allocation" || c.kind === "budget")
    || revertOps.some((op) => op.type === "add_channel" || op.type === "remove_channel");
  if (allocationsChanged) {
    // Every original channel's exact percentage, solved together with the old budget, so the
    // revert lands on the previous numbers rather than a fresh rebalance near them.
    revertOps.push(...planA.channels.map((c) => ({ type: "set_allocation" as const, channelId: c.channelId, percent: Math.round(c.allocationPercent) })));
    if (planA.workingMediaBudget !== planB.workingMediaBudget) revertOps.push({ type: "set_budget", amount: planA.workingMediaBudget });
  }
  return { changes, revertOps };
}
