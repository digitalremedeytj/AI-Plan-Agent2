import test from "node:test";
import assert from "node:assert/strict";
import { applyProgrammaticSanityChecks } from "./chartSanity";

const affinityChart = () => [
  { domain: "petco.com", value: 190, metricType: "Affinity Index", isModeled: true, source: "Modeled Planning Proxy" },
  { domain: "chewy.com", value: 175, metricType: "Affinity Index", isModeled: true, source: "Modeled Planning Proxy" },
  { domain: "petsmart.com", value: 145, metricType: "Affinity Index", isModeled: true, source: "Modeled Planning Proxy" },
  { domain: "petfinder.com", value: 135, metricType: "Affinity Index", isModeled: true, source: "Modeled Planning Proxy" },
  { domain: "youtube.com", value: 125, metricType: "Affinity Index", isModeled: true, source: "Modeled Planning Proxy" },
];

test("an affinity index chart is left alone instead of being relabelled as reach penetration", () => {
  const data: any = { browserAndReach: { chartData: affinityChart() } };

  const { corrections, alerts } = applyProgrammaticSanityChecks(data, {});

  assert.deepEqual(
    data.browserAndReach.chartData.map((d: any) => d.metricType),
    Array(5).fill("Affinity Index"),
  );
  assert.deepEqual(corrections, []);
});

test("a domain chart that claims to be a share but overlaps past 110% is relabelled", () => {
  const data: any = {
    browserAndReach: {
      chartData: affinityChart().map(d => ({ ...d, metricType: "Traffic Share" })),
    },
  };

  const { corrections, alerts } = applyProgrammaticSanityChecks(data, {});

  assert.equal(data.browserAndReach.chartData[0].metricType, "Audience Reach Penetration");
  assert.equal(corrections.length, 1);
  assert.match(corrections[0], /Audience Reach Penetration/);
});

test("device index values are removed with an alert rather than converted into a made-up share", () => {
  // What the remediation agent produced when the QA checklist told it the device chart mixed
  // denominators: a 100-baseline index. Converting it would manufacture a split no source reported.
  const data: any = {
    deviceTypeIndex: {
      chartData: [
        { device: "Mobile", value: 135, isModeled: false, source: "Nielsen" },
        { device: "CTV", value: 125, isModeled: false, source: "Nielsen" },
        { device: "Desktop/PC", value: 95, isModeled: false, source: "Nielsen" },
        { device: "Tablet", value: 80, isModeled: false, source: "Nielsen" },
        { device: "Game Console", value: 70, isModeled: false, source: "Nielsen" },
      ],
    },
  };

  const { corrections, alerts } = applyProgrammaticSanityChecks(data, {});

  assert.deepEqual(data.deviceTypeIndex.chartData, []);
  assert.deepEqual(corrections, []);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].section, "deviceTypeIndex");
  assert.match(alerts[0].message, /summed to 505\.0%/);
});

test("rounding drift under two points is corrected without reporting an auto-fix", () => {
  const data: any = {
    demographics: {
      ageChartData: [
        { range: "18-24", value: 12 },
        { range: "25-34", value: 23 },
        { range: "35-44", value: 22 },
        { range: "45-54", value: 19 },
        { range: "55+", value: 23.5 },
      ],
    },
  };

  const { corrections, alerts } = applyProgrammaticSanityChecks(data, {});

  const sum = data.demographics.ageChartData.reduce((acc: number, d: any) => acc + d.value, 0);
  assert.equal(Math.round(sum * 10) / 10, 100);
  assert.deepEqual(corrections, []);
});

test("a share chart that misses 100 by more than ten points is removed, not rescaled", () => {
  const data: any = {
    demographics: {
      genderChartData: [
        { gender: "Female", value: 66 },
        { gender: "Male", value: 51 },
        { gender: "Non-binary / Other", value: 3 },
      ],
    },
  };

  const { corrections, alerts } = applyProgrammaticSanityChecks(data, {});

  assert.deepEqual(data.demographics.genderChartData, []);
  assert.deepEqual(corrections, []);
  assert.match(alerts[0].message, /Gender split: removed because its shares summed to 120\.0%/);
});

test("a share chart a few points off is still rescaled and reported as a correction", () => {
  const data: any = {
    demographics: {
      ageChartData: [
        { range: "18-34", value: 40 },
        { range: "35-54", value: 35 },
        { range: "55+", value: 30 },
      ],
    },
  };

  const { corrections, alerts } = applyProgrammaticSanityChecks(data, {});

  const sum = data.demographics.ageChartData.reduce((acc: number, d: any) => acc + d.value, 0);
  assert.equal(Math.round(sum * 10) / 10, 100);
  assert.match(corrections[0], /was 105\.0%/);
  assert.deepEqual(alerts, []);
});

test("a mass-market audience skewed to six figures is flagged, and its researched split is left as reported", () => {
  const data: any = {
    intro: "Broad U.S. pet owners.",
    demographics: {
      incomeChartData: [
        { bracket: "<$50k", value: 10 },
        { bracket: "$50k-$75k", value: 15 },
        { bracket: "$75k-$100k", value: 15 },
        { bracket: "$100k-$150k", value: 35 },
        { bracket: "$150k+", value: 25 },
      ],
    },
  };

  const { corrections, alerts } = applyProgrammaticSanityChecks(data, {});

  assert.deepEqual(data.demographics.incomeChartData.map((d: any) => d.value), [10, 15, 15, 35, 25]);
  assert.deepEqual(corrections, []);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].message, /60% of this audience is shown earning over \$100k/);
});

test("an audience described as affluent keeps its high-income skew", () => {
  const data: any = {
    intro: "Affluent luxury pet owners.",
    demographics: {
      incomeChartData: [
        { bracket: "<$50k", value: 10 },
        { bracket: "$50k-$75k", value: 15 },
        { bracket: "$75k-$100k", value: 15 },
        { bracket: "$100k-$150k", value: 35 },
        { bracket: "$150k+", value: 25 },
      ],
    },
  };

  const { corrections, alerts } = applyProgrammaticSanityChecks(data, { audienceDescription: "Affluent households" });

  assert.equal(data.demographics.incomeChartData[3].value, 35);
  assert.deepEqual(corrections, []);
  assert.deepEqual(alerts, []);
});
