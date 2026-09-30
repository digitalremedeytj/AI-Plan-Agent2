import assert from "node:assert/strict";
import test from "node:test";
import { platformReports } from "../performance/__fixtures__/load";
import { analyzeReportFiles } from "../performance/index";
import { LEARNINGS_SECTION } from "./learningOps";
import { applyOps, parseOps } from "./operations";
import { toLearningCampaign, type LinkedCampaign } from "./performanceContext";

const review = (unverified: string[] = []) => ({
  generatedAt: "t", generatedBy: "tj", fingerprint: "x", summary: "s",
  findings: [
    { id: "f1", kind: "worked" as const, headline: "Online video beat the campaign CPA", detail: "d", evidence: "e", confidence: "high" as const, area: "media type", unverified: [] },
    { id: "f2", kind: "didnt" as const, headline: "Paramount cost more", detail: "d", evidence: "e", confidence: "medium" as const, area: "publisher", unverified },
  ],
});

const linked = (overrides: Partial<LinkedCampaign> = {}): LinkedCampaign => ({
  campaign: { id: "c1", name: "Feb flight", advertiserName: "Acme Auto Accessories", campaignGoal: "cpa", flightEnd: "2026-03-10" },
  analysis: analyzeReportFiles(platformReports()),
  review: review(),
  reviewStale: false,
  ...overrides,
});

const context = (entry = linked(), planAdvertiser = "Acme Auto Accessories") => ({ learningCampaigns: [toLearningCampaign(entry, planAdvertiser)] });
const add = (overrides: Record<string, unknown> = {}) => parseOps([{
  type: "add_learning", campaignId: "c1", findingId: "f1",
  learning: "Online video brought in checkouts at a $20.04 CPA, below the campaign's $23.72.",
  action: "This plan keeps online video in the mix.",
  ...overrides,
}]).ops;

test("a learning from the client's own reviewed campaign is added, and the section starts hidden from the client", () => {
  const result = applyOps({ profile: {} }, add(), context());
  assert.equal(result.rejected.length, 0);
  assert.equal(result.payload.profile.performanceLearnings.length, 1);
  assert.equal(result.payload.profile.performanceLearnings[0].campaignName, "Feb flight");
  assert.ok(result.payload.profile.hiddenSections.includes(LEARNINGS_SECTION));
  assert.deepEqual(result.changes.map((c) => c.kind), ["item_added", "section"]);
});

test("reverting a learning removes it and the section it created", () => {
  const added = applyOps({ profile: {} }, add(), context());
  const reverted = applyOps(added.payload, parseOps(added.revertOps, { allowRestore: true }).ops, context());
  assert.deepEqual(reverted.payload.profile.performanceLearnings, []);
  assert.ok(!reverted.payload.profile.hiddenSections.includes(LEARNINGS_SECTION));
});

test("another advertiser's campaign never reaches the client view", () => {
  const result = applyOps({ profile: {} }, add(), context(linked(), "Other Brand"));
  assert.match(result.rejected[0].reason, /not this client's campaign/);
  assert.equal(result.payload.profile.performanceLearnings, undefined);
});

test("a learning quoting a figure that is not in the data is refused", () => {
  const result = applyOps({ profile: {} }, add({ learning: "Online video cut CPA by 40%." }), context());
  assert.match(result.rejected[0].reason, /not in the campaign's data \(40%\)/);
});

test("client text uses the client's terms, not internal measures like PM", () => {
  const result = applyOps({ profile: {} }, add({ learning: "Online video beat the campaign with a PM of 1.18." }), context());
  assert.match(result.rejected[0].reason, /client's terms/);
});

test("the action carries no figures, so it cannot drift from the plan's own numbers", () => {
  const result = applyOps({ profile: {} }, add({ action: "This plan puts 25% into online video." }), context());
  assert.match(result.rejected[0].reason, /without figures/);
});

test("a finding with unverified figures, or from an out-of-date review, cannot become a learning", () => {
  const flagged = applyOps({ profile: {} }, add({ findingId: "f2" }), context(linked({ review: review(["$61.20"]) })));
  assert.match(flagged.rejected[0].reason, /not in the data \(\$61\.20\)/);
  const stale = applyOps({ profile: {} }, add(), context(linked({ reviewStale: true })));
  assert.match(stale.rejected[0].reason, /no finding f1/);
});

test("a campaign that is not linked to the plan offers nothing", () => {
  assert.match(applyOps({ profile: {} }, add({ campaignId: "c9" }), context()).rejected[0].reason, /not linked/);
  assert.match(applyOps({ profile: {} }, add(), {}).rejected[0].reason, /not linked/);
});

test("the same finding is not added twice, and learnings are edited and removed by the index the model read", () => {
  const first = applyOps({ profile: {} }, add(), context());
  assert.match(applyOps(first.payload, add(), context()).rejected[0].reason, /already a learning/);
  const edited = applyOps(first.payload, parseOps([{ type: "edit_learning", index: 0, action: "This plan adds online video." }]).ops, context());
  assert.equal(edited.payload.profile.performanceLearnings[0].action, "This plan adds online video.");
  const removed = applyOps(edited.payload, parseOps([{ type: "remove_learning", index: 0 }]).ops, context());
  assert.deepEqual(removed.payload.profile.performanceLearnings, []);
});

test("the browser cannot restore learnings directly; only a revert may", () => {
  assert.equal(parseOps([{ type: "set_learnings", items: [{ learning: "x", action: "y" }] }]).ops.length, 0);
  assert.equal(parseOps([{ type: "set_learnings", items: [] }], { allowRestore: true }).ops.length, 1);
});
