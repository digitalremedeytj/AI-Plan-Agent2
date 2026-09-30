import assert from "node:assert/strict";
import test from "node:test";
import { platformReport, platformReports } from "./__fixtures__/load";
import { analyzeReportFiles } from "./index";

const analysis = () => analyzeReportFiles(platformReports());
const codes = (a: ReturnType<typeof analysis>) => a.warnings.map((w) => w.code);

test("the five breakdowns are recognised as cuts of the same spend and are never added together", () => {
  const a = analysis();
  const campaign = a.breakdowns.filter((b) => b.role === "campaign");
  assert.equal(campaign.length, 5);
  assert.ok(campaign.every((b) => b.sharedTotals));
  assert.equal(a.totals?.conversions, 9840);
  assert.ok(Math.abs((a.totals?.spend ?? 0) - campaign[0].totals.spend!) < 0.01, "campaign spend is one report's total, not five");
  assert.ok(codes(a).includes("same-campaign-cuts"));
  assert.ok(!codes(a).includes("totals-differ"));
});

test("PM recomputed from spend and conversions matches the platform's own for every dimension", () => {
  for (const b of analysis().breakdowns) assert.equal(b.pmCheck.status, "verified", b.dimension);
});

test("the flight is the window the breakdowns share, and the IO pacing file sits outside it", () => {
  const a = analysis();
  assert.deepEqual(a.flight, { start: Date.UTC(2026, 1, 9), end: Date.UTC(2026, 2, 10) });
  assert.equal(a.files.find((f) => f.reportType === "IO Pacing")?.role, "reference");
  // One note for the pacing window, not a generic reference note as well.
  assert.equal(a.warnings.filter((w) => w.fileName?.includes("IO Pacing") && /covers/.test(w.message)).length, 1);
  assert.ok(codes(a).includes("underpacing"));
  assert.equal(a.pacing[0].budget !== null && a.pacing[0].spent !== null && a.pacing[0].spent < a.pacing[0].budget, true);
});

test("the conversion event is named from the conversions summary when the rows only say Visits", () => {
  assert.deepEqual(analysis().conversionLabel, { label: "Checkouts", source: "summary" });
});

test("a conversion event the planner picked wins over what the files suggest", () => {
  assert.deepEqual(analyzeReportFiles(platformReports(), { conversionLabel: "Purchases" }).conversionLabel, { label: "Purchases", source: "planner" });
});

test("the summary's ROAS of 0 is flagged and ROAS comes from revenue over spend", () => {
  const a = analysis();
  assert.ok(codes(a).includes("summary-roas-zero"));
  assert.ok((a.totals?.roas ?? 0) > 3.5 && (a.totals?.roas ?? 0) < 4);
});

test("reach and frequency are taken from their summary and agree with impressions", () => {
  const a = analysis();
  assert.equal(a.reach?.reach, 4424086);
  assert.ok(!codes(a).includes("reach-frequency"));
});

test("the completion rate is measured over rows that ran video, not diluted by display", () => {
  const vcr = analysis().totals?.vcr ?? 0;
  assert.ok(vcr > 0.9 && vcr < 0.91, `got ${vcr}`);
});

test("retargeting lines are flagged, and the ones built off OTT are marked as fed by CTV", () => {
  const a = analysis();
  const audience = a.breakdowns.find((b) => b.dimension === "Audience")!;
  const offOtt = audience.rows.find((r) => r.name === "Sequential Retargeting Off OTT: SUV Drivers")!;
  assert.deepEqual(offOtt.flags.filter((f) => f === "retargeting" || f === "fed-by-ctv"), ["retargeting", "fed-by-ctv"]);
  const site = audience.rows.find((r) => r.name === "Site Retargeting")!;
  assert.ok(site.flags.includes("retargeting") && !site.flags.includes("fed-by-ctv"));
  const warning = a.warnings.find((w) => w.code === "retargeting-credit");
  assert.match(warning!.message, /Display Retargeting/);
});

test("conversions with no recorded spend get no CPA or PM instead of dividing by zero", () => {
  const creative = analysis().breakdowns.find((b) => b.dimension === "Creative")!;
  const orphans = creative.rows.filter((r) => r.flags.includes("conversions-without-spend"));
  assert.equal(orphans.length, 4);
  assert.ok(orphans.every((r) => r.cpa === null && r.pm === null));
});

test("rows with too few conversions to judge are marked low-sample", () => {
  const audience = analysis().breakdowns.find((b) => b.dimension === "Audience")!;
  assert.ok(audience.rows.find((r) => r.name === "Gym Bros")?.flags.includes("low-sample"));
  assert.ok(!audience.rows.find((r) => r.name === "Site Retargeting")?.flags.includes("low-sample"));
});

test("one-off event buys are marked so a bad week is not read as a bad channel", () => {
  const adgroup = analysis().breakdowns.find((b) => b.dimension === "Adgroup")!;
  assert.ok(adgroup.rows.find((r) => r.name === "OTT - March Madness PMP")?.flags.includes("event"));
});

test("publisher rows that are really media types are marked so they are never matched as publishers", () => {
  const publisher = analysis().breakdowns.find((b) => b.dimension === "Publisher")!;
  const marked = publisher.rows.filter((r) => r.flags.includes("media-type-row")).map((r) => r.name).sort();
  assert.deepEqual(marked, ["Display", "Display Retargeting", "Pre-Roll/Mid-Roll"]);
});

test("a report from another window is reference and never combined with the flight", () => {
  const mediatype = platformReport("Mediatype");
  const other = { name: mediatype.name.replace("2026-02-09 - 2026-03-10", "2025-11-01 - 2025-11-30"), text: mediatype.text };
  const a = analyzeReportFiles([...platformReports(), other]);
  const reference = a.breakdowns.find((b) => b.fileName === other.name)!;
  assert.equal(reference.role, "reference");
  assert.equal(reference.sharedTotals, undefined);
  assert.equal(a.totals?.conversions, 9840);
  assert.ok(a.warnings.some((w) => w.code === "reference-window" && w.fileName === other.name));
});

test("a breakdown whose totals differ from the others is called out as filtered or partial", () => {
  const mediatype = platformReport("Mediatype");
  const partial = { name: mediatype.name, text: mediatype.text.split("\n").slice(0, 3).join("\n") };
  const files = platformReports().map((f) => (f.name === mediatype.name ? partial : f));
  assert.ok(codes(analyzeReportFiles(files)).includes("totals-differ"));
});

test("files naming two advertisers are flagged as a problem", () => {
  const files = platformReports();
  files[0] = { ...files[0], name: files[0].name.replace("Acme Auto Accessories", "Other Brand") };
  const warning = analyzeReportFiles(files).warnings.find((w) => w.code === "mixed-advertisers");
  assert.equal(warning?.severity, "problem");
});

test("touch-level credit is set against media type spend, so the same spend is shown under last-touch and linear credit", () => {
  const window = "2026-02-09 - 2026-02-15";
  const mediatype = { name: `AP Mediatype (${window}) - Acme_20260316_100000.csv`, text: "name,Impressions,Spend,Visits\nOTT,100000,900,1\nDisplay,50000,100,3\n" };
  const header = "Unique ID,Hashed IP address,($)Rev,Conversion Timestamp,Creative,Publisher,Audience/Tactic,Media Type,State,DMA,Device Type,Imp Timestamp,Time to Convert (Hrs),Times Exposed";
  const row = (id: number, media: string, seen: string) => `${id},h${id},10,2026-02-12 12:00:00,C,${media === "OTT" ? "Hulu" : "Display"},A,${media},IA,Des Moines-Ames IA,Desktop,${seen},1,1`;
  const touches = {
    name: "all touch.csv",
    text: [header,
      row(1, "OTT", "2026-02-10 10:00:00"), row(1, "Display", "2026-02-11 10:00:00"),
      row(2, "OTT", "2026-02-10 10:00:00"),
      row(3, "Display", "2026-02-10 10:00:00"),
      row(4, "OTT", "2026-02-10 10:00:00"), row(4, "Display", "2026-02-11 10:00:00"), row(4, "Display", "2026-02-11 11:00:00"),
    ].join("\n"),
  };
  const a = analyzeReportFiles([mediatype, touches]);
  assert.equal(a.touches[0].role, "campaign");
  const ott = a.attribution!.rows.find((r) => r.mediaType === "OTT")!;
  const display = a.attribution!.rows.find((r) => r.mediaType === "Display")!;
  assert.equal(a.attribution!.coverage, 1);
  assert.equal(ott.lastTouch, 1);
  assert.equal(ott.cpaLastTouch, 900);
  assert.ok(Math.abs(ott.pmLastTouch! - 1 / 900 / (4 / 1000)) < 1e-9);
  assert.ok(Math.abs(ott.linear - (0.5 + 1 + 1 / 3)) < 1e-9);
  assert.ok(ott.pmLinear! > ott.pmLastTouch!, "OTT looks better once credit is shared");
  assert.ok(display.pmLinear! < display.pmLastTouch!);
  assert.ok(codes(a).includes("ctv-credited-elsewhere"));
});

test("touch files from another campaign's window are reference and add nothing to this campaign's notes", () => {
  const f = { name: "all touch.csv", text: "Unique ID,Conversion Timestamp,Media Type,Imp Timestamp\n1,2024-05-25 10:00:00,OTT,2024-05-24 10:00:00\n" };
  const a = analyzeReportFiles([...platformReports(), f]);
  assert.equal(a.touches[0].role, "reference");
  assert.equal(a.attribution, null);
  assert.ok(!a.warnings.some((w) => w.fileName === f.name && w.code !== "reference-window"));
});
