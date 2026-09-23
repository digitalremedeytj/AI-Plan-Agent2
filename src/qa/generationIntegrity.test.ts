import test from "node:test";
import assert from "node:assert/strict";
import {
  checkPersonas,
  clearSectionsForFailedDossiers,
  mergeRemediatedProfile,
  removeMixedSourceCharts,
  removeModeledCharts,
  removeUngroundedCharts,
  numbersInText,
  reportChartsNotFound,
  applyQaChartRejections,
  lockChartsFrom,
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
  const original = { personas: [{ name: "Core Gamer" }], ctvPublishers: [{ publisher: "Hulu" }], intro: "Original intro.", sources: [{ url: "https://a" }], channelStrategy: { mediaPlan: {} } };
  const corrected = { intro: "Sharper intro.", ctvPublishers: [], sources: [{ url: "https://invented" }] };

  const { profile, restored } = mergeRemediatedProfile(original, corrected);

  assert.equal(profile.intro, "Sharper intro.");
  assert.deepEqual(profile.personas, original.personas);
  assert.deepEqual(profile.ctvPublishers, original.ctvPublishers);
  assert.deepEqual(profile.sources, original.sources, "citations always stay the researched registry");
  assert.deepEqual(profile.channelStrategy, original.channelStrategy);
  assert.deepEqual(restored.sort(), ["ctvPublishers", "personas"], "sources and channelStrategy are always kept, so they are not reported as restored");
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

test("QA can remove a chart it names, and the plan says why", () => {
  const profile = profileWithCharts();

  const alerts = applyQaChartRejections(profile, [
    { chart: "age", reason: "CDC birth data describes mothers, not organic baby-product shoppers" },
    { chart: "notAChart", reason: "ignored" },
  ]);

  assert.deepEqual(profile.demographics.ageChartData, []);
  assert.equal(profile.demographics.genderChartData.length, 2, "charts QA did not name stay");
  assert.deepEqual(alerts.map((a) => a.message), ["Age distribution: removed after QA review - CDC birth data describes mothers, not organic baby-product shoppers."]);
});

test("a note about a chart QA later removed is dropped, so the plan does not describe figures it no longer shows", () => {
  const profile = profileWithCharts();
  const existing = [
    { section: "demographics", severity: "flagged" as const, message: "Household income: 42% of this audience is shown earning over $100k..." },
    { section: "research", severity: "failed" as const, message: "The website crawl failed." },
  ];

  const removal = applyQaChartRejections(profile, [{ chart: "income", reason: "Source is from 2017" }], existing);

  assert.deepEqual(existing.map((a) => a.message), ["The website crawl failed."]);
  assert.match(removal[0].message, /^Household income: removed after QA review - Source is from 2017\.$/);
});

test("remediation cannot change or delete chart figures", () => {
  const original = profileWithCharts();
  const rewritten: any = { demographics: { overview: "Sharper prose.", ageChartData: [] }, deviceTypeIndex: { overview: "New.", chartData: [{ device: "CTV", value: 99 }] } };

  lockChartsFrom(rewritten, original);

  assert.equal(rewritten.demographics.overview, "Sharper prose.", "prose edits are kept");
  assert.deepEqual(rewritten.demographics.ageChartData, original.demographics.ageChartData);
  assert.deepEqual(rewritten.deviceTypeIndex.chartData, original.deviceTypeIndex.chartData);
  assert.deepEqual(rewritten.temporalPatterns.dayOfWeekChartData, original.temporalPatterns.dayOfWeekChartData, "a section the rewrite dropped gets its charts back");
});

test("a chart stitched together from several studies is removed rather than shown as one split", () => {
  const profile = profileWithCharts();
  profile.deviceTypeIndex.chartData = [
    { device: "CTV", value: 45, isModeled: false, source: "Nielsen Gauge 2026" },
    { device: "Mobile", value: 35, isModeled: false, source: "Comscore 2025" },
    { device: "Desktop", value: 20, isModeled: false, source: "Nielsen Gauge 2026" },
  ];

  const alerts = removeMixedSourceCharts(profile);

  assert.deepEqual(profile.deviceTypeIndex.chartData, []);
  assert.match(alerts[0].message, /Device split: removed because it combined figures from 2 different sources/);
  assert.equal(profile.demographics.ageChartData.length, 2, "single-source charts stay");
});

test("one study's breakdown is kept even when its label differs only in case or punctuation", () => {
  const profile = profileWithCharts();
  profile.demographics.ageChartData[1].source = "pew research 2025.";

  assert.deepEqual(removeMixedSourceCharts(profile), []);
  assert.equal(profile.demographics.ageChartData.length, 2);
});

test("a chart with an unsourced value is removed", () => {
  const profile = profileWithCharts();
  profile.demographics.genderChartData[0].source = "";

  const alerts = removeMixedSourceCharts(profile);

  assert.deepEqual(profile.demographics.genderChartData, []);
  assert.match(alerts[0].message, /did not name their source/);
});

test("numbers are read from research text including percentages, decimals and thousands separators", () => {
  assert.deepEqual(numbersInText("51% female, 23.5% aged 25-34, 1,250 respondents, index 225"), [51, 23.5, 25, 34, 1250, 225]);
});

test("a chart whose values the research never reported is removed before QA sees it", () => {
  const profile = profileWithCharts();
  const research = "ESA found 60% of players are 25-34 and 40% are 35-44. Similarweb: twitch.tv affinity index 180. "
    + "Women are 55% and men 45%. Income under $100k is 70%, over 30%. CTV 60%, mobile 40%. Saturday index 120; 8pm-12am index 140.";
  profile.deviceTypeIndex.chartData = [
    { device: "CTV", value: 58, isModeled: false, source: "eMarketer 2025" },
    { device: "Mobile", value: 42, isModeled: false, source: "eMarketer 2025" },
  ];

  const alerts = removeUngroundedCharts(profile, research);

  assert.deepEqual(profile.deviceTypeIndex.chartData, [], "58/42 appear nowhere in the research");
  assert.match(alerts[0].message, /Device split: removed because its values do not appear in the research/);
  assert.equal(profile.demographics.ageChartData.length, 2, "reported figures are kept");
  assert.equal(profile.temporalPatterns.hourOfDayChartData.length, 1);
});

test("a value synthesis rounded from the reported figure still counts as grounded", () => {
  const profile = profileWithCharts();
  profile.demographics.genderChartData = [
    { gender: "Female", value: 51, isModeled: false, source: "Pew Research 2025" },
    { gender: "Male", value: 49, isModeled: false, source: "Pew Research 2025" },
  ];

  removeUngroundedCharts(profile, "Pew: 50.6% of travelers are women and 49.4% are men.");

  assert.equal(profile.demographics.genderChartData.length, 2);
});
