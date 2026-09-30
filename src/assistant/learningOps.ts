// The client-facing "Built on your campaign history" section: what the client's past campaign
// taught us, and what this plan does about it. It is the one place past performance is shown to
// a client, so every entry is held to rules the rest of the plan is not:
// - it comes from a finding in the saved review of a campaign linked to this plan;
// - that campaign is the client's own (plan, campaign and files all name the same advertiser);
// - the finding, and the learning's own text, quote only figures that are in the campaign's data;
// - the action says what the plan does without figures, so it cannot drift from the plan's numbers.
// The section starts hidden from the client; the planner shows it once they have read it.

import { extractPerformanceFigures, unverifiedFigures, type FigureReference } from "../performance/figureCheck";
import type { AssistantOp, ProposalChange, RejectedOp } from "./operations";

export const LEARNINGS_SECTION = "performanceLearnings";
const MAX_LEARNINGS = 6;
const MAX_TEXT = 300;
/** Digital Remedy's own measures and trafficking terms, which mean nothing to a client. */
const INTERNAL_TERMS = /\bPMs?\b|performance multiplier|\bad ?groups?\b|\bchannelId\b|\bsegmentId\b/i;

export interface PerformanceLearning {
  campaignId: string;
  campaignName: string;
  findingId: string;
  learning: string;
  action: string;
}

/** What add_learning may draw on: the linked campaigns and their reviewed findings. */
export interface LearningCampaign {
  id: string;
  name: string;
  /** The client's own campaign; nothing from any other can be added. */
  own: boolean;
  findings: Array<{ id: string; headline: string; unverified: string[] }>;
  /** Every figure in the campaign's data, for checking what a learning quotes. */
  reference: FigureReference;
}

const plain = (value: unknown) => (typeof value === "string" ? value.replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim() : "");

export function readLearnings(raw: unknown): PerformanceLearning[] {
  return (Array.isArray(raw) ? raw : []).map((l: any) => ({
    campaignId: plain(l?.campaignId),
    campaignName: plain(l?.campaignName),
    findingId: plain(l?.findingId),
    learning: plain(l?.learning),
    action: plain(l?.action),
  })).filter((l) => l.learning && l.action);
}

const describe = (l: PerformanceLearning) => `${l.learning} → ${l.action}`;

export function applyLearningOps(profile: any, ops: AssistantOp[], campaigns: LearningCampaign[] | undefined) {
  const out = { changes: [] as ProposalChange[], revertOps: [] as AssistantOp[], applied: [] as AssistantOp[], rejected: [] as RejectedOp[] };
  if (ops.length === 0) return out;
  const reject = (op: AssistantOp, reason: string) => out.rejected.push({ op, reason });
  const before = readLearnings(profile.performanceLearnings);

  const checkText = (op: AssistantOp, campaign: LearningCampaign, learning: string, action: string): boolean => {
    if (learning.length > MAX_TEXT || action.length > MAX_TEXT) return reject(op, `keep each part under ${MAX_TEXT} characters`), false;
    const missing = unverifiedFigures(learning, campaign.reference);
    if (missing.length) return reject(op, `the learning quotes figures that are not in the campaign's data (${missing.join(", ")})`), false;
    if (extractPerformanceFigures(action).length) return reject(op, "the action says what the plan does without figures; the plan shows its own numbers"), false;
    if (INTERNAL_TERMS.test(`${learning} ${action}`)) return reject(op, "client text says it in the client's terms (CPA, checkouts, cost), not internal ones like PM or ad group"), false;
    return true;
  };

  // Every index refers to the list as the model read it, whatever order the operations come in.
  let items = before.map((item, index) => ({ item, index }));
  const replaced = ops.find((op) => op.type === "set_learnings") as Extract<AssistantOp, { type: "set_learnings" }> | undefined;
  if (replaced) {
    items = readLearnings(replaced.items).map((item) => ({ item, index: -1 }));
    out.applied.push(replaced);
  }
  for (const op of ops) {
    if (op.type === "edit_learning") {
      const entry = items.find((e) => e.index === op.index);
      if (!entry) { reject(op, `there is no learning ${op.index}`); continue; }
      const campaign = campaigns?.find((c) => c.id === entry.item.campaignId);
      if (!campaign) { reject(op, "that learning's campaign is no longer linked to this plan"); continue; }
      const learning = plain(op.learning) || entry.item.learning;
      const action = plain(op.action) || entry.item.action;
      if (!checkText(op, campaign, learning, action)) continue;
      out.changes.push({ kind: "text", label: "Client learning", before: describe(entry.item), after: describe({ ...entry.item, learning, action }) });
      entry.item = { ...entry.item, learning, action };
      out.applied.push(op);
    } else if (op.type === "remove_learning") {
      const entry = items.find((e) => e.index === op.index);
      if (!entry) { reject(op, `there is no learning ${op.index}`); continue; }
      items = items.filter((e) => e !== entry);
      out.changes.push({ kind: "item_removed", label: "Client learning", before: describe(entry.item), after: "Removed" });
      out.applied.push(op);
    }
  }
  for (const op of ops) {
    if (op.type !== "add_learning") continue;
    const campaign = campaigns?.find((c) => c.id === op.campaignId);
    if (!campaign) { reject(op, "that campaign is not linked to this plan"); continue; }
    if (!campaign.own) { reject(op, `${campaign.name} is not this client's campaign, so it cannot be shown to the client`); continue; }
    const finding = campaign.findings.find((f) => f.id === op.findingId);
    if (!finding) { reject(op, `${campaign.name}'s review has no finding ${op.findingId}; write the review first`); continue; }
    if (finding.unverified.length) { reject(op, `the finding "${finding.headline}" quotes figures that are not in the data (${finding.unverified.join(", ")})`); continue; }
    if (items.some((e) => e.item.campaignId === campaign.id && e.item.findingId === finding.id)) { reject(op, `"${finding.headline}" is already a learning`); continue; }
    if (items.length >= MAX_LEARNINGS) { reject(op, `the section holds at most ${MAX_LEARNINGS} learnings`); continue; }
    const learning = plain(op.learning);
    const action = plain(op.action);
    if (!learning || !action) { reject(op, "needs both the learning and what this plan does about it"); continue; }
    if (!checkText(op, campaign, learning, action)) continue;
    const item: PerformanceLearning = { campaignId: campaign.id, campaignName: campaign.name, findingId: finding.id, learning, action };
    const position = op.position !== undefined ? Math.min(op.position, items.length) : items.length;
    items.splice(position, 0, { item, index: -1 });
    out.changes.push({ kind: "item_added", label: "Client learning", before: "Not in plan", after: describe(item) });
    out.applied.push(op);
  }

  if (out.applied.length === 0) return out;
  const after = items.map((e) => e.item);
  profile.performanceLearnings = after;
  out.revertOps.push({ type: "set_learnings", items: before });
  // A section appearing for the first time starts hidden from the client, until the planner has read it.
  const hidden = new Set<string>(Array.isArray(profile.hiddenSections) ? profile.hiddenSections : []);
  if (before.length === 0 && after.length > 0 && !hidden.has(LEARNINGS_SECTION)) {
    hidden.add(LEARNINGS_SECTION);
    profile.hiddenSections = Array.from(hidden);
    out.changes.push({ kind: "section", label: "Section – Built on your campaign history", before: "Not in plan", after: "Hidden from the client until you show it" });
    out.revertOps.push({ type: "set_section_visibility", section: LEARNINGS_SECTION, hidden: false });
  }
  return out;
}
