import assert from "node:assert/strict";
import test from "node:test";
import { applyOps, parseOps } from "./operations";

const rec = (title: string) => ({ title, action: `Do ${title}.`, why: `Because ${title}.`, channels: "CTV" });

function payload() {
  return {
    profile: {
      takeaways: ["T1", "T2", "T3", "T4"],
      recommendations: [rec("R1"), rec("R2")],
      hiddenSections: ["deviceSplit"],
      ctvPublishers: [{ publisher: "Hulu", category: "App", why: "Reach." }],
      channelStrategy: {
        ctvPublishers: [{ publisher: "Hulu", category: "App", why: "Reach." }],
        mediaPlan: {
          channels: [
            { channelId: "channel.ctv", channelName: "CTV / OTT", publishers: [{ id: "old", displayName: "Old", rationale: "" }] },
            { channelId: "channel.search", channelName: "Search", publishers: [] },
          ],
        },
      },
    },
  };
}

const catalog = [
  { name: "Roku", category: "OS", enabled: true },
  { name: "Tubi", category: "App", enabled: false },
];

const revert = (changed: ReturnType<typeof applyOps>, context = {}) => applyOps(changed.payload, parseOps(changed.revertOps, { allowRestore: true }).ops, context);

test("list positions refer to the list as the model read it, whatever order the operations arrive in", () => {
  const changed = applyOps(payload(), [
    { type: "move_item", list: "takeaways", index: 3, position: 0 },
    { type: "remove_takeaway", index: 1 },
    { type: "add_takeaway", value: "T5" },
  ]);
  assert.equal(changed.rejected.length, 0, JSON.stringify(changed.rejected));
  assert.deepEqual(changed.payload.profile.takeaways, ["T4", "T1", "T3", "T5"]);
});

test("a list change and an edit to one of its items revert to exactly the original list", () => {
  const before = payload();
  const changed = applyOps(before, [
    { type: "edit_text", path: "recommendations[1].why", value: "A sharper reason." },
    { type: "add_recommendation", title: "R3", action: "Do R3.", why: "Because R3.", channels: "Audio", position: 0 },
  ]);
  assert.deepEqual(changed.payload.profile.recommendations.map((r: any) => r.title), ["R3", "R1", "R2"]);
  assert.equal(changed.payload.profile.recommendations[2].why, "A sharper reason.");

  const reverted = revert(changed);
  assert.equal(reverted.rejected.length, 0, JSON.stringify(reverted.rejected));
  assert.deepEqual(reverted.payload.profile.recommendations, before.profile.recommendations);
});

test("editing an item the same proposal removes is refused, and an incomplete recommendation is rejected", () => {
  const result = applyOps(payload(), [
    { type: "remove_takeaway", index: 2 },
    { type: "edit_text", path: "takeaways[2]", value: "Pointless." },
    { type: "add_recommendation", title: "R9", action: "", why: "x", channels: "" },
  ]);
  assert.equal(result.rejected.length, 2);
  assert.deepEqual(result.payload.profile.takeaways, ["T1", "T2", "T4"]);
});

test("sections hide and show by key, legacy keys included, and revert", () => {
  const before = payload();
  const changed = applyOps(before, [
    { type: "set_section_visibility", section: "deviceShare", hidden: false },
    { type: "set_section_visibility", section: "sources", hidden: true },
    { type: "set_section_visibility", section: "nonsense", hidden: true },
  ]);
  assert.deepEqual(changed.payload.profile.hiddenSections, ["sources"]);
  assert.equal(changed.rejected.length, 1);
  const reverted = revert(changed);
  assert.deepEqual([...reverted.payload.profile.hiddenSections].sort(), ["deviceShare"]);
});

test("a CTV publisher can be added only from the enabled catalog, and the CTV channel lists the same publishers", () => {
  const changed = applyOps(payload(), [
    { type: "add_ctv_publisher", publisher: "roku", why: "Reaches cord-cutters on the big screen." },
    { type: "add_ctv_publisher", publisher: "Tubi", why: "x" },
    { type: "add_ctv_publisher", publisher: "Made Up TV", why: "x" },
  ], { publisherCatalog: catalog });
  assert.equal(changed.rejected.length, 2);
  const profile = changed.payload.profile;
  assert.deepEqual(profile.ctvPublishers.map((p: any) => p.publisher), ["Hulu", "Roku"]);
  assert.equal(profile.ctvPublishers[1].category, "OS");
  assert.deepEqual(profile.channelStrategy.ctvPublishers.map((p: any) => p.publisher), ["Hulu", "Roku"]);
  assert.deepEqual(profile.channelStrategy.mediaPlan.channels[0].publishers.map((p: any) => p.displayName), ["Hulu", "Roku"]);
  assert.deepEqual(profile.channelStrategy.mediaPlan.channels[1].publishers, []);

  const reverted = revert(changed);
  assert.deepEqual(reverted.payload.profile.ctvPublishers.map((p: any) => p.publisher), ["Hulu"]);
});

test("without a catalog, adding a publisher is refused rather than guessed", () => {
  const result = applyOps(payload(), [{ type: "add_ctv_publisher", publisher: "Roku", why: "x" }]);
  assert.match(result.rejected[0].reason, /not an available publisher/);
});

test("hiding a section works however the model phrases it", () => {
  const { ops } = parseOps([
    { type: "hide_section", section: "domainAffinity" },
    { type: "set_section_visibility", section: "sources", hidden: "true" },
  ]);
  const result = applyOps(payload(), ops);
  assert.equal(result.rejected.length, 0);
  assert.deepEqual([...result.payload.profile.hiddenSections].sort(), ["deviceSplit", "domainAffinity", "sources"]);
});

test("a whole-list restore is accepted only from a revert", () => {
  assert.equal(parseOps([{ type: "set_list", list: "takeaways", items: ["x"] }]).ops.length, 0);
  assert.equal(parseOps([{ type: "set_list", list: "takeaways", items: ["x"] }], { allowRestore: true }).ops.length, 1);
});
