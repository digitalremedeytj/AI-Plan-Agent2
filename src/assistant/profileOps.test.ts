import assert from "node:assert/strict";
import test from "node:test";
import { applyOps, parseOps } from "./operations";

const persona = (name: string, extra: Record<string, string> = {}) => ({
  name, age: "30-39", income: "$80k", gender: "Female", watch: "Hulu", browse: "Reddit", buy: "Target", narrative: `${name} streams.`,
  avatarUrl: `data:image/png;base64,${name}`, ...extra,
});

function payload() {
  return {
    kpis: ["Awareness"],
    geography: "United States",
    geographyConfig: { type: "National", targets: [] },
    profile: {
      personas: [persona("Ava"), persona("Ben"), persona("Cal")],
      segmentRecommendations: [
        { id: "s1", name: "New Parents", dimension: "Demographics", justification: "Core.", tier: "Core", personaIndices: [0, 2], source: "ScoutAI" },
        { id: "s2", name: "Pet Owners", dimension: "Interest & Affinity", justification: "Adjacent.", personaIndices: [1], source: "ScoutAI" },
      ],
      briefOfRecord: {
        advertiser: "Acme", whatTheySell: "Dog food", productCategories: ["Pet food"], businessModel: "DTC", priceTier: "premium",
        audienceType: "B2C", primaryAudience: "Dog owners", includedSegments: ["Dog owners"], coreSegments: ["Dog owners"],
        excludedSegments: [], campaignObjective: "Awareness", funnelEmphasis: "awareness", geography: "United States", uncertainties: [], basis: "brief only",
      },
    },
  };
}

const names = (p: any) => p.profile.personas.map((x: any) => x.name);
const tags = (p: any, id: string) => {
  const segment = p.profile.segmentRecommendations.find((s: any) => s.id === id);
  return segment.personaIndices.map((i: number) => p.profile.personas[i].name);
};

test("replacing a persona renames it, drops its old headshot for a new one, and a revert brings both back", () => {
  const before = payload();
  const changed = applyOps(before, [{ type: "update_persona", persona: "ben", fields: { name: "Dana", age: "45-54", narrative: "Dana buys premium." } }]);
  assert.equal(changed.rejected.length, 0);
  const dana = changed.payload.profile.personas[1];
  assert.equal(dana.name, "Dana");
  assert.equal(dana.age, "45-54");
  assert.equal(dana.avatarUrl, undefined);
  assert.deepEqual(changed.changes.map((c) => c.label), ["Ben – name", "Ben – age", "Ben – narrative"]);

  const reverted = applyOps(changed.payload, parseOps(changed.revertOps, { allowRestore: true }).ops);
  assert.equal(reverted.rejected.length, 0, JSON.stringify(reverted.rejected));
  assert.deepEqual(reverted.payload.profile.personas[1], before.profile.personas[1]);
});

test("a text-only persona change keeps the headshot", () => {
  const changed = applyOps(payload(), [{ type: "update_persona", persona: "Ava", fields: { watch: "Netflix" } }]);
  assert.equal(changed.payload.profile.personas[0].avatarUrl, "data:image/png;base64,Ava");
});

test("removing a persona keeps every segment tagged to the right remaining personas, and a revert restores the tags", () => {
  const before = payload();
  const changed = applyOps(before, [{ type: "remove_persona", persona: "Ava" }]);
  assert.deepEqual(names(changed.payload), ["Ben", "Cal"]);
  assert.deepEqual(tags(changed.payload, "s1"), ["Cal"]);
  assert.deepEqual(tags(changed.payload, "s2"), ["Ben"]);

  const reverted = applyOps(changed.payload, parseOps(changed.revertOps, { allowRestore: true }).ops);
  assert.deepEqual(names(reverted.payload), ["Ava", "Ben", "Cal"]);
  assert.deepEqual(tags(reverted.payload, "s1"), ["Ava", "Cal"]);
  assert.equal(reverted.payload.profile.personas[0].avatarUrl, "data:image/png;base64,Ava");
});

test("a new persona and a segment tagged to it can arrive in one proposal", () => {
  const changed = applyOps(payload(), [
    { type: "add_segment", name: "Senior Dog Owners", dimension: "Demographics", justification: "Older dogs need special diets.", personas: ["Eve"] },
    { type: "add_persona", fields: { name: "Eve", age: "55-64", income: "$120k", gender: "Female", watch: "PBS", browse: "AARP", buy: "Chewy", narrative: "Eve has an older dog." } },
  ]);
  assert.equal(changed.rejected.length, 0, JSON.stringify(changed.rejected));
  const added = changed.payload.profile.segmentRecommendations.find((s: any) => s.name === "Senior Dog Owners");
  assert.deepEqual(added.personaIndices.map((i: number) => changed.payload.profile.personas[i].name), ["Eve"]);
  assert.equal(changed.payload.profile.personas[3].sourceType, "ScoutAI");
});

test("an incomplete new persona, a duplicate name and removing the last persona are all refused", () => {
  const partial = applyOps(payload(), [{ type: "add_persona", fields: { name: "Zed" } }]);
  assert.match(partial.rejected[0].reason, /needs/);
  const duplicate = applyOps(payload(), [{ type: "update_persona", persona: "Ava", fields: { name: "Ben" } }]);
  assert.match(duplicate.rejected[0].reason, /already named/);
  const solo = { profile: { personas: [persona("Solo")], segmentRecommendations: [] } };
  assert.match(applyOps(solo, [{ type: "remove_persona", persona: "Solo" }]).rejected[0].reason, /at least one/);
});

test("segment edits, removals and their reverts round-trip exactly", () => {
  const before = payload();
  const changed = applyOps(before, [
    { type: "edit_segment", segmentId: "s1", name: "Expecting Parents", tier: "Expansion", personas: ["Ben"] },
    { type: "remove_segment", segmentId: "s2" },
  ]);
  assert.equal(changed.rejected.length, 0, JSON.stringify(changed.rejected));
  assert.deepEqual(tags(changed.payload, "s1"), ["Ben"]);
  assert.equal(changed.payload.profile.segmentRecommendations.length, 1);

  const reverted = applyOps(changed.payload, parseOps(changed.revertOps, { allowRestore: true }).ops);
  assert.equal(reverted.rejected.length, 0, JSON.stringify(reverted.rejected));
  assert.deepEqual(reverted.payload.profile.segmentRecommendations, before.profile.segmentRecommendations);
});

test("brief of record edits are validated per field and mark the plan as built from an earlier brief", () => {
  const changed = applyOps(payload(), [
    { type: "edit_brief", field: "primaryAudience", value: "Owners of senior dogs" },
    { type: "edit_brief", field: "coreSegments", values: ["Senior dog owners", "Vets"] },
    { type: "edit_brief", field: "funnelEmphasis", value: "loyalty" },
    { type: "edit_brief", field: "basis", value: "brief + website" },
  ]);
  const brief = changed.payload.profile.briefOfRecord;
  assert.equal(brief.primaryAudience, "Owners of senior dogs");
  assert.deepEqual(brief.coreSegments, ["Senior dog owners", "Vets"]);
  assert.equal(brief.funnelEmphasis, "awareness");
  assert.equal(changed.rejected.length, 2);
  assert.deepEqual(changed.payload.profile.briefOfRecordEdited.fields, ["primaryAudience", "coreSegments"]);
});

test("KPI and geography changes update the brief inputs and a revert restores the geography picker state", () => {
  const before = payload();
  const changed = applyOps(before, [
    { type: "set_kpis", values: ["Awareness", "Site visits"] },
    { type: "set_geography", value: "DMA: New York, Los Angeles" },
  ]);
  assert.deepEqual(changed.payload.kpis, ["Awareness", "Site visits"]);
  assert.equal(changed.payload.geography, "DMA: New York, Los Angeles");
  assert.equal(changed.payload.geographyConfig, undefined);

  const reverted = applyOps(changed.payload, parseOps(changed.revertOps, { allowRestore: true }).ops);
  assert.deepEqual(reverted.payload.kpis, before.kpis);
  assert.equal(reverted.payload.geography, before.geography);
  assert.deepEqual(reverted.payload.geographyConfig, before.geographyConfig);
});

test("a geography change replaces the plan's saved footprint, and a revert brings the old one back", () => {
  const before = payload();
  const boston = { type: "DMA" as const, targets: ["Boston (Manchester), MA"] };
  const changed = applyOps(before, [{ type: "set_geography", value: "DMA (Boston)", config: boston }]);
  assert.deepEqual(changed.payload.profile.geoTargeting.entries.map((entry: { id: string }) => entry.id), ["506"]);

  const reverted = applyOps(changed.payload, parseOps(changed.revertOps, { allowRestore: true }).ops);
  // The original plan was national, which has no saved footprint.
  assert.equal(reverted.payload.profile.geoTargeting, undefined);
});

test("persona text goes through update_persona, and restores are refused outside a revert", () => {
  const viaText = applyOps(payload(), [{ type: "edit_text", path: "personas[0].narrative", value: "New." }]);
  assert.match(viaText.rejected[0].reason, /update_persona/);
  const parsed = parseOps([
    { type: "restore_persona", index: 0, persona: persona("Mallory"), segmentIds: [] },
    { type: "update_persona", persona: "Ava", fields: { watch: "X" }, avatar: { avatarUrl: "data:evil" } },
  ]);
  assert.equal(parsed.ops.length, 1);
  assert.equal((parsed.ops[0] as any).avatar, undefined);
});
