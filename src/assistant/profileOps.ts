// ScoutAI operations on the audience side of the plan: personas, segments, the Brief of Record
// and the brief inputs (KPIs, geography). Channel and text operations live in ./operations.
//
// Every target is named by identity (a persona by name, a segment by id), never by position, so a
// proposal can add, change and remove in one go. Each function mutates the working copy it is
// given and returns the planner-facing changes plus the operations that undo them.

import { AUDIENCE_TYPES, FUNNEL_EMPHASES, PRICE_TIERS } from "../research/briefOfRecord";
import { SEGMENT_TIERS, coerceDimension, segmentKey, MAX_SEGMENT_JUSTIFICATION_LENGTH, MAX_SEGMENT_NAME_LENGTH, MAX_TOTAL_SEGMENTS } from "../research/segmentRecommendations";
import { geoSnapshotFromBrief } from "../planning/geoFootprint";
import type { AssistantOp, ProposalChange, RejectedOp } from "./operations";

export const PERSONA_FIELDS = ["name", "age", "income", "gender", "watch", "browse", "buy", "narrative"] as const;
export type PersonaField = (typeof PERSONA_FIELDS)[number];
export type PersonaFields = Partial<Record<PersonaField, string>>;

const PERSONA_FIELD_LABELS: Record<PersonaField, string> = {
  name: "name", age: "age", income: "income", gender: "gender", watch: "watches", browse: "browses", buy: "buys", narrative: "narrative",
};
const PERSONA_FIELD_MAX: Record<PersonaField, number> = {
  name: 80, age: 40, income: 60, gender: 60, watch: 600, browse: 600, buy: 600, narrative: 1500,
};
const MAX_PERSONAS = 6;

export const BRIEF_TEXT_FIELDS = ["advertiser", "whatTheySell", "businessModel", "primaryAudience", "campaignObjective", "geography"] as const;
export const BRIEF_LIST_FIELDS = ["productCategories", "advertiserFacts", "includedSegments", "coreSegments", "excludedSegments", "uncertainties"] as const;
export const BRIEF_ENUM_FIELDS = { priceTier: PRICE_TIERS, audienceType: AUDIENCE_TYPES, funnelEmphasis: FUNNEL_EMPHASES } as const;
const BRIEF_LABELS: Record<string, string> = {
  advertiser: "Advertiser", whatTheySell: "What they sell", businessModel: "Business model", primaryAudience: "Primary audience",
  campaignObjective: "Campaign objective", geography: "Geography", productCategories: "Product categories",
  advertiserFacts: "Verified advertiser facts", includedSegments: "In-scope segments", coreSegments: "Core segments",
  excludedSegments: "Out-of-scope segments", uncertainties: "Not established", priceTier: "Price tier",
  audienceType: "Audience type", funnelEmphasis: "Funnel emphasis",
};

export interface OpOutcome {
  changes: ProposalChange[];
  revertOps: AssistantOp[];
  applied: AssistantOp[];
  rejected: RejectedOp[];
}

const clean = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const sameName = (a: unknown, b: unknown) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
const listText = (values: string[]) => values.join("; ") || "(none)";

function personaSummary(p: any): string {
  return [p?.name, p?.age, p?.income].filter(Boolean).join(", ");
}

/** Personas, then segments: a segment op may tag a persona the same proposal adds or renames. */
export function applyAudienceOps(payload: any, ops: AssistantOp[]): OpOutcome {
  const out: OpOutcome = { changes: [], revertOps: [], applied: [], rejected: [] };
  const profile = payload.profile ?? (payload.profile = {});
  if (!Array.isArray(profile.personas)) profile.personas = [];
  if (!Array.isArray(profile.segmentRecommendations)) profile.segmentRecommendations = [];
  const personas: any[] = profile.personas;
  const reject = (op: AssistantOp, reason: string) => out.rejected.push({ op, reason });

  // Segment tags are positions; they are held as persona objects while personas move, then
  // written back as positions once every persona change is done.
  const segments: any[] = profile.segmentRecommendations;
  const taggedPersonas = new Map<any, any[]>(segments.map((s) => [s, (s.personaIndices || []).map((i: number) => personas[i]).filter(Boolean)]));
  // A revert runs persona changes before segment changes, so the personas it tags are named as
  // they were before this proposal: by then any rename has been undone.
  const originalName = new Map<any, string>(personas.map((p) => [p, p?.name]));
  const namesForRevert = (list: any[]) => list.map((p) => originalName.get(p) ?? p.name);

  for (const op of ops) {
    if (op.type === "update_persona") {
      const persona = personas.find((p) => sameName(p?.name, op.persona));
      if (!persona) { reject(op, `there is no persona named "${op.persona}"`); continue; }
      const newName = clean(op.fields.name, PERSONA_FIELD_MAX.name);
      if (newName && personas.some((p) => p !== persona && sameName(p?.name, newName))) { reject(op, `another persona is already named "${newName}"`); continue; }
      const before: PersonaFields = {};
      const fieldChanges: ProposalChange[] = [];
      for (const field of PERSONA_FIELDS) {
        const value = clean(op.fields[field], PERSONA_FIELD_MAX[field]);
        if (!value || value === String(persona[field] ?? "").trim()) continue;
        before[field] = String(persona[field] ?? "");
        fieldChanges.push({ kind: "persona", label: `${persona.name} – ${PERSONA_FIELD_LABELS[field]}`, before: before[field]!, after: value });
      }
      if (fieldChanges.length === 0) { reject(op, "it would not change the persona"); continue; }
      const oldAvatar = { avatarUrl: persona.avatarUrl, avatarHistory: persona.avatarHistory };
      Object.entries(op.fields).forEach(([field, value]) => {
        if (before[field as PersonaField] !== undefined) persona[field] = clean(value, PERSONA_FIELD_MAX[field as PersonaField]);
      });
      // A new name is a different person: the old headshot would picture the wrong one. The old
      // portrait stays in the history, and the browser generates a new one after Apply.
      const renamed = before.name !== undefined;
      if (op.avatar) {
        if (op.avatar.avatarUrl) persona.avatarUrl = op.avatar.avatarUrl; else delete persona.avatarUrl;
        if (op.avatar.avatarHistory) persona.avatarHistory = op.avatar.avatarHistory; else delete persona.avatarHistory;
      } else if (renamed) {
        delete persona.avatarUrl;
      }
      out.changes.push(...fieldChanges);
      out.revertOps.unshift({ type: "update_persona", persona: persona.name, fields: before, ...(renamed || op.avatar ? { avatar: oldAvatar } : {}) });
      out.applied.push(op);
    } else if (op.type === "add_persona") {
      const fields = Object.fromEntries(PERSONA_FIELDS.map((f) => [f, clean(op.fields[f], PERSONA_FIELD_MAX[f])])) as Record<PersonaField, string>;
      const missing = PERSONA_FIELDS.filter((f) => !fields[f]);
      if (missing.length) { reject(op, `a new persona needs ${missing.join(", ")}`); continue; }
      if (personas.some((p) => sameName(p?.name, fields.name))) { reject(op, `a persona named "${fields.name}" already exists`); continue; }
      if (personas.length >= MAX_PERSONAS) { reject(op, `a plan holds at most ${MAX_PERSONAS} personas`); continue; }
      personas.push({ ...fields, sourceType: "ScoutAI" });
      out.changes.push({ kind: "persona_added", label: `Persona – ${fields.name}`, before: "Not in plan", after: personaSummary(fields) });
      out.revertOps.unshift({ type: "remove_persona", persona: fields.name });
      out.applied.push(op);
    } else if (op.type === "remove_persona" || op.type === "restore_persona") {
      if (op.type === "remove_persona") {
        const index = personas.findIndex((p) => sameName(p?.name, op.persona));
        if (index < 0) { reject(op, `there is no persona named "${op.persona}"`); continue; }
        if (personas.length <= 1) { reject(op, "a plan needs at least one persona"); continue; }
        const [removed] = personas.splice(index, 1);
        const segmentIds = segments.filter((s) => taggedPersonas.get(s)?.includes(removed)).map((s) => s.id);
        taggedPersonas.forEach((list, segment) => taggedPersonas.set(segment, list.filter((p) => p !== removed)));
        out.changes.push({ kind: "persona_removed", label: `Persona – ${removed.name}`, before: personaSummary(removed), after: "Removed" });
        out.revertOps.unshift({ type: "restore_persona", index, persona: removed, segmentIds });
      } else {
        if (personas.some((p) => sameName(p?.name, op.persona?.name))) { reject(op, `a persona named "${op.persona?.name}" already exists`); continue; }
        const restored = { ...op.persona };
        personas.splice(Math.min(op.index, personas.length), 0, restored);
        segments.forEach((s) => { if (op.segmentIds.includes(s.id)) taggedPersonas.get(s)?.push(restored); });
        out.changes.push({ kind: "persona_added", label: `Persona – ${restored.name}`, before: "Removed", after: personaSummary(restored) });
        out.revertOps.unshift({ type: "remove_persona", persona: restored.name });
      }
      out.applied.push(op);
    }
  }

  const resolvePersonas = (op: AssistantOp, names: string[] | undefined): any[] | null => {
    if (!names) return null;
    const found = names.map((name) => personas.find((p) => sameName(p?.name, name)));
    const unknown = names.filter((_, i) => !found[i]);
    if (unknown.length) { reject(op, `no persona named ${unknown.map((n) => `"${n}"`).join(", ")}`); return null; }
    return found;
  };
  const personaNames = (list: any[] | undefined) => (list || []).map((p) => p.name).join(", ") || "none";

  for (const op of ops) {
    if (op.type === "add_segment" || op.type === "restore_segment") {
      const source = op.type === "add_segment" ? op : op.segment;
      const name = clean(source.name, MAX_SEGMENT_NAME_LENGTH);
      const dimension = coerceDimension(source.dimension);
      if (!name || !dimension) { reject(op, "a segment needs a name and one of the four dimensions"); continue; }
      if (segments.some((s) => segmentKey(s.name) === segmentKey(name))) { reject(op, `the plan already has a segment named "${name}"`); continue; }
      if (segments.length >= MAX_TOTAL_SEGMENTS) { reject(op, `a plan holds at most ${MAX_TOTAL_SEGMENTS} segments`); continue; }
      let segment: any;
      if (op.type === "add_segment") {
        const tagged = resolvePersonas(op, op.personas);
        if (op.personas && !tagged) continue;
        segment = {
          id: `scout-${segmentKey(name).replace(/ /g, "-")}-${Date.now().toString(36)}`,
          name,
          dimension,
          justification: clean(op.justification, MAX_SEGMENT_JUSTIFICATION_LENGTH),
          ...(op.tier && (SEGMENT_TIERS as readonly string[]).includes(op.tier) ? { tier: op.tier } : {}),
          personaIndices: [],
          source: "ScoutAI",
        };
        segments.push(segment);
        taggedPersonas.set(segment, tagged || []);
      } else {
        segment = { ...op.segment };
        segments.splice(Math.min(op.index, segments.length), 0, segment);
        taggedPersonas.set(segment, op.personas.map((name) => personas.find((p) => sameName(p?.name, name))).filter(Boolean));
      }
      out.changes.push({ kind: "segment_added", label: `Segment – ${name}`, before: op.type === "add_segment" ? "Not in plan" : "Removed", after: `${dimension}${segment.tier ? ` · ${segment.tier}` : ""}` });
      out.revertOps.unshift({ type: "remove_segment", segmentId: segment.id });
      out.applied.push(op);
    } else if (op.type === "edit_segment") {
      const segment = segments.find((s) => s.id === op.segmentId);
      if (!segment) { reject(op, `there is no segment with id "${op.segmentId}"`); continue; }
      const revert: Extract<AssistantOp, { type: "edit_segment" }> = { type: "edit_segment", segmentId: segment.id };
      const changes: ProposalChange[] = [];
      const name = clean(op.name, MAX_SEGMENT_NAME_LENGTH);
      if (name && name !== segment.name) {
        if (segments.some((s) => s !== segment && segmentKey(s.name) === segmentKey(name))) { reject(op, `the plan already has a segment named "${name}"`); continue; }
        changes.push({ kind: "segment", label: `Segment – ${segment.name} – name`, before: segment.name, after: name });
        revert.name = segment.name;
      }
      const dimension = op.dimension ? coerceDimension(op.dimension) : null;
      if (op.dimension && !dimension) { reject(op, `"${op.dimension}" is not a segment dimension`); continue; }
      if (dimension && dimension !== segment.dimension) {
        changes.push({ kind: "segment", label: `Segment – ${segment.name} – dimension`, before: segment.dimension, after: dimension });
        revert.dimension = segment.dimension;
      }
      if (op.tier && !(SEGMENT_TIERS as readonly string[]).includes(op.tier)) { reject(op, `"${op.tier}" is not a segment tier`); continue; }
      // An empty tier comes only from a revert, and clears a tier the proposal added.
      if (op.tier !== undefined && op.tier !== (segment.tier || "")) {
        changes.push({ kind: "segment", label: `Segment – ${segment.name} – tier`, before: segment.tier || "none", after: op.tier });
        revert.tier = segment.tier || "";
      }
      const justification = clean(op.justification, MAX_SEGMENT_JUSTIFICATION_LENGTH);
      if (justification && justification !== segment.justification) {
        changes.push({ kind: "segment", label: `Segment – ${segment.name} – why`, before: segment.justification || "", after: justification });
        revert.justification = segment.justification || "";
      }
      let tagged: any[] | null = null;
      if (op.personas) {
        tagged = resolvePersonas(op, op.personas);
        if (!tagged) continue;
        const current = taggedPersonas.get(segment) || [];
        if (personaNames(tagged) !== personaNames(current)) {
          changes.push({ kind: "segment", label: `Segment – ${segment.name} – personas`, before: personaNames(current), after: personaNames(tagged) });
          revert.personas = namesForRevert(current);
        } else {
          tagged = null;
        }
      }
      if (changes.length === 0) { reject(op, "it would not change the segment"); continue; }
      if (name && revert.name !== undefined) segment.name = name;
      if (revert.dimension !== undefined) segment.dimension = dimension;
      if (revert.tier !== undefined) { if (op.tier) segment.tier = op.tier; else delete segment.tier; }
      if (revert.justification !== undefined) segment.justification = justification;
      if (tagged) taggedPersonas.set(segment, tagged);
      out.changes.push(...changes);
      out.revertOps.unshift(revert);
      out.applied.push(op);
    } else if (op.type === "remove_segment") {
      const index = segments.findIndex((s) => s.id === op.segmentId);
      if (index < 0) { reject(op, `there is no segment with id "${op.segmentId}"`); continue; }
      const [removed] = segments.splice(index, 1);
      const tags = taggedPersonas.get(removed) || [];
      out.changes.push({ kind: "segment_removed", label: `Segment – ${removed.name}`, before: removed.dimension, after: "Removed" });
      out.revertOps.unshift({ type: "restore_segment", index, segment: removed, personas: namesForRevert(tags) });
      out.applied.push(op);
    }
  }

  segments.forEach((s) => {
    s.personaIndices = (taggedPersonas.get(s) || []).map((p) => personas.indexOf(p)).filter((i) => i >= 0).sort((a, b) => a - b);
  });
  return out;
}

/** The Brief of Record and the brief inputs. Editing the brief marks the plan as built from an earlier one. */
export function applyBriefOps(payload: any, ops: AssistantOp[]): OpOutcome {
  const out: OpOutcome = { changes: [], revertOps: [], applied: [], rejected: [] };
  const profile = payload.profile ?? (payload.profile = {});
  const reject = (op: AssistantOp, reason: string) => out.rejected.push({ op, reason });
  const editedFields: string[] = [];

  for (const op of ops) {
    if (op.type === "edit_brief") {
      const brief = profile.briefOfRecord;
      if (!brief) { reject(op, "this plan has no Brief of Record"); continue; }
      const field = op.field;
      const label = `Brief of Record – ${BRIEF_LABELS[field] || field}`;
      if ((BRIEF_TEXT_FIELDS as readonly string[]).includes(field)) {
        const value = clean(op.value, 500);
        if (!value) { reject(op, `${BRIEF_LABELS[field]} needs a value`); continue; }
        if (value === String(brief[field] ?? "")) { reject(op, "it would not change the brief"); continue; }
        out.changes.push({ kind: "brief", label, before: String(brief[field] ?? ""), after: value });
        out.revertOps.unshift({ type: "edit_brief", field, value: String(brief[field] ?? "") });
        brief[field] = value;
      } else if ((BRIEF_LIST_FIELDS as readonly string[]).includes(field)) {
        const values = (op.values || []).map((v) => clean(v, 200)).filter(Boolean).slice(0, 15);
        const before: string[] = Array.isArray(brief[field]) ? brief[field] : [];
        if (field === "coreSegments" && values.length === 0) { reject(op, "the brief needs at least one core segment"); continue; }
        if (values.join("\n") === before.join("\n")) { reject(op, "it would not change the brief"); continue; }
        out.changes.push({ kind: "brief", label, before: listText(before), after: listText(values) });
        out.revertOps.unshift({ type: "edit_brief", field, values: [...before] });
        brief[field] = values;
      } else if (field in BRIEF_ENUM_FIELDS) {
        const allowed = BRIEF_ENUM_FIELDS[field as keyof typeof BRIEF_ENUM_FIELDS] as readonly string[];
        const value = clean(op.value, 40);
        if (!allowed.includes(value)) { reject(op, `${BRIEF_LABELS[field]} must be one of ${allowed.join(", ")}`); continue; }
        if (value === brief[field]) { reject(op, "it would not change the brief"); continue; }
        out.changes.push({ kind: "brief", label, before: String(brief[field] ?? ""), after: value });
        out.revertOps.unshift({ type: "edit_brief", field, value: String(brief[field] ?? "") });
        brief[field] = value;
      } else {
        reject(op, `"${field}" is not a Brief of Record field`);
        continue;
      }
      editedFields.push(field);
      out.applied.push(op);
    } else if (op.type === "set_kpis") {
      const values = op.values.map((v) => clean(v, 120)).filter(Boolean).slice(0, 8);
      const before: string[] = Array.isArray(payload.kpis) ? payload.kpis : [];
      if (values.length === 0) { reject(op, "the plan needs at least one KPI"); continue; }
      if (values.join("\n") === before.join("\n")) { reject(op, "it would not change the KPIs"); continue; }
      out.changes.push({ kind: "input", label: "KPIs", before: listText(before), after: listText(values) });
      out.revertOps.unshift({ type: "set_kpis", values: [...before] });
      payload.kpis = values;
      out.applied.push(op);
    } else if (op.type === "set_geography") {
      const value = clean(op.value, 300);
      const before = String(payload.geography ?? "");
      if (!value) { reject(op, "geography needs a value"); continue; }
      if (value === before && !op.config) { reject(op, "it would not change the geography"); continue; }
      out.changes.push({ kind: "input", label: "Geography", before: before || "(none)", after: value });
      out.revertOps.unshift({ type: "set_geography", value: before, ...(payload.geographyConfig ? { config: payload.geographyConfig } : {}) });
      payload.geography = value;
      // The structured picker state described the old geography; the form rebuilds it from the text.
      if (op.config) payload.geographyConfig = op.config;
      else delete payload.geographyConfig;
      // The saved footprint described the old geography too; without a picker config the plan
      // falls back to the brief, as plans from before the snapshot do.
      const snapshot = geoSnapshotFromBrief(payload.geographyConfig);
      if (snapshot) profile.geoTargeting = snapshot;
      else delete profile.geoTargeting;
      out.applied.push(op);
    }
  }

  if (editedFields.length > 0) {
    const previous: string[] = profile.briefOfRecordEdited?.fields || [];
    profile.briefOfRecordEdited = { at: new Date().toISOString(), fields: Array.from(new Set([...previous, ...editedFields])) };
  }
  return out;
}
