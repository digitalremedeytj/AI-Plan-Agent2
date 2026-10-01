import assert from "node:assert/strict";
import test from "node:test";
import { fixture, platformReports } from "./__fixtures__/load";
import { analyzeFiles, mergeFiles, publicCampaign, readCampaignDetails, readUploadedFiles, sanitizeTouchSummary, suggestedDetails } from "./library";
import { readReport, type TouchReport } from "./reports";

const touchSummary = () => {
  const f = fixture("all_touch_sample.csv");
  return (readReport(f.name, f.text) as TouchReport).summary;
};

test("an upload is refused without an advertiser, and flight dates must be real days in order", () => {
  assert.equal(readCampaignDetails({}).details, null);
  assert.match(readCampaignDetails({ advertiserName: "Acme", flightStart: "2026-02-30" }).error!, /YYYY-MM-DD/);
  assert.match(readCampaignDetails({ advertiserName: "Acme", flightStart: "2026-03-10", flightEnd: "2026-02-09" }).error!, /ends before/);
  assert.match(readCampaignDetails({ advertiserName: "Acme", campaignGoal: "vibes" }).error!, /goal/);
});

test("a campaign with a flight and no name is named after its flight", () => {
  const { details } = readCampaignDetails({ advertiserName: "Acme", flightStart: "2026-02-09", flightEnd: "2026-03-10" });
  assert.equal(details?.name, "Feb 9, 2026 to Mar 10, 2026");
});

test("details left out of an update keep what was saved", () => {
  const saved = { advertiserName: "Acme", name: "Feb", flightStart: "2026-02-09", flightEnd: "2026-03-10", conversionLabel: "Checkouts", campaignGoal: "cpa", notes: null };
  assert.deepEqual(readCampaignDetails({ notes: "Q1 retest" }, saved).details, { ...saved, notes: "Q1 retest" });
});

test("export text and browser touch summaries are accepted; anything else is refused by name", () => {
  const { files, rejected } = readUploadedFiles([
    { fileName: "AP Mediatype.csv", text: "name,Spend\nOTT,1\n" },
    { fileName: "all touch.csv", touchSummary: touchSummary(), sizeBytes: 22_000_000, fingerprint: "all touch.csv:22000000:1" },
    { fileName: "mystery.bin", blob: "…" },
    { fileName: "huge.csv", text: "x".repeat(800_001) },
  ], "tj");
  assert.deepEqual(files.map((f) => f.fileName), ["AP Mediatype.csv", "all touch.csv"]);
  assert.equal(files[0].fingerprint.length, 64);
  assert.equal(rejected.length, 2);
  assert.match(rejected[1], /summarised in the browser/);
});

test("the same export uploaded twice is kept once", () => {
  const a = readUploadedFiles([{ fileName: "a.csv", text: "name,Spend\nOTT,1\n" }], "tj").files;
  const b = readUploadedFiles([{ fileName: "a copy.csv", text: "name,Spend\nOTT,1\n" }], "jo").files;
  const { files, duplicates } = mergeFiles(a, b);
  assert.equal(files.length, 1);
  assert.deepEqual(duplicates, ["a copy.csv"]);
});

test("a touch summary from the browser is rebuilt field by field, dropping anything it does not define", () => {
  const raw: any = { ...touchSummary(), householdHashes: ["abc123"], byMediaType: [{ ...touchSummary().byMediaType[0], secret: "x", lastTouch: "9" }] };
  const clean = sanitizeTouchSummary(raw)!;
  assert.equal((clean as any).householdHashes, undefined);
  assert.equal((clean.byMediaType[0] as any).secret, undefined);
  assert.equal(clean.byMediaType[0].lastTouch, 0, "a number sent as text is not trusted");
  assert.equal(sanitizeTouchSummary({ attribution: "all-touch", conversions: 0, byMediaType: [] }), null);
  assert.equal(sanitizeTouchSummary("nope"), null);
});

test("a stored touch summary analyses the same as the file it came from", () => {
  const f = fixture("all_touch_sample.csv");
  const fromText = analyzeFiles(readUploadedFiles([{ fileName: f.name, text: f.text }], "tj").files, { flightStart: null, flightEnd: null, conversionLabel: null });
  const fromSummary = analyzeFiles(readUploadedFiles([{ fileName: f.name, touchSummary: touchSummary() }], "tj").files, { flightStart: null, flightEnd: null, conversionLabel: null });
  assert.deepEqual(fromSummary.touches, fromText.touches);
});

test("the files' own advertiser, flight and conversion event pre-fill the upload form", () => {
  const files = readUploadedFiles(platformReports().map((f) => ({ fileName: f.name, text: f.text })), "tj").files;
  assert.deepEqual(suggestedDetails(analyzeFiles(files, { flightStart: null, flightEnd: null, conversionLabel: null })), {
    advertiserName: "Acme Auto Accessories",
    flightStart: "2026-02-09",
    flightEnd: "2026-03-10",
    conversionLabel: "Checkouts",
  });
});

test("the flight the planner confirmed decides which files are reference", () => {
  const files = readUploadedFiles(platformReports().map((f) => ({ fileName: f.name, text: f.text })), "tj").files;
  const analysis = analyzeFiles(files, { flightStart: "2026-01-01", flightEnd: "2026-01-31", conversionLabel: "Purchases" });
  assert.ok(analysis.breakdowns.every((b) => b.role === "reference"));
  assert.equal(analysis.conversionLabel.label, "Purchases");
});

test("the browser never receives report contents", () => {
  const files = readUploadedFiles([{ fileName: "a.csv", text: "name,Spend\nOTT,1\n" }], "tj").files;
  const view = publicCampaign({ id: "c", revision: 1, kind: "past", snapshots: [], advertiserName: "A", advertiserKey: "a", name: "n", flightStart: null, flightEnd: null, conversionLabel: null, campaignGoal: null, notes: null, linkedPlanIds: [], fileCount: 1, createdAt: "", createdBy: "", updatedAt: "", updatedBy: "", archived: false, files, review: null });
  assert.equal(JSON.stringify(view).includes("OTT,1"), false);
  assert.equal(view.files[0].source, "export");
});

test("review confidence is capped by what the finding cites, whatever the model said", async () => {
  const { capConfidence, findCausalClaim } = await import("./review");
  const analysis = analyzeFiles(readUploadedFiles(platformReports().map((f) => ({ fileName: f.name, text: f.text })), "tj").files, { flightStart: null, flightEnd: null, conversionLabel: null });
  const base = { headline: "x", detail: "", evidence: "", area: "audience", confidence: "high" as const };
  assert.deepEqual(capConfidence({ ...base, evidence: "OTT - March Madness PMP: $17,552, CPA $418" }, analysis), { confidence: "low", confidenceNote: "OTT - March Madness PMP is an event or one-off buy" });
  assert.equal(capConfidence({ ...base, evidence: "Gym Bros: CPA $214.93" }, analysis).confidence, "low", "under 30 conversions");
  assert.deepEqual(capConfidence({ ...base, area: "media type", headline: "Pre-roll beat the average" }, analysis), { confidence: "medium", confidenceNote: "the evidence is last-touch only" });
  assert.deepEqual(capConfidence({ ...base, confidence: "medium" }, analysis), { confidence: "medium", confidenceNote: null }, "a cap never raises confidence");
  assert.equal(findCausalClaim("Weekly CPA rose as spend expanded to address pacing."), "to address");
  assert.equal(findCausalClaim("Retargeting drove 42% of conversions from CTV-built audiences."), null);
});

test("a later export of the same report is the same report, whatever day it was exported", async () => {
  const { reportKey } = await import("./library");
  assert.equal(reportKey("AP Mediatype (2026-02-09 - 2026-03-10) - Acme_20260312_120237.csv"), reportKey("AP Mediatype (2026-02-09 - 2026-03-24) - Acme_20260325_093000.csv"));
  assert.notEqual(reportKey("AP Mediatype (2026-02-09 - 2026-03-10) - Acme_20260312_120237.csv"), reportKey("AP Publisher (2026-02-09 - 2026-03-10) - Acme_20260312_120224.csv"));
  assert.equal(reportKey("publisher_report_2026-02-09_to_2026-03-10.csv"), reportKey("publisher_report_2026-02-09_to_2026-03-24.csv"));
});

test("a live campaign's new export replaces the earlier one; a past campaign keeps both", () => {
  const first = readUploadedFiles([{ fileName: "AP Mediatype (2026-02-09 - 2026-03-10) - Acme_20260312_120237.csv", text: "name,Spend\nOTT,1\n" }], "tj").files;
  const later = readUploadedFiles([{ fileName: "AP Mediatype (2026-02-09 - 2026-03-24) - Acme_20260325_093000.csv", text: "name,Spend\nOTT,2\n" }], "tj").files;
  const live = mergeFiles(first, later, { replaceSameReport: true });
  assert.deepEqual(live.files.map((f) => f.fileName), [later[0].fileName]);
  assert.deepEqual(live.replaced, [first[0].fileName]);
  assert.equal(mergeFiles(first, later).files.length, 2);
});

test("each live upload records the totals and the last day the data covers", async () => {
  const { snapshotOf } = await import("./library");
  const files = readUploadedFiles(platformReports().map((f) => ({ fileName: f.name, text: f.text })), "tj").files;
  const snap = snapshotOf(analyzeFiles(files, { flightStart: "2026-02-09", flightEnd: "2026-03-30", conversionLabel: null, kind: "live" }), "tj", "now");
  assert.deepEqual(snap, { uploadedAt: "now", uploadedBy: "tj", asOf: "2026-03-10", spend: snap.spend, conversions: 9840, revenue: snap.revenue });
  assert.ok(snap.spend > 233000 && snap.spend < 234000);
});
