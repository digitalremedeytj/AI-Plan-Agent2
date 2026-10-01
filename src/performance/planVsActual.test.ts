import assert from "node:assert/strict";
import test from "node:test";
import { DIGITAL_REMEDY_PRODUCT_REGISTRY } from "../planning/knowledge/registry";
import { platformReports } from "./__fixtures__/load";
import { analyzeReportFiles } from "./index";
import { comparePlanToActual, parseKpiTarget, renderPlanVsActual } from "./planVsActual";

// The Acme reports read as a live campaign: day 30 of a 50-day, $500,000 flight.
const analysis = () => analyzeReportFiles(platformReports(), { flight: { start: Date.UTC(2026, 1, 9), end: Date.UTC(2026, 2, 30) }, inFlight: true });
const channel = (id: string, name: string, percent: number) => ({ channelId: id, channelName: name, allocationPercent: percent, allocationDollars: 500_000 * percent / 100 });
const plan = (kpis = ["Online sales at CPA under $30"]) => ({
  kpis,
  ctvPublishers: ["CBS", "Pluto", "Hulu", "Tubi"],
  mediaPlan: {
    workingMediaBudget: 500_000,
    flightDays: 50,
    channels: [channel("channel.ctv", "CTV / OTT", 60), channel("channel.olv", "Online Video (OLV)", 20), channel("channel.display", "Programmatic Display", 10), channel("channel.display_retargeting", "Display Retargeting", 10)],
    evaluatedCandidates: DIGITAL_REMEDY_PRODUCT_REGISTRY.map((product) => ({ product })),
  },
});
const compare = (kpis?: string[]) => comparePlanToActual(analysis(), plan(kpis), { flightStart: "2026-02-09", flightEnd: "2026-03-30", snapshots: [] });

test("a CPA or ROAS target is read from the KPIs as planners write them", () => {
  assert.deepEqual(parseKpiTarget(["Brand awareness", "Online sales at CPA under $30"]), { metric: "cpa", value: 30, text: "Online sales at CPA under $30" });
  assert.equal(parseKpiTarget(["CPA < $45"])?.value, 45);
  assert.deepEqual(parseKpiTarget(["ROAS > 3.0"]), { metric: "roas", value: 3, text: "ROAS > 3.0" });
  assert.equal(parseKpiTarget(["ROAS 300%"])?.value, 3);
  assert.equal(parseKpiTarget(["Reach", "80% VCR"]), null);
});

test("reports covering the flight so far are in the campaign, not reference, while it is running", () => {
  const a = analysis();
  assert.ok(a.breakdowns.every((b) => b.role === "campaign"));
  assert.equal(a.totals?.conversions, 9840);
});

test("pacing compares the share of budget spent with the share of the flight elapsed", () => {
  const p = compare();
  assert.equal(p.daysElapsed, 30);
  assert.equal(p.flight?.days, 50);
  assert.ok(Math.abs(p.spendShare - 233434 / 500000) < 0.001);
  assert.ok(Math.abs(p.pacing! - (233434 / 500000) / 0.6) < 0.001);
  assert.ok(p.projectedSpend! > p.spent, "the straight line adds the days left at the recent rate");
});

test("each plan channel's spend to date is set against its planned dollars for the time elapsed", () => {
  const p = compare();
  const ctv = p.channels.find((c) => c.channelId === "channel.ctv")!;
  assert.deepEqual(ctv.reportNames, ["OTT"]);
  assert.equal(ctv.expectedToDate, 180_000);
  assert.equal(ctv.status, "on-pace");
  assert.ok(ctv.aboveTarget, "a $53.85 CPA on 3,234 conversions is well over a $30 target");
  const olv = p.channels.find((c) => c.channelId === "channel.olv")!;
  assert.deepEqual(olv.reportNames, ["Pre-Roll/Mid-Roll"]);
  assert.equal(olv.status, "under");
  assert.equal(olv.aboveTarget, false);
});

test("spend on a media type the plan does not have is shown as off-plan", () => {
  const p = comparePlanToActual(analysis(), { ...plan(), mediaPlan: { ...plan().mediaPlan, channels: plan().mediaPlan.channels.filter((c) => c.channelId !== "channel.olv") } }, { flightStart: "2026-02-09", flightEnd: "2026-03-30", snapshots: [] });
  const off = p.channels.find((c) => c.status === "off-plan")!;
  assert.equal(off.name, "Pre-Roll/Mid-Roll");
});

test("the plan's CTV publishers are split into delivering and not delivering, and other publishers are listed", () => {
  const p = compare();
  assert.deepEqual(p.publishers!.inPlan.map((x) => x.planned).sort(), ["CBS", "Hulu", "Pluto"]);
  assert.deepEqual(p.publishers!.notDelivering, ["Tubi"]);
  assert.ok(p.publishers!.offPlan.some((x) => x.name === "Paramount"));
  assert.ok(!p.publishers!.offPlan.some((x) => x.name === "Display Retargeting"), "media types in the publisher report are not publishers");
});

test("the comparison since the previous upload uses the stored snapshot", () => {
  const p = comparePlanToActual(analysis(), plan(), {
    flightStart: "2026-02-09", flightEnd: "2026-03-30",
    snapshots: [{ uploadedAt: "a", uploadedBy: "tj", asOf: "2026-03-01", spend: 150_000, conversions: 7000, revenue: 0 }, { uploadedAt: "b", uploadedBy: "tj", asOf: "2026-03-10", spend: 233_434, conversions: 9840, revenue: 0 }],
  });
  assert.equal(p.sinceLast?.from, "2026-03-01");
  assert.equal(p.sinceLast?.conversions, 2840);
});

test("without a target in the KPIs, nothing is called above target and the gap is noted", () => {
  const p = compare(["Brand awareness"]);
  assert.ok(p.channels.every((c) => !c.aboveTarget));
  assert.match(p.notes.join(" "), /No cost-per-conversion or ROAS target/);
});

test("the rendered comparison states the pacing, the target and each channel's status", () => {
  const text = renderPlanVsActual(compare());
  assert.match(text, /Day 30 of 50 \(60% of the flight\)/);
  assert.match(text, /Target: CPA \$30\.00/);
  assert.match(text, /CTV \/ OTT \(channelId: channel\.ctv\): 60% = \$300,000 \| \$180,000 \| \$174,138 \| 97% \| 3,234 \| \$53\.85 \| on pace; above target \[reported as OTT\]/);
  assert.match(text, /a straight line, not a forecast/);
});

test("a report left from an earlier export of a live campaign is named as out of date", () => {
  const files = platformReports().map((f) => f.name.startsWith("AP Mediatype") ? { name: f.name.replace("2026-03-10", "2026-03-17"), text: f.text } : f);
  const a = analyzeReportFiles(files, { flight: { start: Date.UTC(2026, 1, 9), end: Date.UTC(2026, 2, 30) }, inFlight: true });
  const stale = a.warnings.find((w) => w.code === "stale-export")!;
  assert.match(stale.message, /Adgroup \(data to 2026-03-10\)/);
  assert.match(stale.message, /than the rest \(data to 2026-03-17\)/);
  assert.doesNotMatch(stale.message, /Mediatype \(/);
  assert.equal(analyzeReportFiles(platformReports(), { flight: { start: Date.UTC(2026, 1, 9), end: Date.UTC(2026, 2, 30) }, inFlight: true }).warnings.some((w) => w.code === "stale-export"), false);
});
