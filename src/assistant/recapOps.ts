// Changes to the Campaign Recap through the plan's operations, so they share its revision check
// and undo. The recap's figures are never edited here: they come from the campaign data when it
// is built. The planner can remove a card or recommendation, and a recommendation is marked
// "In this plan" when the change that carries it out is applied.

import type { CampaignRecap } from "../performance/recap";
import type { AssistantOp, ProposalChange, RejectedOp } from "./operations";

export function applyRecapOps(profile: any, ops: AssistantOp[]) {
  const out = { changes: [] as ProposalChange[], revertOps: [] as AssistantOp[], applied: [] as AssistantOp[], rejected: [] as RejectedOp[] };
  if (ops.length === 0) return out;
  const before: CampaignRecap | undefined = profile.campaignRecap ? JSON.parse(JSON.stringify(profile.campaignRecap)) : undefined;

  for (const op of ops) {
    if (op.type === "set_campaign_recap") {
      if (op.recap) profile.campaignRecap = op.recap;
      else delete profile.campaignRecap;
      out.changes.push({ kind: "section", label: "Campaign recap", before: "Changed", after: "Restored" });
      out.applied.push(op);
      continue;
    }
    const recap: CampaignRecap | undefined = profile.campaignRecap;
    if (op.type === "mark_recap_recommendation") {
      const rec = recap?.recommendations.find((r) => r.id === op.id);
      // Marking rides along with the change that carries the recommendation out. A recap rebuilt
      // in between no longer has it; that must not block the change itself.
      if (!rec || Boolean(rec.appliedAt) === op.applied) continue;
      rec.appliedAt = op.applied ? new Date().toISOString() : null;
      out.changes.push({ kind: "section", label: `Campaign recap – ${rec.title}`, before: op.applied ? "Recommended" : "In this plan", after: op.applied ? "In this plan" : "Recommended" });
      out.applied.push(op);
    } else if (op.type === "remove_recap_item") {
      if (!recap) { out.rejected.push({ op, reason: "this plan has no campaign recap" }); continue; }
      if (op.kind === "recommendation") {
        const rec = recap.recommendations.find((r) => r.id === op.id);
        if (!rec) { out.rejected.push({ op, reason: "that recommendation is not in the recap" }); continue; }
        recap.recommendations = recap.recommendations.filter((r) => r !== rec);
        out.changes.push({ kind: "item_removed", label: "Campaign recap – recommendation", before: rec.title, after: "Removed" });
      } else {
        const campaign = recap.campaigns.find((c) => c.cards.some((card) => card.id === op.id));
        const card = campaign?.cards.find((c) => c.id === op.id);
        if (!campaign || !card) { out.rejected.push({ op, reason: "that card is not in the recap" }); continue; }
        campaign.cards = campaign.cards.filter((c) => c !== card);
        out.changes.push({ kind: "item_removed", label: "Campaign recap – finding", before: card.headline, after: "Removed" });
      }
      out.applied.push(op);
    }
  }
  if (out.applied.some((op) => op.type !== "set_campaign_recap")) out.revertOps.push({ type: "set_campaign_recap", recap: before ?? null });
  return out;
}
