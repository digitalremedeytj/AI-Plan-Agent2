import test from "node:test";
import assert from "node:assert/strict";
import {
  checkPersonas,
  clearSectionsForFailedDossiers,
  mergeRemediatedProfile,
  removeModeledCharts,
  reportChartsNotFound,
} from "./generationIntegrity";

const researched = (source = "Pew Research 2025") => ({ isModeled: false, source });

const profileWithCharts = (): any => ({
  demographics: {
    overview: "Adults 25-44 over-index.",
    geographyNotes: "Suburban skew.",
    ageChartData: [{ range: "25-34", value: 60, ...researched() }, { range: "35-44", value: 40, ...researched() }],
    genderChartData: [{ gender: "Female", value: 55, ...researched() }, { gender: "Male", value: 45, ...researched() }],
    incomeChartData: [{ bracket: "<$100k", value: 70, ...researched() }, { bracket: "$100k+", value: 30, ...researched() }],
  },
  browserAndReach: { overview: "Twitch leads.", chartSource: "Similarweb", chartData: [{ domain: "twitch.tv", value: 180, ...researched("Similarweb 2026") }] },
  deviceTypeIndex: { overview: "CTV first.", chartSource: "Nielsen", chartData: [{ device: "CTV", value: 60, ...researched() }, { device: "Mobile", value: 40, ...researched() }] },
  temporalPatterns: {
    overview: "Evenings peak.",
    activationNotes: "Weight prime time.",
    dayOfWeekChartData: [{ day: "Sat", index: 120, ...researched() }],
    hourOfDayChartData: [{ hour: "8pm-12am", index: 140, ...researched() }],
  },
});

test("a failed research dossier clears the charts and prose it feeds instead of leaving a guess", () => {
  const profile = profileWithCharts();

  const alerts = clearSectionsForFailedDossiers(profile, ["Demographics"]);

  assert.deepEqual(profile.demographics.ageChartData, []);
  assert.deepEqual(profile.demographics.incomeChartData, []);
  assert.equal(profile.demographics.overview, "");
  assert.equal(profile.demographics.geographyNotes, "");
  assert.equal(profile.deviceTypeIndex.chartData.length, 2, "other topics are untouched");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].severity, "failed");
  assert.match(alerts[0].message, /Demographics research failed/);
});

test("a chart with any modeled value is removed whole, not shipped with an invented slice", () => {
  const profile = profileWithCharts();
  profile.deviceTypeIndex.chartData[1] = { device: "Mobile", value: 40, isModeled: true, source: "Nielsen" };
  profile.browserAndReach.chartData[0].source = "Modeled Planning Proxy";

  const alerts = removeModeledCharts(profile);

  assert.deepEqual(profile.deviceTypeIndex.chartData, []);
  assert.deepEqual(profile.browserAndReach.chartData, []);
  assert.equal(profile.demographics.ageChartData.length, 2);
  assert.deepEqual(alerts.map((a) => a.section).sort(), ["browserAndReach", "deviceTypeIndex"]);
});

test("a real source whose name mentions benchmarks is not mistaken for modeled data", () => {
  const profile = profileWithCharts();
  profile.deviceTypeIndex.chartData[0].source = "Nielsen Streaming Benchmark Report 2026";

  assert.deepEqual(removeModeledCharts(profile), []);
  assert.equal(profile.deviceTypeIndex.chartData.length, 2);
});

test("an empty chart is reported as not found in research unless another alert already explains it", () => {
  const profile = profileWithCharts();
  profile.temporalPatterns.dayOfWeekChartData = [];
  profile.temporalPatterns.hourOfDayChartData = [];
  const existing = [{ section: "temporalPatterns", severity: "not_found" as const, message: "Hour-of-day activity: removed because it contained modeled or estimated values rather than figures from the research." }];

  const alerts = reportChartsNotFound(profile, existing);

  assert.deepEqual(alerts, [{ section: "temporalPatterns", severity: "not_found", message: "Day-of-week activity: not found in research." }]);
});

test("remediation cannot delete a section: anything it omits or empties keeps the synthesized version", () => {
  const original = { personas: [{ name: "Core Gamer" }], ctvPublishers: [{ publisher: "Hulu" }], intro: "Original intro.", sources: [{ url: "https://a" }] };
  const corrected = { intro: "Sharper intro.", ctvPublishers: [], sources: [{ url: "https://invented" }] };

  const { profile, restored } = mergeRemediatedProfile(original, corrected);

  assert.equal(profile.intro, "Sharper intro.");
  assert.deepEqual(profile.personas, original.personas);
  assert.deepEqual(profile.ctvPublishers, original.ctvPublishers);
  assert.deepEqual(profile.sources, original.sources, "citations always stay the researched registry");
  assert.deepEqual(restored.sort(), ["ctvPublishers", "personas"]);
});

test("fewer than four personas is reported, never padded with stand-ins", () => {
  const profile: any = { personas: [{ name: "Core Gamer", sourceType: "ScoutAI" }, { name: "Casual Player" }] };

  const alerts = checkPersonas(profile, { mediaPlanUploaded: false });

  assert.equal(profile.personas.length, 2);
  assert.ok(profile.personas.every((p: any) => !/Archetype/.test(p.name)));
  assert.deepEqual(alerts.map((a) => a.message), ["Only 2 of 4 personas were generated."]);
});

test("persona labels come from the model, not from their position in the list", () => {
  const profile: any = {
    personas: [
      { name: "A", sourceType: "ScoutAI" },
      { name: "B", sourceType: "RFP" },
      { name: "C", sourceType: "RFP" },
      { name: "D", sourceType: "RFP" },
    ],
  };

  checkPersonas(profile, { mediaPlanUploaded: true });

  assert.deepEqual(profile.personas.map((p: any) => p.sourceType), ["ScoutAI", "RFP", "RFP", "RFP"]);
  assert.deepEqual(profile.personas.map((p: any) => p.isExpansion), [true, false, false, false]);
});

test("without an uploaded plan a user-specified persona keeps its label and the rest are ScoutAI", () => {
  const profile: any = { personas: [{ name: "A", sourceType: "User" }, { name: "B", sourceType: "RFP" }, { name: "C" }, { name: "D" }] };

  checkPersonas(profile, { mediaPlanUploaded: false });

  assert.deepEqual(profile.personas.map((p: any) => p.sourceType), ["User", "ScoutAI", "ScoutAI", "ScoutAI"]);
});
