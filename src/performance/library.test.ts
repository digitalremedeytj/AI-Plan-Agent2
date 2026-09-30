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
  const view = publicCampaign({ id: "c", revision: 1, advertiserName: "A", advertiserKey: "a", name: "n", flightStart: null, flightEnd: null, conversionLabel: null, campaignGoal: null, notes: null, linkedPlanIds: [], fileCount: 1, createdAt: "", createdBy: "", updatedAt: "", updatedBy: "", archived: false, files, review: null });
  assert.equal(JSON.stringify(view).includes("OTT,1"), false);
  assert.equal(view.files[0].source, "export");
});
