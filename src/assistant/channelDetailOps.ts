// ScoutAI operations on a media type's details: the records attached to it (targeting tactics,
// publishers, creative enhancements, inventory controls, measurement) and the text of its detail
// panels. Records come only from what the catalog marks compatible with the product; panel text
// is written as the same overrides the plan view's hand-editing saves.
//
// A channel is named by its channelId. A channel's records are mirrored onto its evaluated
// candidate, as the prose fixer mirrors text, so removing and re-adding the channel keeps them.

import { channelRecordOptions, CHANNEL_RECORD_TYPES, type ChannelRecordType } from "../planning/engine";
import type { PlanningSettings } from "../planning/settings";
import type { AssistantOp, ProposalChange, RejectedOp } from "./operations";

export { CHANNEL_RECORD_TYPES, type ChannelRecordType };

export const RECORD_LABELS: Record<ChannelRecordType, string> = {
  targetingTactics: "Targeting",
  publishers: "Publishers",
  creativeEnhancements: "Creative enhancements",
  inventoryControls: "Inventory controls",
  measurementCapabilities: "Measurement",
};

/** Detail panels the plan view shows per media type, with the channel fields their default text comes from. */
export const CHANNEL_PANELS: Record<string, string> = {
  gapAddressed: "Why it's in the plan",
  planningRationale: "Planning rationale",
  activationGuidance: "Activation guidance",
  targetingTactics: "Targeting",
  publishers: "Publishers",
  creativeEnhancements: "Creative enhancements",
  inventoryControls: "Inventory controls",
  measurementApproach: "Measurement approach",
  measurementCapabilities: "Measurement",
  evidence: "Evidence",
  decisionRule: "Decision rule",
};

const MAX_RECORDS = 12;
const MAX_PANEL_CHARS = 2000;

export interface DetailOutcome {
  changes: ProposalChange[];
  revertOps: AssistantOp[];
  applied: AssistantOp[];
  rejected: RejectedOp[];
}

const squash = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Whether the model's reference names this record: its id ("measurement.brand_lift"), the end of
 * its id ("brand_lift") or its name ("Brand Lift"), ignoring case and punctuation. Matching stays
 * within one channel's records or options, so a loose reference cannot reach outside the catalog.
 */
export function matchesRecord(record: { id: string; displayName: string }, reference: string): boolean {
  const ref = squash(reference);
  if (!ref) return false;
  return record.id === reference || squash(record.id) === ref || squash(record.id.split(".").pop()) === ref || squash(record.displayName) === ref;
}

const names = (records: Array<{ displayName: string }>) => records.map((r) => r.displayName).join(", ") || "none";

export function applyChannelDetailOps(profile: any, ops: AssistantOp[], settings: PlanningSettings | undefined, channelsBefore: Set<string>): DetailOutcome {
  const out: DetailOutcome = { changes: [], revertOps: [], applied: [], rejected: [] };
  const reject = (op: AssistantOp, reason: string) => out.rejected.push({ op, reason });
  const strategy = profile.channelStrategy;
  const plan = strategy?.mediaPlan;
  const channelOf = (id: string) => plan?.channels?.find((c: any) => c.channelId === id);
  const candidateOf = (id: string) => plan?.evaluatedCandidates?.find((c: any) => c?.product?.id === id);

  // What each touched channel held before, so the revert restores it exactly and once.
  const recordsBefore = new Map<string, any[]>();
  const overridesBefore = new Map<string, any>();

  for (const op of ops) {
    if (op.type !== "add_channel_record" && op.type !== "remove_channel_record" && op.type !== "set_channel_records") continue;
    const channel = channelOf(op.channelId);
    if (!channel) { reject(op, `${op.channelId} is not in the plan`); continue; }
    if (!(CHANNEL_RECORD_TYPES as readonly string[]).includes(op.recordType)) { reject(op, `"${op.recordType}" is not a kind of channel record`); continue; }
    const type = op.recordType as ChannelRecordType;
    const key = `${op.channelId}|${type}`;
    const current: any[] = Array.isArray(channel[type]) ? channel[type] : [];
    if (!recordsBefore.has(key)) recordsBefore.set(key, current);
    let next: any[];

    if (op.type === "set_channel_records") {
      next = op.records;
    } else if (op.type === "remove_channel_record") {
      const found = current.find((r) => matchesRecord(r, op.recordId));
      if (!found) { reject(op, `${channel.channelName} has no ${RECORD_LABELS[type].toLowerCase()} record "${op.recordId}"`); continue; }
      next = current.filter((r) => r !== found);
    } else {
      const product = candidateOf(op.channelId)?.product;
      if (!product || !settings) { reject(op, `the catalog for ${channel.channelName} is not available`); continue; }
      const options = channelRecordOptions(product, settings)[type];
      const option = options.find((r) => matchesRecord(r, op.recordId));
      if (!option) {
        reject(op, type === "publishers" && options.length === 0
          ? `${channel.channelName}'s publishers are the plan's CTV publisher list`
          : `"${op.recordId}" is not a ${RECORD_LABELS[type].toLowerCase()} option for ${channel.channelName}`);
        continue;
      }
      if (current.some((r) => r.id === option.id)) { reject(op, `${channel.channelName} already has ${option.displayName}`); continue; }
      if (current.length >= MAX_RECORDS) { reject(op, `${channel.channelName} holds at most ${MAX_RECORDS} ${RECORD_LABELS[type].toLowerCase()} records`); continue; }
      next = [...current, { ...option, ...(op.rationale ? { rationale: op.rationale } : {}) }];
    }

    channel[type] = next;
    const candidate = candidateOf(op.channelId);
    if (candidate) candidate[type] = next;
    out.applied.push(op);

    // A hand-edited list panel shows its edited text instead of the records, so a record change
    // the planner approved would not appear. The edit gives way to the list.
    const override = strategy.channelOverrides?.[op.channelId];
    if (op.type !== "set_channel_records" && override?.fieldEdits?.[type]?.content !== undefined) {
      if (!overridesBefore.has(op.channelId)) overridesBefore.set(op.channelId, JSON.parse(JSON.stringify(override)));
      const { [type]: _dropped, ...fieldEdits } = override.fieldEdits;
      strategy.channelOverrides = { ...strategy.channelOverrides, [op.channelId]: { ...override, fieldEdits } };
      out.changes.push({ kind: "channel_detail", label: `${channel.channelName} – ${RECORD_LABELS[type]} text`, before: "Hand-edited text", after: "Shows the record list", channelId: op.channelId });
    }
  }

  for (const [key, before] of recordsBefore) {
    const [channelId, type] = key.split("|") as [string, ChannelRecordType];
    const channel = channelOf(channelId);
    const after: any[] = channel?.[type] || [];
    if (names(before) === names(after)) continue;
    out.changes.unshift({ kind: "channel_detail", label: `${channel.channelName} – ${RECORD_LABELS[type]}`, before: names(before), after: names(after), channelId });
    // A channel this proposal added is removed by the revert, taking its records with it.
    if (channelsBefore.has(channelId)) out.revertOps.push({ type: "set_channel_records", channelId, recordType: type, records: before });
  }

  for (const op of ops) {
    if (op.type !== "edit_channel_panel" && op.type !== "hide_channel_panel" && op.type !== "show_channel_panel" && op.type !== "set_channel_override") continue;
    if (op.type === "set_channel_override") {
      if (!strategy) { reject(op, "this plan has no channel plan"); continue; }
      const overrides = { ...(strategy.channelOverrides || {}) };
      if (op.override) overrides[op.channelId] = op.override;
      else delete overrides[op.channelId];
      strategy.channelOverrides = overrides;
      out.changes.push({ kind: "channel_detail", label: `${channelOf(op.channelId)?.channelName || op.channelId} – panel edits`, before: "Edited", after: "Restored", channelId: op.channelId });
      out.applied.push(op);
      continue;
    }
    const channel = channelOf(op.channelId);
    if (!channel) { reject(op, `${op.channelId} is not in the plan`); continue; }
    const label = CHANNEL_PANELS[op.panel];
    if (!label) { reject(op, `"${op.panel}" is not a channel panel`); continue; }
    const override = JSON.parse(JSON.stringify(strategy.channelOverrides?.[op.channelId] || {}));
    if (!overridesBefore.has(op.channelId)) overridesBefore.set(op.channelId, strategy.channelOverrides?.[op.channelId] ? JSON.parse(JSON.stringify(strategy.channelOverrides[op.channelId])) : null);
    const hidden = new Set<string>(override.hiddenPanels || []);

    if (op.type === "edit_channel_panel") {
      const content = op.content.trim().slice(0, MAX_PANEL_CHARS);
      const before = override.fieldEdits?.[op.panel]?.content ?? "(the plan's text)";
      if (!content || content === before) { reject(op, "it would not change the panel"); continue; }
      override.fieldEdits = { ...(override.fieldEdits || {}), [op.panel]: { ...(override.fieldEdits?.[op.panel] || {}), content } };
      out.changes.push({ kind: "channel_detail", label: `${channel.channelName} – ${label}`, before, after: content, channelId: op.channelId });
    } else {
      const hide = op.type === "hide_channel_panel";
      if (hidden.has(op.panel) === hide) { reject(op, `${channel.channelName}'s ${label} panel is already ${hide ? "hidden" : "shown"}`); continue; }
      if (hide) hidden.add(op.panel); else hidden.delete(op.panel);
      override.hiddenPanels = Array.from(hidden);
      out.changes.push({ kind: "channel_detail", label: `${channel.channelName} – ${label} panel`, before: hide ? "Shown" : "Hidden", after: hide ? "Hidden" : "Shown", channelId: op.channelId });
    }
    strategy.channelOverrides = { ...(strategy.channelOverrides || {}), [op.channelId]: override };
    out.applied.push(op);
  }

  for (const [channelId, override] of overridesBefore) {
    out.revertOps.push({ type: "set_channel_override", channelId, override });
  }
  return out;
}
