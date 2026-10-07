import assert from "node:assert/strict";
import test from "node:test";
import { platformReports } from "./__fixtures__/load";
import { extractPerformanceFigures, figureReference, unverifiedFigures } from "./figureCheck";
import { analyzeReportFiles, renderDigest } from "./index";

const reference = () => figureReference(renderDigest(analyzeReportFiles(platformReports()), { maxChars: 100_000 }));

test("PMs are checked even though they are small plain numbers", () => {
  assert.deepEqual(extractPerformanceFigures("OTT had PM 0.44 and a PM of 6.41").map((f) => [f.unit, f.value]), [["pm", 0.44], ["pm", 6.41]]);
});

test("figures quoted from the digest pass, at the precision they are written", () => {
  const text = "OTT took $174,138 (74.6% of spend) at CPA $53.85, PM 0.44 and ROAS 1.65x; 9,840 Checkouts in all. That is about 75% of spend and $174K.";
  assert.deepEqual(unverifiedFigures(text, reference()), []);
});

test("a figure ScoutAI worked out itself is flagged", () => {
  // Pre-roll CPM $6.56 against OTT's $19.47 is "one-third"; 0.34x is a ratio the digest never states.
  assert.deepEqual(unverifiedFigures("Pre-roll ran at 0.34x the CPM of OTT, a PM of 0.99 and a $61.20 CPA.", reference()), ["0.34x", "0.99", "$61.20"]);
});

test("dates, years, ordinals and small counts are not treated as claims", () => {
  assert.deepEqual(unverifiedFigures("From 2026-02-09 over 30 days, the 3rd week of March 2026, 4 media types.", reference()), []);
});

test("figures from the plan pass when the plan is part of the reference", () => {
  const withPlan = figureReference(renderDigest(analyzeReportFiles(platformReports())), "CTV / OTT at 21% = $21,000");
  assert.deepEqual(unverifiedFigures("Keep CTV at 21% ($21,000).", withPlan), []);
});

test("a PM of 1 is the definition of average, not a claim to check", () => {
  assert.deepEqual(unverifiedFigures("CBS was best at PM 0.74, still below the average PM of 1.0.", reference()), []);
});

test("the digest's 30-conversion threshold may be quoted in words", () => {
  assert.deepEqual(unverifiedFigures("CBS was best among CTV publishers with at least 30 conversions.", reference()), []);
});

test("ROAS quoted as the brief's percentage matches the multiple the data states", () => {
  const reference = figureReference("Display Retargeting: ROAS 17.63x, CPA $4.99");
  assert.deepEqual(unverifiedFigures("Retargeting returned 1,763% ROAS", reference), []);
  assert.deepEqual(unverifiedFigures("Retargeting returned 1,900% ROAS", reference), ["1,900%"]);
});
