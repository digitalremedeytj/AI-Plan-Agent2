import test from "node:test";
import assert from "node:assert/strict";
import {
  guessFileRoles,
  matchUploadedName,
  missingAttachments,
  normalizeRfpAnalysis,
  packageLabel,
  suggestGeoTargets,
  uploadBriefText,
  uploadBriefWithNotes,
  plannerNotesLimit,
} from "./rfpPackage";
import type { RfpAnalysis, RfpPackageFile } from "../types";

const HYSTER: RfpPackageFile[] = [
  { name: "Hyster-RFP.rtf", role: "rfp" },
  { name: "Attachment B - Port List.csv", role: "geo_list" },
];

test("the document named like an RFP is the RFP, and its spreadsheets are sorted by what they hold", () => {
  assert.deepEqual(
    guessFileRoles(["Creative Specs.pdf", "Hyster-RFP.rtf", "Attachment B - Port List.csv", "Q1 Media Plan.xlsx", "Pricing.xlsx"]),
    ["reference", "rfp", "geo_list", "media_plan", "reference"],
  );
});

test("a report is not mistaken for a port list", () => {
  assert.deepEqual(guessFileRoles(["RFP.pdf", "Performance_Report.xlsx"]), ["rfp", "reference"]);
});

test("a spreadsheet uploaded with no RFP beside it is a media plan, as a single upload always was", () => {
  assert.deepEqual(guessFileRoles(["Hyster Locations.xlsx"]), ["geo_list"]);
  assert.deepEqual(guessFileRoles(["Q1.xlsx"]), ["media_plan"]);
});

test("with no document named like an RFP, the first document is the RFP", () => {
  assert.deepEqual(guessFileRoles(["Overview.pdf", "Terms.docx"]), ["rfp", "reference"]);
});

test("the package is named by its RFP and how many files came with it", () => {
  assert.equal(packageLabel(HYSTER), "Hyster-RFP.rtf + 1 attachment");
  assert.equal(packageLabel([{ name: "Plan.xlsx", role: "media_plan" }]), "Plan.xlsx");
});

test("the sandbox's name for a file still matches the file the planner uploaded", () => {
  const names = HYSTER.map((file) => file.name);

  assert.equal(matchUploadedName("/mnt/data/file-R4f2oucJw7ietqM2Rzs4DF-Attachment_B_-_Port_List.csv", names), "Attachment B - Port List.csv");
  assert.equal(matchUploadedName("hyster-rfp.rtf", names), "Hyster-RFP.rtf");
  assert.equal(matchUploadedName("Attachment C - Specs.pdf", names), null);
});

test("an attachment the RFP points to but nobody uploaded is reported missing, even if the model claims it was found", () => {
  const analysis = normalizeRfpAnalysis({
    isRfpDocument: true,
    rfpSummary: "Port equipment campaign",
    referencedAttachments: [
      { name: "Attachment B (Port List)", foundInFile: "/mnt/data/file-abc-Attachment_B_-_Port_List.csv" },
      { name: "Attachment C (Creative Specs)", foundInFile: "Attachment C.pdf" },
      { name: "attachment b (port list)", foundInFile: null },
    ],
  }, HYSTER);

  assert.deepEqual(analysis?.referencedAttachments, [
    { name: "Attachment B (Port List)", foundInFile: "Attachment B - Port List.csv" },
    { name: "Attachment C (Creative Specs)", foundInFile: null },
  ]);
  assert.deepEqual(missingAttachments(analysis).map((attachment) => attachment.name), ["Attachment C (Creative Specs)"]);
});

test("two files stating different budgets is a conflict; the same value twice is not", () => {
  const analysis = normalizeRfpAnalysis({
    isRfpDocument: true,
    conflicts: [
      { field: "budget", values: [{ value: "250000", sourceFile: "Hyster-RFP.rtf" }, { value: "300000", sourceFile: "Attachment B - Port List.csv" }] },
      { field: "flightDates", values: [{ value: "Q1 2027", sourceFile: "Hyster-RFP.rtf" }, { value: "q1 2027", sourceFile: "Attachment B - Port List.csv" }] },
      { field: "audience", values: [{ value: "a", sourceFile: "Hyster-RFP.rtf" }, { value: "b", sourceFile: "Hyster-RFP.rtf" }] },
    ],
  }, HYSTER);

  assert.deepEqual(analysis?.conflicts, [
    { field: "budget", values: [{ value: "250000", sourceFile: "Hyster-RFP.rtf" }, { value: "300000", sourceFile: "Attachment B - Port List.csv" }] },
  ]);
});

test("a source naming a file nobody uploaded is dropped rather than shown", () => {
  const analysis = normalizeRfpAnalysis({
    isRfpDocument: true,
    digitalRemedyCapabilityMatches: [
      { rfpAsk: "Target the ports", digitalRemedySolution: "Geo", capabilityDetails: "", isSupported: false, sourceFile: "/mnt/data/file-x-Hyster-RFP.rtf" },
      { rfpAsk: "Weekly reports", digitalRemedySolution: "Reporting", capabilityDetails: "", sourceFile: "Contract.pdf" },
    ],
    metadataSources: { budget: "Hyster-RFP.rtf", geographies: "Ports.xlsx" },
  }, HYSTER);

  assert.equal(analysis?.digitalRemedyCapabilityMatches[0].sourceFile, "Hyster-RFP.rtf");
  assert.equal(analysis?.digitalRemedyCapabilityMatches[0].isSupported, false);
  assert.equal(analysis?.digitalRemedyCapabilityMatches[1].sourceFile, undefined);
  assert.deepEqual(analysis?.metadataSources, { budget: "Hyster-RFP.rtf" });
});

test("a single-file RFP is stored as before, without package fields", () => {
  const analysis = normalizeRfpAnalysis({ isRfpDocument: true, rfpSummary: "Brief", referencedAttachments: [{ name: "B", foundInFile: null }] }, [HYSTER[0]]);

  assert.equal(analysis?.packageFiles, undefined);
  assert.equal(analysis?.referencedAttachments, undefined);
  assert.equal(analysis?.rfpSummary, "Brief");
});

test("a spreadsheet reading is not an RFP analysis", () => {
  assert.equal(normalizeRfpAnalysis([{ publisher: "Hulu" }], HYSTER), null);
  assert.equal(normalizeRfpAnalysis({ placements: [] }, HYSTER), null);
});

test("an RFP's brief text is its summary and audiences, not the file's formatting", () => {
  const analysis: RfpAnalysis = {
    isRfpDocument: true,
    rfpSummary: "Display campaign for port equipment buyers.",
    rfpAsksAndQuestions: [],
    digitalRemedyCapabilityMatches: [],
    extractedMetadata: { targetAudiences: ["Terminal operators", "Equipment purchasers"], geographies: ["Port of Long Beach", "Port Houston"], kpis: ["CTR"] },
  };

  assert.equal(
    uploadBriefText("Hyster-RFP.rtf + 1 attachment", analysis, "{\\rtf1\\ansi\\fonttbl..."),
    "[RFP: Hyster-RFP.rtf + 1 attachment]\n\nSummary: Display campaign for port equipment buyers.\nTarget audiences: Terminal operators; Equipment purchasers\nGeographies: Port of Long Beach; Port Houston\nKPIs: CTR",
  );
});

test("a long location list is cut short in the brief text so it cannot crowd out the RFP", () => {
  const ports = Array.from({ length: 300 }, (_, i) => `Port ${i + 1}`);
  const brief = uploadBriefText("RFP.pdf", { isRfpDocument: true, rfpSummary: "S", rfpAsksAndQuestions: [], digitalRemedyCapabilityMatches: [], extractedMetadata: { geographies: ports } }, "");

  assert.match(brief, /Port 25; and 275 more/);
  assert.ok(brief.length <= 1500);
});

test("a media plan with no RFP reading still sends its own text, as before", () => {
  assert.equal(uploadBriefText("Plan.xlsx", null, "Hulu | CTV | $50,000"), "[Media Plan / RFP: Plan.xlsx]\n\nHulu | CTV | $50,000");
});

test("what the planner types beside an upload reaches the brief as their notes", () => {
  const brief = uploadBriefWithNotes("[RFP: RFP.pdf]\n\nSummary: S", "  Skew toward fleet managers  ");

  assert.equal(brief, "[RFP: RFP.pdf]\n\nSummary: S\n\nPlanner notes: Skew toward fleet managers");
});

test("an upload with nothing typed beside it sends its brief text unchanged", () => {
  assert.equal(uploadBriefWithNotes("[RFP: RFP.pdf]\n\nSummary: S", "   "), "[RFP: RFP.pdf]\n\nSummary: S");
});

test("long notes and a long RFP both fit in the characters the server keeps", () => {
  const upload = `[RFP: RFP.pdf]\n\n${"r".repeat(1500)}`.slice(0, 1500);
  const brief = uploadBriefWithNotes(upload, "n".repeat(2000));

  assert.ok(brief.length <= 1500);
  assert.ok(brief.startsWith("[RFP: RFP.pdf]"));
  assert.match(brief, /Planner notes: n+$/);
  assert.equal(brief.split("Planner notes: ")[1].length, plannerNotesLimit(upload));
});

test("a short RFP reading leaves its unused room to the planner's notes", () => {
  const upload = "[RFP: RFP.pdf]\n\nSummary: S";
  const notes = "n".repeat(1200);

  assert.ok(uploadBriefWithNotes(upload, notes).endsWith(notes));
});

test("a location list with a state column suggests those states", () => {
  const rows = [["Port", "City", "State"], ["Port of Long Beach", "Long Beach", "CA"], ["Port of Savannah", "Savannah", "GA"], ["Port Houston", "Houston", "TX"]];

  const suggestion = suggestGeoTargets(rows);
  assert.equal(suggestion?.type, "State");
  assert.equal(suggestion?.targets.length, 3);
});

test("a list with no states or DMAs suggests nothing", () => {
  assert.equal(suggestGeoTargets([["Venue"], ["Pier 39"], ["Terminal 5"]]), null);
});
