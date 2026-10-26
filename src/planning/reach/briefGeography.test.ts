import assert from "node:assert/strict";
import test from "node:test";
import { NIELSEN_DMAS, US_STATES as PICKER_STATES } from "../../utils/geoReference";
import { footprintReadout, geoTargetingFromBrief, geographyForPrompt, resolvePickerDma, resolvePickerState } from "./briefGeography";
import { resolveHouseholdUniverse } from "./universe";

test("every DMA in the brief's picker resolves to one market in the household data", () => {
  const unresolved = NIELSEN_DMAS.filter((dma) => !resolvePickerDma(dma.name)).map((dma) => dma.name);
  assert.deepEqual(unresolved, []);
});

// The picker once listed these second spellings beside the market's main entry; briefs saved then
// still carry them.
test("names dropped from the picker in the duplicate merge still resolve for saved briefs", () => {
  const saved = { "Yuma, AZ": "771", "Grand Junction, CO": "773", "Panama City-Destin, FL": "656", "Quincy-Hannibal, IL-MO": "717" };
  for (const [name, code] of Object.entries(saved)) assert.equal(resolvePickerDma(name)?.id, code, name);
});

test("the Washington DC pick sizes reach to the DC DMA, not the country", () => {
  const universe = resolveHouseholdUniverse(geoTargetingFromBrief({ type: "DMA", targets: ["Washington, DC (Hag, Wsh)"] }));
  assert.equal(universe.scope, "dma");
  assert.equal(universe.households, 2_476_680);
});

test("picker names win over its unreliable codes", () => {
  // The picker codes Beaumont-Port Arthur as Rockford's market; the name is what the planner chose.
  assert.match(resolvePickerDma("Beaumont-Port Arthur, TX")?.name || "", /Beaumont/);
  assert.equal(resolvePickerDma("Rochester, NY")?.tvHouseholds, 404_170);
  assert.equal(resolvePickerDma("Rochester-Mason City-Austin, MN")?.tvHouseholds, 141_920);
  assert.match(resolvePickerDma("Paducah-Cape Girard-Harsbg, KY")?.name || "", /Paducah/);
});

test("state picks resolve by their code, and only Puerto Rico has no household figure", () => {
  assert.equal(resolvePickerState("Virginia (VA)")?.id, "VA");
  assert.equal(resolvePickerState("Montana (MT)")?.id, "MT");
  const unresolved = PICKER_STATES.filter((state) => !resolvePickerState(`${state.name} (${state.code})`)).map((state) => state.code);
  assert.deepEqual(unresolved, ["PR"]);
  const universe = resolveHouseholdUniverse(geoTargetingFromBrief({ type: "State", targets: ["Virginia (VA)", "Maryland (MD)"] }));
  assert.equal(universe.households, 2_667_000 + resolveHouseholdUniverse(geoTargetingFromBrief({ type: "State", targets: ["Maryland (MD)"] })).households);
});

test("national or an empty pick measures against the whole country, and unknown picks are reported", () => {
  assert.equal(geoTargetingFromBrief({ type: "National", targets: [] }), undefined);
  assert.equal(geoTargetingFromBrief({ type: "DMA", targets: [] }), undefined);
  const universe = resolveHouseholdUniverse(geoTargetingFromBrief({ type: "DMA", targets: ["Washington, DC (Hag, Wsh)", "Atlantis"] }));
  assert.equal(universe.households, 2_476_680);
  assert.deepEqual(universe.unresolved, ["Atlantis"]);
});

test("the footprint under the picker uses the households the plan's reach is sized to", () => {
  const config = { type: "DMA" as const, targets: ["Boston (Manchester), MA"] };
  const readout = footprintReadout(config);
  const universe = resolveHouseholdUniverse(geoTargetingFromBrief(config));

  assert.ok(readout?.line.startsWith("Boston"));
  assert.ok(readout?.line.includes(`${(universe.households / 1_000_000).toFixed(1)}M TV households`));
  assert.ok(readout?.detail.startsWith("Delivers into"));
  assert.equal(footprintReadout({ type: "National", targets: [] }), null);
});

test("state targeting reports the markets that spill past the chosen states", () => {
  const readout = footprintReadout({ type: "State", targets: ["New Jersey (NJ)"] });

  assert.match(readout?.detail || "", /^Served by \d+ DMAs; \d+ of them also deliver into .*NY/);
});

test("the research prompts get the computed footprint and the planner's notes, never the bare scope", () => {
  const line = geographyForPrompt("DMA (Boston (Manchester))", { type: "DMA", targets: ["Boston (Manchester), MA"], rawInput: "Boston + 30 mi\nexclude Cambridge" });

  assert.match(line, /^DMA targeting within United States: 1 markets covering [\d,]+ TV households/);
  assert.ok(line.endsWith("Boston + 30 mi; exclude Cambridge"));
  assert.equal(geographyForPrompt("National", { type: "National", targets: [] }), "National (United States).");
});
