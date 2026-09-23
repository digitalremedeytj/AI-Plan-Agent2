import test from "node:test";
import assert from "node:assert/strict";
import { applyAudienceSkews, audienceSkewSchema, chartsNeedingBaselineEstimates, describeBaselines } from "./baselineEstimates";
import { ATUS_2025_TV_BY_HOUR, NATIONAL_BASELINES } from "../planning/knowledge/nationalBaselines";

const skewsFor = (id: string, index: (label: string) => number) => {
  const baseline = NATIONAL_BASELINES[id];
  const labels = baseline.kind === "share" ? baseline.brackets.map((b) => b.label) : baseline.periods.map((p) => p.label);
  return labels.map((label) => ({ label, index: index(label), reason: "test" }));
};

test("the baselines carry the published national shape", () => {
  const hours = NATIONAL_BASELINES.hourOfDay;
  assert.equal(hours.kind, "index");
  if (hours.kind !== "index") return;
  const peak = hours.periods.reduce((best, p) => (p.index > best.index ? p : best));
  assert.equal(peak.label, "6pm-9pm", "ATUS TV viewing peaks in prime time");
  assert.equal(hours.periods.reduce((low, p) => (p.index < low.index ? p : low)).label, "3am-6am");
  assert.equal(ATUS_2025_TV_BY_HOUR.length, 24);

  for (const id of ["age", "gender", "income"]) {
    const baseline = NATIONAL_BASELINES[id];
    if (baseline.kind !== "share") continue;
    const total = baseline.brackets.reduce((sum, b) => sum + b.share, 0);
    assert.ok(Math.abs(total - 100) <= 0.2, `${id} shares sum to ${total}`);
  }
});

test("no skew reproduces the national distribution", () => {
  const points = applyAudienceSkews(NATIONAL_BASELINES.age, skewsFor("age", () => 100), "estimate")!;

  assert.deepEqual(points.map((p) => p.value), [11.7, 17.4, 17.1, 15.3, 15.6, 22.9]);
  assert.ok(points.every((p) => p.isModeled === true && p.source === "estimate"));
});

test("a younger-skewing audience shifts share toward young brackets and still sums to 100", () => {
  const points = applyAudienceSkews(NATIONAL_BASELINES.age, skewsFor("age", (label) => (label === "25-34" ? 180 : label === "65+" ? 40 : 100)), "estimate")!;

  const total = points.reduce((sum, p) => sum + p.value, 0);
  assert.ok(Math.abs(total - 100) < 0.3);
  assert.ok(points.find((p) => p.range === "25-34")!.value > 17.4 * 1.5);
  assert.ok(points.find((p) => p.range === "65+")!.value < 22.9 / 2);
});

test("an hour chart keeps the real prime-time peak and is rescaled so its mean is 100", () => {
  const points = applyAudienceSkews(NATIONAL_BASELINES.hourOfDay, skewsFor("hourOfDay", (label) => (label === "12am-3am" ? 250 : 100)), "estimate")!;

  const mean = points.reduce((sum, p) => sum + p.index, 0) / points.length;
  assert.ok(Math.abs(mean - 100) <= 1);
  assert.equal(points.reduce((best, p) => (p.index > best.index ? p : best)).hour, "6pm-9pm");
  const national = NATIONAL_BASELINES.hourOfDay.kind === "index" ? NATIONAL_BASELINES.hourOfDay.periods[0].index : 0;
  assert.ok(points[0].index > national * 2, "a night-owl skew lifts the late-night block well above national");
});

test("skews that do not cover every bracket are not applied piecemeal", () => {
  const partial = skewsFor("income", () => 120).slice(0, 3);

  assert.equal(applyAudienceSkews(NATIONAL_BASELINES.income, partial, "estimate"), null);
  assert.equal(applyAudienceSkews(NATIONAL_BASELINES.income, undefined, "estimate"), null);
});

test("an implausible 50x skew is clamped", () => {
  const points = applyAudienceSkews(NATIONAL_BASELINES.gender, [{ label: "Male", index: 5000 }, { label: "Female", index: 100 }], "estimate")!;

  assert.ok(points[0].value < 90, "clamped to 6x, so men are ~85%, not ~98%");
});

test("only baseline charts without research figures, and whose research did not fail, are rebuilt", () => {
  const profile: any = {
    demographics: {
      ageChartData: [{ range: "25-34", value: 40, isModeled: false, source: "ESA 2025" }],
      genderChartData: [{ gender: "Male", value: 53, isModeled: true }],
      incomeChartData: [],
    },
    temporalPatterns: { dayOfWeekChartData: [], hourOfDayChartData: [] },
    deviceTypeIndex: { chartData: [] },
  };

  assert.deepEqual(chartsNeedingBaselineEstimates(profile, []), ["gender", "income", "dayOfWeek", "hourOfDay"]);
  assert.deepEqual(chartsNeedingBaselineEstimates(profile, ["Temporal & Purchase"]), ["gender", "income"]);
});

test("the skew request names each requested chart and shows the real baseline figures", () => {
  const schema: any = audienceSkewSchema(["age", "hourOfDay"]);

  assert.deepEqual(schema.required, ["age", "hourOfDay"]);
  assert.match(describeBaselines(["income"]), /\$200k\+: 16% of U.S. adults/);
});
