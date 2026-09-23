import test from "node:test";
import assert from "node:assert/strict";
import { chartRealismProblems, findUnrealisticCharts, labelEstimatedPoints, numbersInText, realismFixes } from "./chartRealism";
import { PROFILE_CHARTS } from "./generationIntegrity";

const spec = (id: string) => PROFILE_CHARTS.find((chart) => chart.id === id)!;

test("numbers are read from research text including percentages, decimals and thousands separators", () => {
  assert.deepEqual(numbersInText("51% female, 23.5% aged 25-34, 1,250 respondents, index 225"), [51, 23.5, 25, 34, 1250, 225]);
});

test("a chart counts as sourced only when the research states every value", () => {
  const profile: any = {
    demographics: {
      genderChartData: [
        { gender: "Female", value: 51, isModeled: false, source: "Pew 2025" },
        { gender: "Male", value: 47, isModeled: false, source: "Pew 2025" },
      ],
      ageChartData: [
        { range: "18-34", value: 38, isModeled: false, source: "Pew 2025" },
        { range: "35+", value: 62, isModeled: false, source: "Pew 2025" },
      ],
    },
  };

  const labelled = labelEstimatedPoints(profile, "Pew: 50.6% of players are women. 38% are 18-34 and 62% are 35 or older.");

  assert.deepEqual(profile.demographics.ageChartData.map((p: any) => p.isModeled), [false, false], "every age value is stated");
  assert.deepEqual(profile.demographics.genderChartData.map((p: any) => p.isModeled), [true, true], "47% is not in the research, so the whole split is an estimate");
  assert.equal(profile.demographics.genderChartData[1].source, "ScoutAI estimate (informed by Pew 2025)");
  assert.equal(labelled, 2);
});

test("a share that appears only as a bare number, not a percentage, is not treated as sourced", () => {
  const profile: any = { demographics: { ageChartData: [{ range: "25-34", value: 27, isModeled: false }, { range: "35+", value: 73, isModeled: false }] } };

  labelEstimatedPoints(profile, "27 respondents and 73 stores were surveyed.");

  assert.ok(profile.demographics.ageChartData.every((p: any) => p.isModeled === true));
});

test("a point the model called modeled stays modeled even if the number happens to appear in the research", () => {
  const profile: any = { deviceTypeIndex: { chartSource: "Model", chartData: [{ device: "CTV", value: 20, isModeled: true, source: "Modeled Planning Proxy" }] } };

  labelEstimatedPoints(profile, "20 respondents");

  assert.equal(profile.deviceTypeIndex.chartData[0].isModeled, true);
  assert.equal(profile.deviceTypeIndex.chartData[0].source, "Modeled Planning Proxy");
});

test("a chart made entirely of estimates says so in its source footer", () => {
  const profile: any = { deviceTypeIndex: { chartSource: "eMarketer 2025", chartData: [{ device: "CTV", value: 46 }, { device: "Mobile", value: 54 }] } };

  labelEstimatedPoints(profile, "no numbers here");

  assert.equal(profile.deviceTypeIndex.chartSource, "ScoutAI estimate (informed by eMarketer 2025)");
});

test("a daypart chart that climbs in a straight line is flagged", () => {
  // The hour-of-day curve from a live run: 44 -> 86 -> 114 -> 128 -> 146.
  const hours = [82, 44, 86, 114, 128, 146].map((index, i) => ({ hour: `h${i}`, index }));

  const problems = chartRealismProblems(spec("hourOfDay"), hours);

  assert.equal(problems.length, 1);
  assert.match(problems[0], /rises steadily across 5 consecutive periods/);
});

test("a daypart chart with a lunchtime bump and a prime-time peak passes", () => {
  const hours = [61, 23, 74, 97, 88, 143].map((index, i) => ({ hour: `h${i}`, index }));

  assert.deepEqual(chartRealismProblems(spec("hourOfDay"), hours), []);
});

test("a ranked domain list may descend, but not in even steps or round numbers", () => {
  const descending = [310, 285, 275, 260, 245].map((value, i) => ({ domain: `d${i}`, value }));
  const even = [300, 280, 260, 240, 220].map((value, i) => ({ domain: `d${i}`, value }));

  assert.deepEqual(chartRealismProblems(spec("domains"), descending), ["every value is a round multiple of 5"]);
  assert.deepEqual(chartRealismProblems(spec("domains"), even), ["its values are evenly spaced", "every value is a round multiple of 5"]);
  assert.deepEqual(chartRealismProblems(spec("domains"), [312, 287, 241, 226, 219].map((value, i) => ({ domain: `d${i}`, value }))), []);
});

test("repeated identical values are flagged, and short charts are not judged at all", () => {
  const ages = [22, 22, 22, 17, 17].map((value, i) => ({ range: `r${i}`, value }));

  assert.deepEqual(chartRealismProblems(spec("age"), ages), ["three or more values are identical"]);
  assert.deepEqual(chartRealismProblems(spec("gender"), [{ gender: "F", value: 50 }, { gender: "M", value: 50 }]), []);
});

test("only charts with a problem are returned for revision", () => {
  const profile: any = {
    temporalPatterns: { hourOfDayChartData: [82, 44, 86, 114, 128, 146].map((index, i) => ({ hour: `h${i}`, index })), dayOfWeekChartData: [] },
    demographics: { ageChartData: [18, 31, 18, 16, 17].map((value, i) => ({ range: `r${i}`, value })) },
  };

  assert.deepEqual(findUnrealisticCharts(profile).map((entry) => entry.chart.id), ["hourOfDay"]);
});

test("each realism problem maps to a concrete instruction for the revision", () => {
  const fixes = realismFixes(["every value is a round multiple of 5", "its values are evenly spaced"]);

  assert.match(fixes[0], /last digit is not 0 or 5/);
  assert.match(fixes[1], /uneven/);
});
