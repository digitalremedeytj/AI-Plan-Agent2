import assert from "node:assert/strict";
import test from "node:test";
import { platformReport } from "./__fixtures__/load";
import { readReport, type BreakdownReport, type SeriesReport, type SummaryReport } from "./reports";

const read = (reportType: string) => {
  const f = platformReport(reportType);
  return readReport(f.name, f.text);
};

test("the platform's ROAS, CTR and VCR are recognised as percentages from each row's own counts", () => {
  const report = read("Mediatype") as BreakdownReport;
  assert.equal(report.kind, "breakdown");
  assert.equal(report.platform, true);
  const scales = Object.fromEntries(report.ratioChecks.map((c) => [c.ratio, [c.scale, c.status]]));
  assert.deepEqual(scales.roas, [100, "verified"]);
  assert.deepEqual(scales.ctr, [100, "verified"]);
  assert.deepEqual(scales.vcr, [100, "verified"]);
  assert.deepEqual(scales.cpa, [1, "verified"]);
  assert.deepEqual(scales.cpm, [1, "verified"]);
});

test("a publisher breakdown is named by display name and keeps its streaming category", () => {
  const report = read("Publisher") as BreakdownReport;
  const hulu = report.rows.find((r) => r.name === "Hulu");
  assert.ok(hulu);
  assert.deepEqual(hulu.attributes, { streamingCategory: "Premium Movies and TV" });
});

test("Ireach columns are reported as unused rather than guessed at", () => {
  const report = read("Adgroup") as BreakdownReport;
  assert.deepEqual(report.ignoredColumns, ["Ireach", "IreachPercentage"]);
});

test("a running-total daily export is read as daily values that add up to the final row", () => {
  const report = read("Daily Performance") as SeriesReport;
  assert.equal(report.kind, "series");
  assert.equal(report.cumulative, true);
  const spend = report.points.reduce((s, p) => s + (p.metrics.spend ?? 0), 0);
  const conversions = report.points.reduce((s, p) => s + (p.metrics.conversions ?? 0), 0);
  assert.ok(Math.abs(spend - (report.finalTotals?.spend ?? 0)) < 0.01);
  assert.equal(conversions, 9840);
  assert.ok(report.points.every((p) => (p.metrics.spend ?? 0) < 20000), "no day carries the whole running total");
});

test("summary exports are read as labelled values, and zero-filled comparisons are not comparisons", () => {
  const report = read("Conversions Summary") as SummaryReport;
  assert.equal(report.kind, "summary");
  assert.deepEqual(report.values.map((v) => v.metric), ["Checkouts", "CPA", "ROAS"]);
  assert.equal(report.hasComparison, false);
});

test("the pacing export takes its window from its own date columns", () => {
  const report = read("IO Pacing") as SummaryReport;
  assert.equal(report.pacing, true);
  assert.deepEqual(report.window, { start: Date.UTC(2025, 11, 31), end: Date.UTC(2026, 2, 30) });
  assert.equal(report.values.find((v) => v.metric === "Current Pacing")?.percent, true);
});

test("a renamed platform export is recognised by its columns", () => {
  const f = platformReport("Mediatype");
  const report = readReport("media types.csv", f.text) as BreakdownReport;
  assert.equal(report.platform, true);
  assert.equal(report.dimension, "name");
});

test("an export from another tool is read by header synonyms", () => {
  const report = readReport("placements.csv", "Placement,Media Cost,Impr.,Conversions,Revenue\nHulu,$1000,100000,20,$3000\nTubi,$500,80000,5,$400\n") as BreakdownReport;
  assert.equal(report.kind, "breakdown");
  assert.equal(report.platform, false);
  assert.deepEqual(report.totals, { impressions: 180000, spend: 1500, conversions: 25, revenue: 3400 });
  assert.equal(report.rows[0].name, "Hulu");
});

test("a total row in an export is not counted twice", () => {
  const report = readReport("x.csv", "name,Spend,Visits\nA,10,1\nB,20,2\nTotal,30,3\n") as BreakdownReport;
  assert.deepEqual(report.totals, { spend: 30, conversions: 3 });
});

test("a ratio column that disagrees with its own counts is flagged instead of trusted", () => {
  const report = readReport("x.csv", "name,Spend,Visits,Cpa\nA,100,10,99\nB,200,10,3\n") as BreakdownReport;
  assert.equal(report.ratioChecks.find((c) => c.ratio === "cpa")?.status, "mismatch");
});

test("a daily report split by another column sums each day", () => {
  const report = readReport("x.csv", "Date,Publisher,Spend,Conversions\n2026-02-01,Hulu,10,1\n2026-02-01,Tubi,5,1\n2026-02-02,Hulu,7,0\n") as SeriesReport;
  assert.equal(report.kind, "series");
  assert.deepEqual(report.points.map((p) => p.metrics), [{ spend: 15, conversions: 2 }, { spend: 7, conversions: 0 }]);
});

test("a file with no recognisable metrics is reported as unread with a reason", () => {
  const report = readReport("notes.csv", "Client,Owner\nAcme,Jo\n");
  assert.equal(report.kind, "unread");
});
