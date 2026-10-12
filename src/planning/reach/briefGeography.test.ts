import assert from "node:assert/strict";
import test from "node:test";
import { NIELSEN_DMAS, US_STATES as PICKER_STATES } from "../../utils/geoReference";
import { geoTargetingFromBrief, resolvePickerDma, resolvePickerState } from "./briefGeography";
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
