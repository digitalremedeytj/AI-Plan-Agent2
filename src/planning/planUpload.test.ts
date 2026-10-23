import assert from "node:assert/strict";
import test from "node:test";
import { OUTSIDE_CATALOG, type ParsedPlanOption } from "../types";
import { allocationChanges, briefChanges, describeGeography, flightDaysFrom, geographyFrom, lineMappings, uploadedBrief, withChannelMapping } from "./planUpload";
import { RFP_OPTIONS, rfpStrategy } from "./testing/rfpPlans";

const option = (overrides: Partial<ParsedPlanOption> = {}): ParsedPlanOption => ({ ...RFP_OPTIONS[0], ...overrides });

test("the upload's budget, flight and locations replace the brief's, and only what changed is listed", () => {
  const next = uploadedBrief([option({
    flightDates: { start: "2026-11-01", end: "2026-12-31" },
    placements: RFP_OPTIONS[0].placements.map((placement) => ({ ...placement, locationDetails: "CA, NV" })),
  })]);
  assert.equal(next.budget, 50_000);
  assert.equal(next.flightDays, 61);
  assert.deepEqual(next.geography, { type: "State", targets: ["California (CA)", "Nevada (NV)"], unrecognized: [] });

  const changes = briefChanges({ budget: "$50,000", campaignLength: "30", geographyType: "National", geoTargets: [] }, next);
  assert.deepEqual(changes.map((change) => [change.field, change.from, change.to]), [
    ["flight", "30 days", "61 days"],
    ["geography", "National", "State (CA, NV)"],
  ]);
});

test("an upload that names no locations, or none that can be read, leaves the brief's in place and says which", () => {
  assert.equal(uploadedBrief([option()]).geography, null);
  const unread = geographyFrom(["Mars Colony", "Atlantis"]);
  assert.equal(unread.geography, null);
  assert.deepEqual(unread.unread, ["Mars Colony", "Atlantis"]);
  assert.deepEqual(briefChanges({ budget: "$50,000", campaignLength: "30", geographyType: "DMA", geoTargets: ["Chicago, IL"] }, uploadedBrief([option()])), []);
});

test("a nationwide plan reads as national, and DMAs win when they are what the plan names", () => {
  assert.equal(geographyFrom(["Nationwide"]).geography?.type, "National");
  const dmas = geographyFrom(["Chicago DMA", "Los Angeles DMA"]).geography;
  assert.equal(dmas?.type, "DMA");
  assert.equal(dmas?.targets.length, 2);
});

test("the flight runs from the earliest start to the latest end of the chosen options, inclusive", () => {
  assert.equal(flightDaysFrom([
    option({ flightDates: { start: "2026-11-15", end: "2026-11-30" } }),
    option({ flightDates: { start: "2026-11-01", end: "2026-11-20" } }),
  ]), 30);
  assert.equal(flightDaysFrom([option()]), null);
});

test("the upload's audiences are collected for the planner's check, without duplicates", () => {
  const next = uploadedBrief(
    [option({ placements: [{ mediaType: "Video", productType: "OTT", budget: 10_000, audience: "Adults 25-54" }, { mediaType: "DOOH", budget: 5_000, audience: "Adults 25-54" }] })],
    { targetAudiences: ["Pet owners"] },
  );
  assert.deepEqual(next.audiences, ["Pet owners", "Adults 25-54"]);
});

test("the brief's geography line reads the same as before it moved into this module", () => {
  assert.equal(describeGeography("National", []), "National");
  assert.equal(describeGeography("State", ["California (CA)", "Nevada (NV)"]), "State (CA, NV)");
  assert.equal(describeGeography("DMA", ["Chicago, IL", "New York, NY", "Boston, MA", "Denver, CO"]), "DMA (4 Markets: Chicago, New York, +2 more)");
});

test("a planner's mapping moves a line to another media type, or out of the catalog, and the re-plan follows it", () => {
  const mapped = [option({ placements: withChannelMapping(RFP_OPTIONS[0].placements, { "Digital Out of Home · DOOH": OUTSIDE_CATALOG }) })];
  const strategy = rfpStrategy("asIs", 0, mapped);
  assert.deepEqual(strategy.mediaPlan!.channels.map((channel) => channel.channelId), ["channel.ctv"]);
  assert.deepEqual(lineMappings(strategy).map((line) => [line.label, line.channelId]), [
    ["Video · OTT", "channel.ctv"],
    ["Digital Out of Home · DOOH", null],
  ]);

  const moved = rfpStrategy("asIs", 0, [option({ placements: withChannelMapping(RFP_OPTIONS[0].placements, { "Digital Out of Home · DOOH": "channel.ctv" }) })]);
  assert.deepEqual(moved.mediaPlan!.channels.map((channel) => [channel.channelId, channel.allocationDollars]), [["channel.ctv", 50_000]]);
});

test("the before and after lists every media type in either plan, with what each spends and the totals", () => {
  const before = rfpStrategy("incremental", 25_000);
  const after = rfpStrategy("asIs");
  const { rows, beforeTotal, afterTotal } = allocationChanges(before, after);
  assert.equal(beforeTotal, 75_000);
  assert.equal(afterTotal, 50_000);
  assert.deepEqual(rows.slice(0, 2).map((row) => [row.name, row.after]), [["CTV / OTT", 30_000], ["Digital Out-of-Home (DOOH)", 20_000]]);
  assert.ok(rows.slice(2).every((row) => row.after === null && row.before !== null), "media types only in the old plan read as removed");
});
