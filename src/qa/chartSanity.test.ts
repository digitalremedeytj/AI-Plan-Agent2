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

  const corrections = applyProgrammaticSanityChecks(data, {});

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

  const corrections = applyProgrammaticSanityChecks(data, {});

  assert.equal(data.browserAndReach.chartData[0].metricType, "Audience Reach Penetration");
  assert.equal(corrections.length, 1);
  assert.match(corrections[0], /Audience Reach Penetration/);
});

test("device index values are converted back to a composition share and reported", () => {
  // What the remediation agent produced when the QA checklist told it the device chart mixed
  // denominators: a 100-baseline index the pie chart and the "Split Share %" export cannot render.
  const data: any = {
    deviceTypeIndex: {
      chartData: [
        { device: "Mobile", value: 135, isModeled: true, source: "Modeled" },
        { device: "CTV", value: 125, isModeled: true, source: "Modeled" },
        { device: "Desktop/PC", value: 95, isModeled: true, source: "Modeled" },
        { device: "Tablet", value: 80, isModeled: true, source: "Modeled" },
        { device: "Game Console", value: 70, isModeled: true, source: "Modeled" },
      ],
    },
  };

  const corrections = applyProgrammaticSanityChecks(data, {});

  const sum = data.deviceTypeIndex.chartData.reduce((acc: number, d: any) => acc + d.value, 0);
  assert.equal(Math.round(sum * 10) / 10, 100);
  assert.equal(corrections.length, 1);
  assert.match(corrections[0], /index values summing to 505\.0%/);
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

  const corrections = applyProgrammaticSanityChecks(data, {});

  const sum = data.demographics.ageChartData.reduce((acc: number, d: any) => acc + d.value, 0);
  assert.equal(Math.round(sum * 10) / 10, 100);
  assert.deepEqual(corrections, []);
});

test("a materially broken share chart is still normalized and reported", () => {
  const data: any = {
    demographics: {
      genderChartData: [
        { gender: "Female", value: 66 },
        { gender: "Male", value: 51 },
        { gender: "Non-binary / Other", value: 3 },
      ],
    },
  };

  const corrections = applyProgrammaticSanityChecks(data, {});

  const sum = data.demographics.genderChartData.reduce((acc: number, d: any) => acc + d.value, 0);
  assert.equal(Math.round(sum * 10) / 10, 100);
  assert.equal(corrections.length, 1);
  assert.match(corrections[0], /was 120\.0%/);
});

test("a mass-market audience skewed to six figures is pulled back to national benchmarks", () => {
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

  const corrections = applyProgrammaticSanityChecks(data, {});

  const high = data.demographics.incomeChartData
    .filter((d: any) => d.bracket.includes("100k") || d.bracket.includes("150k"))
    .reduce((acc: number, d: any) => acc + d.value, 0);
  assert.ok(Math.abs(high - 34) < 1, `expected ~34% over $100k, got ${high}`);
  assert.ok(corrections.some(c => /HHI skew/.test(c)));
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

  const corrections = applyProgrammaticSanityChecks(data, { audienceDescription: "Affluent households" });

  assert.equal(data.demographics.incomeChartData[3].value, 35);
  assert.deepEqual(corrections, []);
});
