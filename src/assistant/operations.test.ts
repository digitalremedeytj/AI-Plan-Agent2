import assert from "node:assert/strict";
import test from "node:test";
import { buildCampaignFacts, buildMediaRecommendationPlan } from "../planning/engine";
import { allocationBasisPoints } from "../planning/manualAllocations";
import { clonePlanningSettings, DEFAULT_PLANNING_SETTINGS } from "../planning/settings";
import type { MediaRecommendationPlan } from "../planning/types";
import { addableChannels, applyOps, parseOps, type AssistantOp } from "./operations";

function mediaPlan(): MediaRecommendationPlan {
  return buildMediaRecommendationPlan(buildCampaignFacts({
    kpis: ["awareness", "reach", "consideration", "engagement"],
    audienceDescriptions: ["Streaming, audio, social, and broad digital audiences"],
    workingMediaBudget: 100_000,
    campaignFlightDays: 30,
    geography: "United States",
    creativeReadiness: {
      displayAssets: true,
      onlineVideoAssets: true,
      ctvVideoAssets: true,
      audioAssets: true,
      socialAssets: true,
      nativeContent: true,
      doohAssets: true,
    },
    planningSettings: clonePlanningSettings(DEFAULT_PLANNING_SETTINGS),
  }));
}

function payload(plan = mediaPlan()) {
  return {
    budget: "$100,000",
    profile: {
      intro: "The original introduction.",
      takeaways: ["First takeaway.", "Second takeaway."],
      personas: [{ name: "Ava", age: "25-34", income: "$75k", gender: "Female", watch: "Hulu", browse: "Reddit", buy: "Target", narrative: "Ava streams nightly." }],
      ctvPublishers: [
        { publisher: "Hulu", category: "App", why: "Reaches cord-cutters." },
        { publisher: "Roku", category: "OS", why: "Scale." },
      ],
      channelStrategy: {
        rfpChannels: [],
        scoutAiRecommendedChannels: [],
        executiveInsight: "",
        budgetStrategyMode: "reallocation",
        totalRfpBudget: 100_000,
        analyzedPlanNames: [],
        generatedAt: "2026-01-01T00:00:00.000Z",
        allocationBaselineBasisPoints: allocationBasisPoints(plan),
        mediaPlan: plan,
      },
    },
  };
}

const total = (plan: MediaRecommendationPlan) => plan.channels.reduce((sum, c) => sum + c.allocationPercent, 0);
const dollars = (plan: MediaRecommendationPlan) => Math.round(plan.channels.reduce((sum, c) => sum + c.allocationDollars, 0) * 100) / 100;

/** A channel with room to move a couple of points either way. */
function flexibleChannel(plan: MediaRecommendationPlan) {
  const channel = plan.channels.find((c) => c.allocationPercent - 2 >= Math.max(c.minimumAllocationPercent, 1) && c.allocationPercent + 2 <= c.maximumAllocationPercent);
  assert.ok(channel, "fixture needs a channel with room to move");
  return channel;
}

test("an allocation change keeps the plan at exactly 100% and the working budget to the cent", () => {
  const before = payload();
  const channel = flexibleChannel(before.profile.channelStrategy.mediaPlan);
  const target = channel.allocationPercent + 2;
  const result = applyOps(before, [{ type: "set_allocation", channelId: channel.channelId, percent: target }]);

  const plan = result.payload.profile.channelStrategy.mediaPlan as MediaRecommendationPlan;
  assert.equal(result.rejected.length, 0);
  assert.equal(plan.channels.find((c) => c.channelId === channel.channelId)?.allocationPercent, target);
  assert.equal(total(plan), 100);
  assert.equal(dollars(plan), 100_000);
  assert.ok(plan.channels.every((c) => Number.isInteger(c.allocationPercent)));
  assert.equal(result.payload.profile.channelStrategy.hasManualAllocationChanges, true);
});

test("the input payload is never mutated, so a dry run cannot leak into the saved plan", () => {
  const before = payload();
  const snapshot = JSON.stringify(before);
  const channel = flexibleChannel(before.profile.channelStrategy.mediaPlan);
  applyOps(before, [
    { type: "set_allocation", channelId: channel.channelId, percent: channel.allocationPercent + 1 },
    { type: "edit_text", path: "intro", value: "A rewritten introduction." },
    { type: "remove_ctv_publisher", publisher: "Roku" },
  ]);
  assert.equal(JSON.stringify(before), snapshot);
});

test("moving points from one channel to another leaves every other channel exactly where it was", () => {
  const before = payload();
  const plan = before.profile.channelStrategy.mediaPlan;
  const from = flexibleChannel(plan);
  const to = plan.channels.find((c) => c.channelId !== from.channelId && c.allocationPercent + 2 <= c.maximumAllocationPercent)!;
  const result = applyOps(before, [
    { type: "set_allocation", channelId: from.channelId, percent: from.allocationPercent - 2 },
    { type: "set_allocation", channelId: to.channelId, percent: to.allocationPercent + 2 },
  ]);
  assert.equal(result.rejected.length, 0);
  const changed = result.changes.filter((c) => c.kind === "allocation").map((c) => c.channelId).sort();
  assert.deepEqual(changed, [from.channelId, to.channelId].sort());
});

test("a single target moves the other channels only by the points needed to stay at 100%", () => {
  const before = payload();
  const plan = before.profile.channelStrategy.mediaPlan;
  const channel = flexibleChannel(plan);
  const result = applyOps(before, [{ type: "set_allocation", channelId: channel.channelId, percent: channel.allocationPercent + 2 }]);
  const after = result.payload.profile.channelStrategy.mediaPlan as MediaRecommendationPlan;
  const others = plan.channels.filter((c) => c.channelId !== channel.channelId);
  const moved = others.reduce((sum, c) => sum + Math.abs(after.channels.find((a) => a.channelId === c.channelId)!.allocationPercent - c.allocationPercent), 0);
  assert.equal(moved, 2);
  assert.equal(total(after), 100);
});

test("a locked channel keeps its allocation while others absorb the change", () => {
  const before = payload();
  const plan = before.profile.channelStrategy.mediaPlan;
  const channel = flexibleChannel(plan);
  const locked = plan.channels.find((c) => c.channelId !== channel.channelId)!;
  const result = applyOps(before, [
    { type: "lock_channel", channelId: locked.channelId },
    { type: "set_allocation", channelId: channel.channelId, percent: channel.allocationPercent - 2 },
  ]);
  const after = result.payload.profile.channelStrategy;
  assert.deepEqual(after.lockedAllocationChannelIds, [locked.channelId]);
  assert.equal(after.mediaPlan.channels.find((c: any) => c.channelId === locked.channelId).allocationPercent, locked.allocationPercent);
  assert.equal(total(after.mediaPlan), 100);
});

test("several allocation targets are solved together instead of undoing each other", () => {
  const before = payload();
  const plan = before.profile.channelStrategy.mediaPlan;
  const first = flexibleChannel(plan);
  const second = plan.channels.find((c) => c.channelId !== first.channelId && c.allocationPercent + 1 <= c.maximumAllocationPercent)!;
  const result = applyOps(before, [
    { type: "set_allocation", channelId: first.channelId, percent: first.allocationPercent - 2 },
    { type: "set_allocation", channelId: second.channelId, percent: second.allocationPercent + 1 },
  ]);
  const after = result.payload.profile.channelStrategy.mediaPlan.channels;
  assert.equal(after.find((c: any) => c.channelId === first.channelId).allocationPercent, first.allocationPercent - 2);
  assert.equal(after.find((c: any) => c.channelId === second.channelId).allocationPercent, second.allocationPercent + 1);
});

test("ScoutAI can set an allocation outside the catalog's recommended range", () => {
  const before = payload();
  const channel = before.profile.channelStrategy.mediaPlan.channels[0];
  const percent = Math.min(100, Math.floor(channel.maximumAllocationPercent) + 5);
  const result = applyOps(before, [{ type: "set_allocation", channelId: channel.channelId, percent }]);
  assert.equal(result.rejected.length, 0);
  const plan = result.payload.profile.channelStrategy.mediaPlan as MediaRecommendationPlan;
  assert.equal(plan.channels.find((c) => c.channelId === channel.channelId)!.allocationPercent, percent);
  assert.equal(plan.channels.reduce((sum, c) => sum + c.allocationPercent, 0), 100);
});

test("an allocation that cannot add up is rejected with the reason and changes nothing", () => {
  const before = payload();
  const channels = before.profile.channelStrategy.mediaPlan.channels;
  before.profile.channelStrategy.lockedAllocationChannelIds = channels.slice(1).map((c: any) => c.channelId);
  const result = applyOps(before, [{ type: "set_allocation", channelId: channels[0].channelId, percent: 100 }]);
  assert.equal(result.ops.length, 0);
  assert.equal(result.changes.length, 0);
  assert.match(result.rejected[0].reason, /more than 100%|add up|unlock/i);
});

test("a budget change rescales dollars, keeps the mix, and updates the brief's budget field", () => {
  const before = payload();
  const percents = before.profile.channelStrategy.mediaPlan.channels.map((c) => c.allocationPercent);
  const result = applyOps(before, [{ type: "set_budget", amount: 150_000 }]);
  const plan = result.payload.profile.channelStrategy.mediaPlan as MediaRecommendationPlan;
  assert.equal(plan.workingMediaBudget, 150_000);
  assert.equal(dollars(plan), 150_000);
  assert.deepEqual(plan.channels.map((c) => c.allocationPercent), percents);
  assert.equal(result.payload.budget, "$150,000");
  assert.ok(result.changes.some((c) => c.kind === "budget" && c.before === "$100,000" && c.after === "$150,000"));
});

test("adding and removing channels updates the manual include and exclude lists like the manual controls", () => {
  const before = payload();
  const plan = before.profile.channelStrategy.mediaPlan;
  const addable = addableChannels(plan)[0];
  const removable = plan.channels[plan.channels.length - 1];
  const ops: AssistantOp[] = [{ type: "remove_channel", channelId: removable.channelId }];
  if (addable) ops.push({ type: "add_channel", channelId: addable.product.id });
  const result = applyOps(before, ops);
  const strategy = result.payload.profile.channelStrategy;
  assert.ok(!strategy.mediaPlan.channels.some((c: any) => c.channelId === removable.channelId));
  assert.ok(strategy.manualExcludedChannelIds.includes(removable.channelId));
  if (addable) {
    assert.ok(strategy.mediaPlan.channels.some((c: any) => c.channelId === addable.product.id));
    assert.ok(strategy.manualIncludedChannelIds.includes(addable.product.id));
  }
  assert.equal(total(strategy.mediaPlan), 100);
  assert.equal(strategy.hasManualAllocationChanges, false);
});

test("text edits are limited to the prose fields the QA fixer may touch", () => {
  const result = applyOps(payload(), [
    { type: "edit_text", path: "intro", value: "A sharper introduction." },
    { type: "edit_text", path: "personas[0].age", value: "35-44" },
    { type: "edit_text", path: "channelStrategy.mediaPlan.channels[0].allocationPercent", value: "90" },
  ]);
  assert.equal(result.payload.profile.intro, "A sharper introduction.");
  assert.equal(result.payload.profile.personas[0].age, "25-34");
  assert.equal(result.rejected.length, 2);
  assert.deepEqual(result.changes.map((c) => c.label), ["Introduction"]);
});

test("a channel text edit lands on the right channel when the same proposal removes another, and reverts cleanly", () => {
  const before = payload();
  const channels = before.profile.channelStrategy.mediaPlan.channels;
  const lastIndex = channels.length - 1;
  const edited = channels[lastIndex];
  const changed = applyOps(before, [
    { type: "remove_channel", channelId: channels[0].channelId },
    { type: "edit_text", path: `channelStrategy.mediaPlan.channels[${lastIndex}].gapAddressed`, value: "New words." },
  ]);
  assert.equal(changed.rejected.length, 0, JSON.stringify(changed.rejected));
  const after = changed.payload.profile.channelStrategy.mediaPlan.channels;
  assert.equal(after.find((c: any) => c.channelId === edited.channelId).gapAddressed, "New words.");

  const reverted = applyOps(changed.payload, changed.revertOps);
  assert.equal(reverted.rejected.length, 0, JSON.stringify(reverted.rejected));
  const restored = reverted.payload.profile.channelStrategy.mediaPlan.channels;
  assert.equal(restored.find((c: any) => c.channelId === edited.channelId).gapAddressed, edited.gapAddressed);
  assert.ok(restored.some((c: any) => c.channelId === channels[0].channelId));
});

test("editing the text of a channel the same proposal removes is refused", () => {
  const before = payload();
  const result = applyOps(before, [
    { type: "remove_channel", channelId: before.profile.channelStrategy.mediaPlan.channels[0].channelId },
    { type: "edit_text", path: "channelStrategy.mediaPlan.channels[0].gapAddressed", value: "Pointless." },
  ]);
  assert.ok(result.rejected.some((r) => /removed in the same proposal/.test(r.reason)));
});

test("removing a CTV publisher keeps the plan's two publisher lists in step", () => {
  const before = payload();
  (before.profile.channelStrategy as any).ctvPublishers = before.profile.ctvPublishers;
  const result = applyOps(before, [{ type: "remove_ctv_publisher", publisher: "roku" }]);
  assert.deepEqual(result.payload.profile.ctvPublishers.map((p: any) => p.publisher), ["Hulu"]);
  assert.deepEqual(result.payload.profile.channelStrategy.ctvPublishers.map((p: any) => p.publisher), ["Hulu"]);
});

test("the revert operations put allocations, budget, locks, publishers and text back exactly", () => {
  const before = payload();
  const plan = before.profile.channelStrategy.mediaPlan;
  const channel = flexibleChannel(plan);
  const locked = plan.channels.find((c) => c.channelId !== channel.channelId)!;
  const changed = applyOps(before, [
    { type: "lock_channel", channelId: locked.channelId },
    { type: "set_allocation", channelId: channel.channelId, percent: channel.allocationPercent + 2 },
    { type: "set_budget", amount: 120_000 },
    { type: "remove_ctv_publisher", publisher: "Hulu" },
    { type: "edit_text", path: "takeaways[1]", value: "A rewritten takeaway." },
  ]);
  assert.equal(changed.rejected.length, 0);

  const reverted = applyOps(changed.payload, changed.revertOps);
  assert.equal(reverted.rejected.length, 0, JSON.stringify(reverted.rejected));
  const restored = reverted.payload.profile;
  assert.deepEqual(
    restored.channelStrategy.mediaPlan.channels.map((c: any) => [c.channelId, c.allocationPercent, c.allocationDollars]),
    plan.channels.map((c) => [c.channelId, c.allocationPercent, c.allocationDollars]),
  );
  assert.equal(restored.channelStrategy.mediaPlan.workingMediaBudget, 100_000);
  assert.deepEqual(restored.channelStrategy.lockedAllocationChannelIds, []);
  assert.deepEqual(restored.ctvPublishers, before.profile.ctvPublishers);
  assert.equal(restored.takeaways[1], "Second takeaway.");
  assert.equal(reverted.payload.budget, "$100,000");
});

test("a removed channel can be reverted back into the plan at its old allocation", () => {
  const before = payload();
  const plan = before.profile.channelStrategy.mediaPlan;
  const removed = plan.channels[0];
  const changed = applyOps(before, [{ type: "remove_channel", channelId: removed.channelId }]);
  const reverted = applyOps(changed.payload, changed.revertOps);
  assert.equal(reverted.rejected.length, 0, JSON.stringify(reverted.rejected));
  const channels = reverted.payload.profile.channelStrategy.mediaPlan.channels;
  for (const original of plan.channels) {
    assert.equal(channels.find((c: any) => c.channelId === original.channelId)?.allocationPercent, original.allocationPercent);
  }
});

test("operations from the model are parsed strictly and a restore is accepted only from a revert", () => {
  const { ops, rejected } = parseOps([
    { type: "set_allocation", channelId: "channel.ctv", percent: 30 },
    { type: "set_allocation", channelId: "channel.ctv", percent: 30.5 },
    { type: "set_budget", amount: -5 },
    { type: "delete_plan" },
    { type: "restore_ctv_publisher", publisher: "Hulu", index: 0 },
  ]);
  assert.deepEqual(ops, [{ type: "set_allocation", channelId: "channel.ctv", percent: 30 }]);
  assert.equal(rejected.length, 4);
  assert.equal(parseOps([{ type: "restore_ctv_publisher", publisher: "Hulu", index: 0 }], { allowRestore: true }).ops.length, 1);
});

test("markdown bullets in a proposed text edit are stored as plain '- ' lines, but a revert restores the text exactly", () => {
  const value = "Lead in: * **Reach (Hulu)**: wide. * **Scale (Tubi)**: cheap.";
  const [proposed] = parseOps([{ type: "edit_text", path: "publisherInsights", value }]).ops as Array<{ value: string }>;
  assert.equal(proposed.value, "Lead in:\n- Reach (Hulu): wide.\n- Scale (Tubi): cheap.");
  const [reverted] = parseOps([{ type: "edit_text", path: "publisherInsights", value }], { allowRestore: true }).ops as Array<{ value: string }>;
  assert.equal(reverted.value, value);
});

test("ScoutAI rewrites a publisher's justification by name, in both publisher lists, and its revert puts the old one back", () => {
  const before = payload();
  (before.profile as any).ctvPublishers = [...before.profile.ctvPublishers, { publisher: "BET", category: "Network", why: "", isUserAdded: true }];
  (before.profile.channelStrategy as any).ctvPublishers = before.profile.ctvPublishers;
  const { ops } = parseOps([{ type: "edit_ctv_publisher", publisher: "bet", why: "Adds incremental household reach." }]);
  const changed = applyOps(before, ops);
  assert.equal(changed.rejected.length, 0, JSON.stringify(changed.rejected));
  const bet = changed.payload.profile.ctvPublishers.find((p: any) => p.publisher === "BET");
  assert.deepEqual(bet, { publisher: "BET", category: "Network", why: "Adds incremental household reach.", isUserAdded: true });
  assert.equal(changed.payload.profile.channelStrategy.ctvPublishers.find((p: any) => p.publisher === "BET").why, "Adds incremental household reach.");
  assert.equal(changed.changes[0].before, "No justification");

  // The revert restores an empty justification, which the model itself may never send.
  const reverted = applyOps(changed.payload, parseOps(changed.revertOps, { allowRestore: true }).ops);
  assert.equal(reverted.payload.profile.ctvPublishers.find((p: any) => p.publisher === "BET").why, "");
  assert.equal(parseOps([{ type: "edit_ctv_publisher", publisher: "BET", why: "" }]).ops.length, 0);
});

test("a justification for a publisher the plan does not hold is refused", () => {
  const result = applyOps(payload(), [{ type: "edit_ctv_publisher", publisher: "ESPN", why: "Live sports." }]);
  assert.match(result.rejected[0].reason, /not one of the plan's CTV publishers/);
});
