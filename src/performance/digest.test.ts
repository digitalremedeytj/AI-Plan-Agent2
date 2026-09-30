import assert from "node:assert/strict";
import test from "node:test";
import { fixture, platformReports } from "./__fixtures__/load";
import { analyzeReportFiles, renderDigest } from "./index";

const digest = (maxChars?: number) => renderDigest(analyzeReportFiles(platformReports()), maxChars ? { maxChars } : {});

test("the data notes come before any breakdown, so they frame what follows", () => {
  const text = digest();
  assert.ok(text.indexOf("DATA NOTES") < text.indexOf("BY MEDIATYPE"));
  assert.ok(text.indexOf("CAUTION") < text.indexOf("different cuts of the same campaign"), "cautions are listed before information");
});

test("ratios are stated from counts, never copied from the export's percentage columns", () => {
  const text = digest();
  const ott = text.split("\n").find((line) => line.startsWith("- OTT:"))!;
  assert.match(ott, /ROAS 1\.65x/);
  assert.match(ott, /VCR 95\.83%/);
  assert.doesNotMatch(ott, /164\.9/);
});

test("the conversion event is named in every row, not the export's Visits column", () => {
  const text = digest();
  assert.match(text, /3,234 Checkouts/);
  assert.doesNotMatch(text, /Visits/);
});

test("the digest fits its limit by cutting the smallest rows and says what it left out", () => {
  const full = digest();
  const short = digest(7000);
  assert.ok(short.length <= 7000, `got ${short.length}`);
  assert.ok(short.length < full.length);
  assert.match(short, /more rows: \$[\d,]+ \([\d.]+% of spend\)/);
  assert.ok(short.includes("DATA NOTES") && short.includes("BY MEDIATYPE"));
});

test("every media type row is shown whatever the limit, since channel decisions rest on it", () => {
  const short = digest(5000);
  for (const name of ["OTT", "Pre-Roll/Mid-Roll", "Display Retargeting", "Display"]) assert.ok(short.includes(`- ${name}:`), name);
});

test("the digest never contains a household hash from a touch file", () => {
  const touch = fixture("last_touch_sample.csv");
  const text = renderDigest(analyzeReportFiles([touch]));
  const hashes = touch.text.split("\n").slice(1).map((line) => line.split(",")[1]).filter(Boolean);
  assert.ok(hashes.length > 0);
  for (const hash of hashes) assert.ok(!text.includes(hash));
  assert.match(text, /LAST-TOUCH CONVERSIONS/);
});

test("best and weakest rows are stated from the data, leaving out thin rows and media types listed as publishers", () => {
  const text = digest();
  const publisher = text.split("\n").find((line) => line.startsWith("- Ranked by PM among CTV publishers"))!;
  assert.ok(publisher, "the publisher report is ranked among CTV publishers only");
  assert.match(publisher, /best CBS 0\.74/);
  assert.doesNotMatch(publisher, /Display Retargeting|Pre-Roll/);
  const rankings = text.split("\n").filter((l) => l.startsWith("- Ranked by PM"));
  assert.ok(rankings.every((l) => !l.includes("Gym Bros")), "rows under 30 conversions are not ranked");
  const mediaTypes = rankings[0];
  assert.match(mediaTypes, /best Display Retargeting 4\.75 \(CPA \$4\.99\), Display 3\.66 \(CPA \$6\.48\); weakest OTT 0\.44 \(CPA \$53\.85\), Pre-Roll\/Mid-Roll 1\.18/, "a short report is split without overlap");
});
