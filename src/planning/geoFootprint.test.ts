import assert from "node:assert/strict";
import test from "node:test";
import type { GeoTargeting } from "../types";
import { buildGeoFootprint, footprintSummary, geoPlanFacts, geoSnapshotFromBrief, precisionTargets, rehydrateGeoSnapshot, splitByHouseholds, thinMarketAlert } from "./geoFootprint";

const NEW_ENGLAND = { type: "DMA" as const, targets: ["Boston (Manchester), MA", "Hartford & New Haven, CT", "Providence-New Bedford, RI"] };

test("a national brief has no footprint section", () => {
  assert.equal(geoSnapshotFromBrief({ type: "National", targets: [] }), undefined);
  assert.equal(buildGeoFootprint({ targeting: undefined, plannedBudget: 500_000 }), null);
  assert.equal(buildGeoFootprint({ targeting: { scope: "national", entries: [], unresolved: [], inputMethod: "select" }, plannedBudget: 500_000 }), null);
});

test("the snapshot carries the households the plan was sized to and the planner's market names", () => {
  const snapshot = geoSnapshotFromBrief(NEW_ENGLAND)!;
  assert.equal(snapshot.scope, "dma");
  assert.deepEqual(snapshot.entries.map((entry) => entry.id), ["506", "533", "521"]);
  assert.equal(snapshot.entries[0].name, "Boston (Manchester), MA");
  assert.equal(snapshot.entries[0].tvHouseholds, 2_424_240);
});

test("a saved footprint keeps its numbers when the reference data changes", () => {
  const snapshot = geoSnapshotFromBrief(NEW_ENGLAND)!;
  const frozen: GeoTargeting = { ...snapshot, entries: snapshot.entries.map((entry) => ({ ...entry, tvHouseholds: 1_000_000 })) };
  const view = buildGeoFootprint({ targeting: frozen, plannedBudget: 300_000 })!;
  assert.equal(view.households, 3_000_000);
  assert.deepEqual(view.rows.map((row) => row.budget), [100_000, 100_000, 100_000]);
});

test("per-market budgets follow households and add back up to the plan total", () => {
  const view = buildGeoFootprint({ targeting: geoSnapshotFromBrief(NEW_ENGLAND), plannedBudget: 500_000 })!;
  assert.deepEqual(view.rows.map((row) => row.id), ["506", "533", "521"]);
  assert.equal(view.rows.reduce((sum, row) => sum + (row.budget || 0), 0), 500_000);
  assert.ok(view.rows[0].budget! > view.rows[1].budget! && view.rows[1].budget! > view.rows[2].budget!);
  assert.equal(view.rows.reduce((sum, row) => sum + row.sharePct, 0), 100);
});

test("an odd total still splits to the dollar", () => {
  const split = splitByHouseholds(100_001, [1, 1, 1]);
  assert.equal(split.reduce((a, b) => a + b, 0), 100_001);
});

test("a plan with no allocated budget shows shares without dollars", () => {
  const view = buildGeoFootprint({ targeting: geoSnapshotFromBrief(NEW_ENGLAND), plannedBudget: 0 })!;
  assert.ok(view.rows.every((row) => row.budget === undefined));
});

test("DMA coverage names every state the markets deliver into", () => {
  const view = buildGeoFootprint({ targeting: geoSnapshotFromBrief(NEW_ENGLAND), plannedBudget: 0 })!;
  assert.deepEqual(view.coveredStates, ["CT", "MA", "NH", "RI", "VT"]);
  assert.match(view.coverageNote, /These markets reach viewers across 5 states/);
});

test("state coverage reads spill as reach over the state line, not as a warning", () => {
  const view = buildGeoFootprint({ targeting: geoSnapshotFromBrief({ type: "State", targets: ["Virginia (VA)", "Maryland (MD)"] }), plannedBudget: 0 })!;
  assert.deepEqual(view.coveredStates, ["VA", "MD"]);
  assert.ok(view.alsoReachedStates.includes("WV"));
  assert.match(view.coverageNote, /served by \d+ TV markets\..*also reach parts of .*West Virginia/);
  assert.match(view.rows[0].detail, /^\d+ DMAs?$/);
});

test("a pick that cannot be sized is reported, not counted", () => {
  const view = buildGeoFootprint({ targeting: geoSnapshotFromBrief({ type: "State", targets: ["Virginia (VA)", "Puerto Rico (PR)"] }), plannedBudget: 0 })!;
  assert.deepEqual(view.rows.map((row) => row.id), ["VA"]);
  assert.deepEqual(view.unsized, ["Puerto Rico (PR)"]);
});

test("notes become precision chips, naming geofence only when the plan buys it", () => {
  const notes = "Prudential Center + 2 mi\nExclude Cape Cod ZIPs; ZIPs 02108, 02109\nFocus on commuters";
  assert.deepEqual(precisionTargets(notes, []), [
    { kind: "radius", label: "Prudential Center + 2 mi", action: "Radius applied at activation" },
    { kind: "exclusion", label: "Exclude Cape Cod ZIPs", action: "Excluded at activation" },
    { kind: "zip", label: "ZIPs 02108, 02109", action: "ZIP targeting at activation" },
  ]);
  assert.equal(precisionTargets("Prudential Center + 2 mi", ["Geofence Video"])[0].action, "Geofence Video");
});

test("the saved footprint keeps the planner's notes, and its chips read them over the brief's", () => {
  const snapshot = geoSnapshotFromBrief({ ...NEW_ENGLAND, rawInput: "Prudential Center + 2 mi" })!;
  assert.equal(snapshot.notes, "Prudential Center + 2 mi");
  const view = buildGeoFootprint({ targeting: snapshot, plannedBudget: 0, notes: "Exclude Cape Cod" })!;
  assert.deepEqual(view.precision.map((target) => target.kind), ["radius"]);
});

test("the engine's footprint facts name the places largest first and the kinds of precision asked for", () => {
  const facts = geoPlanFacts(geoSnapshotFromBrief({ ...NEW_ENGLAND, rawInput: "Prudential + 2 mi; ZIPs 02108" }))!;
  assert.equal(facts.scope, "dma");
  assert.equal(facts.unitCount, 3);
  assert.deepEqual(facts.precision, ["radius", "zip"]);
  assert.equal(footprintSummary(facts), "Boston, Hartford and Providence DMAs · 4.0M TV households");
  assert.equal(geoPlanFacts(undefined), undefined);
});

test("a client cannot change a saved footprint's households on a re-plan", () => {
  const snapshot = geoSnapshotFromBrief(NEW_ENGLAND)!;
  const tampered = { ...snapshot, entries: snapshot.entries.map((entry) => ({ ...entry, tvHouseholds: 1 })), notes: "Exclude Cape Cod" };
  const restored = rehydrateGeoSnapshot(tampered)!;
  assert.equal(restored.entries[0].tvHouseholds, 2_424_240);
  assert.equal(restored.notes, "Exclude Cape Cod");
  assert.equal(rehydrateGeoSnapshot({ scope: "national", entries: [] }), undefined);
});

test("markets spread below the lead media type's monthly minimum are named for the planner", () => {
  const many = geoSnapshotFromBrief({ type: "DMA", targets: ["New York, NY", "Boston (Manchester), MA", "Elmira (Corning), NY"] });
  const alert = thinMarketAlert(many, 100_000, { name: "CTV / OTT", monthlyMinimum: 10_000 });
  assert.match(alert || "", /^1 of 3 markets get less than \$10,000 per 30 days.*CTV \/ OTT's monthly minimum \(smallest: Elmira\)/);
  assert.equal(thinMarketAlert(many, 2_000_000, { name: "CTV / OTT", monthlyMinimum: 10_000 }), null);
  assert.equal(thinMarketAlert(geoSnapshotFromBrief({ type: "DMA", targets: ["Elmira (Corning), NY"] }), 1_000, { name: "CTV / OTT", monthlyMinimum: 10_000 }), null);
});
