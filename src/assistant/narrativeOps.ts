// ScoutAI operations on the plan's lists (takeaways, recommendations) and on which sections the
// client view shows. Rewording an existing item is edit_text (./operations); these add, remove
// and reorder.
//
// List positions are the ones the model read. Every operation on a list is resolved against the
// list as it was before the proposal, so "remove takeaway 2, move takeaway 4 to the top" means
// what it says whatever order the operations arrive in. A revert restores the whole list.

import type { AssistantOp, ProposalChange, RejectedOp } from "./operations";

export const NARRATIVE_LISTS = ["takeaways", "recommendations"] as const;
export type NarrativeList = (typeof NARRATIVE_LISTS)[number];

const MAX_ITEMS = 10;
const LIST_LABEL: Record<NarrativeList, string> = { takeaways: "Takeaway", recommendations: "Recommendation" };

/** Section keys the plan view hides and shows, with the older keys some saved plans use. */
export const PLAN_SECTIONS: Record<string, { label: string; aliases: string[] }> = {
  intro: { label: "Introduction", aliases: [] },
  personas: { label: "Personas", aliases: [] },
  segments: { label: "Audience segments", aliases: [] },
  insights: { label: "Takeaways & recommendations", aliases: [] },
  domainAffinity: { label: "Domain affinity", aliases: [] },
  deviceShare: { label: "Device share", aliases: ["deviceSplit"] },
  demographics: { label: "Demographics", aliases: [] },
  temporal: { label: "Timing patterns", aliases: ["daypart"] },
  channels: { label: "Channel strategy", aliases: [] },
  executiveSummary: { label: "Executive summary", aliases: ["blueprint"] },
  sources: { label: "Sources", aliases: [] },
  performanceLearnings: { label: "Built on your campaign history", aliases: [] },
  campaignRecap: { label: "Campaign recap", aliases: [] },
  geo: { label: "Geo footprint", aliases: [] },
};

export interface ListOutcome {
  changes: ProposalChange[];
  revertOps: AssistantOp[];
  applied: AssistantOp[];
  rejected: RejectedOp[];
  /** Lists this proposal reshaped: a revert restores them whole, so their text reverts are dropped. */
  reshaped: Set<NarrativeList>;
}

const clean = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

function recommendation(raw: any) {
  return {
    title: clean(raw?.title, 200),
    action: clean(raw?.action, 800),
    why: clean(raw?.why, 800),
    channels: clean(raw?.channels, 300),
  };
}

const preview = (item: unknown) => (typeof item === "string" ? item : `${(item as any)?.title}: ${(item as any)?.action}`);

/**
 * `before` holds each list as it was before the proposal's text edits, which is what a revert
 * restores; `profile` already carries those edits.
 */
export function applyListOps(profile: any, ops: AssistantOp[], before: Record<NarrativeList, unknown[]>): ListOutcome {
  const out: ListOutcome = { changes: [], revertOps: [], applied: [], rejected: [], reshaped: new Set() };
  const reject = (op: AssistantOp, reason: string) => out.rejected.push({ op, reason });

  for (const list of NARRATIVE_LISTS) {
    const listOps = ops.filter((op) => {
      if (op.type === "add_takeaway" || op.type === "remove_takeaway") return list === "takeaways";
      if (op.type === "add_recommendation" || op.type === "remove_recommendation") return list === "recommendations";
      return (op.type === "move_item" || op.type === "set_list") && op.list === list;
    });
    if (listOps.length === 0) continue;
    const current: unknown[] = Array.isArray(profile[list]) ? profile[list] : [];

    // A revert puts the list back exactly and does nothing else to it.
    const restore = listOps.find((op) => op.type === "set_list") as Extract<AssistantOp, { type: "set_list" }> | undefined;
    if (restore) {
      const items = list === "takeaways" ? restore.items.map((i) => clean(i, 800)).filter(Boolean) : restore.items.map(recommendation);
      out.revertOps.push({ type: "set_list", list, items: current });
      out.changes.push({ kind: "item_moved", label: `${LIST_LABEL[list]}s`, before: `${current.length} item${current.length === 1 ? "" : "s"}`, after: `${items.length} item${items.length === 1 ? "" : "s"} restored` });
      profile[list] = items;
      out.applied.push(restore);
      out.reshaped.add(list);
      continue;
    }

    type Entry = { orig: number | null; value: unknown };
    let entries: Entry[] = current.map((value, orig) => ({ orig, value }));
    const inRange = (index: number) => Number.isInteger(index) && index >= 0 && index < current.length;
    const labelOf = (orig: number) => `${LIST_LABEL[list]} ${orig + 1}`;
    let changed = false;

    for (const op of listOps) {
      if (op.type !== "remove_takeaway" && op.type !== "remove_recommendation") continue;
      if (!inRange(op.index) || !entries.some((e) => e.orig === op.index)) { reject(op, `there is no ${LIST_LABEL[list].toLowerCase()} ${op.index + 1}`); continue; }
      entries = entries.filter((e) => e.orig !== op.index);
      out.changes.push({ kind: "item_removed", label: labelOf(op.index), before: preview(current[op.index]), after: "Removed" });
      out.applied.push(op);
      changed = true;
    }
    for (const op of listOps) {
      if (op.type !== "move_item") continue;
      const at = entries.findIndex((e) => e.orig === op.index);
      if (at < 0) { reject(op, `there is no ${LIST_LABEL[list].toLowerCase()} ${op.index + 1} to move`); continue; }
      const [entry] = entries.splice(at, 1);
      const to = Math.max(0, Math.min(op.position, entries.length));
      entries.splice(to, 0, entry);
      out.changes.push({ kind: "item_moved", label: labelOf(op.index), before: `Position ${op.index + 1}`, after: `Position ${to + 1}` });
      out.applied.push(op);
      changed = true;
    }
    for (const op of listOps) {
      if (op.type !== "add_takeaway" && op.type !== "add_recommendation") continue;
      if (entries.length >= MAX_ITEMS) { reject(op, `a plan holds at most ${MAX_ITEMS} ${LIST_LABEL[list].toLowerCase()}s`); continue; }
      const value = op.type === "add_takeaway" ? clean(op.value, 800) : recommendation(op);
      if (typeof value === "string" ? !value : !value.title || !value.action || !value.why) {
        reject(op, op.type === "add_takeaway" ? "a takeaway needs its text" : "a recommendation needs a title, an action and a why");
        continue;
      }
      const to = op.position === undefined ? entries.length : Math.max(0, Math.min(op.position, entries.length));
      entries.splice(to, 0, { orig: null, value });
      out.changes.push({ kind: "item_added", label: `New ${LIST_LABEL[list].toLowerCase()}`, before: "Not in plan", after: preview(value) });
      out.applied.push(op);
      changed = true;
    }

    if (changed) {
      profile[list] = entries.map((e) => e.value);
      out.revertOps.push({ type: "set_list", list, items: before[list] ?? current });
      out.reshaped.add(list);
    }
  }
  return out;
}

export function applySectionOps(profile: any, ops: AssistantOp[]): Omit<ListOutcome, "reshaped"> {
  const out = { changes: [] as ProposalChange[], revertOps: [] as AssistantOp[], applied: [] as AssistantOp[], rejected: [] as RejectedOp[] };
  for (const op of ops) {
    if (op.type !== "set_section_visibility") continue;
    const section = PLAN_SECTIONS[op.section];
    if (!section) { out.rejected.push({ op, reason: `"${op.section}" is not a plan section` }); continue; }
    const keys = [op.section, ...section.aliases];
    const hidden = new Set<string>(Array.isArray(profile.hiddenSections) ? profile.hiddenSections : []);
    const isHidden = keys.some((key) => hidden.has(key));
    if (isHidden === op.hidden) { out.rejected.push({ op, reason: `${section.label} is already ${op.hidden ? "hidden" : "shown"}` }); continue; }
    if (op.hidden) hidden.add(op.section);
    else keys.forEach((key) => hidden.delete(key));
    profile.hiddenSections = Array.from(hidden);
    out.changes.push({ kind: "section", label: `Section – ${section.label}`, before: isHidden ? "Hidden" : "Shown", after: op.hidden ? "Hidden" : "Shown" });
    out.revertOps.unshift({ type: "set_section_visibility", section: op.section, hidden: isHidden });
    out.applied.push(op);
  }
  return out;
}
