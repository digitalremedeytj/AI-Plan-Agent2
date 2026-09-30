import assert from "node:assert/strict";
import test from "node:test";
import { buildCampaignFacts, buildMediaRecommendationPlan, channelRecordOptions } from "../planning/engine";
import { clonePlanningSettings, DEFAULT_PLANNING_SETTINGS } from "../planning/settings";
import { applyOps, parseOps } from "./operations";

const settings = clonePlanningSettings(DEFAULT_PLANNING_SETTINGS);

function payload() {
  const mediaPlan = buildMediaRecommendationPlan(buildCampaignFacts({
    kpis: ["awareness", "reach", "consideration"],
    audienceDescriptions: ["Streaming and broad digital audiences"],
    workingMediaBudget: 100_000,
    campaignFlightDays: 30,
    geography: "United States",
    creativeReadiness: { displayAssets: true, onlineVideoAssets: true, ctvVideoAssets: true, audioAssets: true, socialAssets: true, nativeContent: true },
    planningSettings: settings,
  }));
  return { profile: { channelStrategy: { mediaPlan, channelOverrides: {} as Record<string, any> } } };
}

const channelWithSpareTactic = (p: ReturnType<typeof payload>) => {
  for (const channel of p.profile.channelStrategy.mediaPlan.channels) {
    const product = p.profile.channelStrategy.mediaPlan.evaluatedCandidates.find((c) => c.product.id === channel.channelId)!.product;
    const spare = channelRecordOptions(product, settings).targetingTactics.find((o) => !channel.targetingTactics.some((t) => t.id === o.id));
    if (spare) return { channel, spare };
  }
  throw new Error("fixture needs a channel with an unused compatible tactic");
};

const context = { planningSettings: settings };
const revert = (changed: ReturnType<typeof applyOps>) => applyOps(changed.payload, parseOps(changed.revertOps, { allowRestore: true }).ops, context);

test("a compatible tactic can be added to a channel, is kept on its candidate, and reverts", () => {
  const before = payload();
  const { channel, spare } = channelWithSpareTactic(before);
  const changed = applyOps(before, [{ type: "add_channel_record", channelId: channel.channelId, recordType: "targetingTactics", recordId: spare.displayName }], context);
  assert.equal(changed.rejected.length, 0, JSON.stringify(changed.rejected));
  const plan = changed.payload.profile.channelStrategy.mediaPlan;
  const after = plan.channels.find((c: any) => c.channelId === channel.channelId);
  assert.ok(after.targetingTactics.some((t: any) => t.id === spare.id));
  assert.ok(plan.evaluatedCandidates.find((c: any) => c.product.id === channel.channelId).targetingTactics.some((t: any) => t.id === spare.id));

  const reverted = revert(changed);
  assert.equal(reverted.rejected.length, 0, JSON.stringify(reverted.rejected));
  assert.deepEqual(reverted.payload.profile.channelStrategy.mediaPlan.channels.find((c: any) => c.channelId === channel.channelId).targetingTactics, channel.targetingTactics);
});

test("a record is found by its full id, the end of its id or its name, however the model sends it", () => {
  const before = payload();
  const { channel, spare } = channelWithSpareTactic(before);
  const tail = spare.id.split(".").pop()!;
  const { ops } = parseOps([{ type: "add_channel_record", channelId: channel.channelId, recordType: "targetingTactics", value: tail, why: "Fits." }]);
  const changed = applyOps(before, ops, context);
  assert.equal(changed.rejected.length, 0, JSON.stringify(changed.rejected));
  const added = changed.payload.profile.channelStrategy.mediaPlan.channels.find((c: any) => c.channelId === channel.channelId).targetingTactics.find((t: any) => t.id === spare.id);
  assert.equal(added.rationale, "Fits.");
});

test("a record the catalog does not offer for that channel is refused, and CTV publishers point to the CTV list", () => {
  const before = payload();
  const channels = before.profile.channelStrategy.mediaPlan.channels;
  const result = applyOps(before, [{ type: "add_channel_record", channelId: channels[0].channelId, recordType: "targetingTactics", recordId: "Mind Reading" }], context);
  assert.match(result.rejected[0].reason, /not a targeting option/);
  const ctv = channels.find((c) => c.channelId === "channel.ctv");
  if (ctv) {
    const publisher = applyOps(before, [{ type: "add_channel_record", channelId: ctv.channelId, recordType: "publishers", recordId: "Hulu" }], context);
    assert.match(publisher.rejected[0].reason, /CTV publisher list/);
  }
  const noSettings = applyOps(before, [{ type: "add_channel_record", channelId: channels[0].channelId, recordType: "targetingTactics", recordId: "x" }]);
  assert.match(noSettings.rejected[0].reason, /catalog/);
});

test("removing a record takes it off the channel", () => {
  const before = payload();
  const channel = before.profile.channelStrategy.mediaPlan.channels.find((c) => c.measurementCapabilities.length > 0)!;
  const record = channel.measurementCapabilities[0];
  const changed = applyOps(before, [{ type: "remove_channel_record", channelId: channel.channelId, recordType: "measurementCapabilities", recordId: record.id }], context);
  assert.ok(!changed.payload.profile.channelStrategy.mediaPlan.channels.find((c: any) => c.channelId === channel.channelId).measurementCapabilities.some((m: any) => m.id === record.id));
  assert.equal(changed.changes[0].kind, "channel_detail");
});

test("panel text and visibility are written as the plan view's overrides, and a revert clears them", () => {
  const before = payload();
  const channelId = before.profile.channelStrategy.mediaPlan.channels[0].channelId;
  const changed = applyOps(before, [
    { type: "edit_channel_panel", channelId, panel: "activationGuidance", content: "Launch in week one with :15s." },
    { type: "hide_channel_panel", channelId, panel: "decisionRule" },
    { type: "edit_channel_panel", channelId, panel: "notAPanel", content: "x" },
  ], context);
  assert.equal(changed.rejected.length, 1);
  assert.deepEqual(changed.payload.profile.channelStrategy.channelOverrides[channelId], {
    fieldEdits: { activationGuidance: { content: "Launch in week one with :15s." } },
    hiddenPanels: ["decisionRule"],
  });
  const reverted = revert(changed);
  assert.equal(reverted.payload.profile.channelStrategy.channelOverrides[channelId], undefined);
});

test("adding a record to a hand-edited list panel lets the list show again, and a revert brings the edit back", () => {
  const before = payload();
  const { channel, spare } = channelWithSpareTactic(before);
  before.profile.channelStrategy.channelOverrides[channel.channelId] = { fieldEdits: { targetingTactics: { content: "Hand-written tactics." } } };
  const changed = applyOps(before, [{ type: "add_channel_record", channelId: channel.channelId, recordType: "targetingTactics", recordId: spare.id }], context);
  assert.equal(changed.payload.profile.channelStrategy.channelOverrides[channel.channelId].fieldEdits.targetingTactics, undefined);
  const reverted = revert(changed);
  assert.equal(reverted.payload.profile.channelStrategy.channelOverrides[channel.channelId].fieldEdits.targetingTactics.content, "Hand-written tactics.");
});

test("record changes on a channel the same proposal adds do not break its revert", () => {
  const before = payload();
  const plan = before.profile.channelStrategy.mediaPlan;
  const addable = plan.evaluatedCandidates.find((c) =>
    !plan.channels.some((ch) => ch.channelId === c.product.id) && c.product.digitalRemedyExecutable && c.product.recommendationEligible && c.product.status === "live"
    && channelRecordOptions(c.product, settings).inventoryControls.length > 0);
  if (!addable) return;
  const option = channelRecordOptions(addable.product, settings).inventoryControls[0];
  const changed = applyOps(before, [
    { type: "add_channel", channelId: addable.product.id },
    { type: "remove_channel_record", channelId: addable.product.id, recordType: "inventoryControls", recordId: addable.inventoryControls[0]?.id ?? option.id },
  ], context);
  const reverted = revert(changed);
  assert.equal(reverted.rejected.length, 0, JSON.stringify(reverted.rejected));
  assert.ok(!reverted.payload.profile.channelStrategy.mediaPlan.channels.some((c: any) => c.channelId === addable.product.id));
});
