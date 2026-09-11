import assert from "node:assert/strict";
import test from "node:test";
import {
  clonePlanningSettings,
  DEFAULT_PLANNING_SETTINGS,
  findBudgetChannelTier,
  loadPlanningSettings,
  normalizeCampaignBudget,
  PLANNING_SETTINGS_STORAGE_KEY,
  savePlanningSettings,
  validatePlanningSettings,
} from "./settings";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

test("loads defaults when settings are absent or invalid", () => {
  const storage = new MemoryStorage();
  assert.deepEqual(loadPlanningSettings(storage), DEFAULT_PLANNING_SETTINGS);
  storage.setItem(PLANNING_SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, budgetChannelTiers: [] }));
  assert.deepEqual(loadPlanningSettings(storage), DEFAULT_PLANNING_SETTINGS);
});

test("valid edits persist and load in minimum-budget order", () => {
  const storage = new MemoryStorage();
  const settings = clonePlanningSettings(DEFAULT_PLANNING_SETTINGS);
  settings.budgetChannelTiers[0].maxChannels = 2;
  settings.budgetChannelTiers.reverse();
  const saved = savePlanningSettings(storage, settings);
  assert.equal(saved.valid, true);
  assert.equal(loadPlanningSettings(storage).budgetChannelTiers[0].maxChannels, 2);
  assert.equal(loadPlanningSettings(storage).budgetChannelTiers[0].minBudget, 0);
});

test("overview metric defaults show the four requested cards", () => {
  const visibility = Object.fromEntries(DEFAULT_PLANNING_SETTINGS.overviewMetrics.map((metric) => [metric.id, metric.show]));
  assert.deepEqual(visibility, {
    budget: true,
    ecpm: false,
    impressions: true,
    completedViews: true,
    costPerView: false,
    estimatedReach: true,
    avgFrequency: false,
  });
});

test("version 1 browser settings migrate budget edits into the usable catalog defaults", () => {
  const storage = new MemoryStorage();
  const legacyTiers = DEFAULT_PLANNING_SETTINGS.budgetChannelTiers.map((tier) => ({ ...tier }));
  legacyTiers[0].maxChannels = 2;
  storage.setItem(PLANNING_SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, budgetChannelTiers: legacyTiers }));
  const migrated = loadPlanningSettings(storage);
  assert.equal(migrated.version, 3);
  assert.equal(migrated.budgetChannelTiers[0].maxChannels, 2);
  assert.equal(migrated.products.length, 14);
  assert.equal(migrated.publishers.length, 67);
  assert.ok(migrated.enhancements.length > 40);
  assert.equal(migrated.overviewMetrics.length, 7);
});

test("version 2 browser settings retain catalog edits and receive overview defaults", () => {
  const storageVersion2 = new MemoryStorage();
  const current = clonePlanningSettings(DEFAULT_PLANNING_SETTINGS);
  current.products[0].minimumTotalSpend = 12_345;
  const { overviewMetrics: _overviewMetrics, ...withoutOverviewMetrics } = current;
  storageVersion2.setItem(PLANNING_SETTINGS_STORAGE_KEY, JSON.stringify({ ...withoutOverviewMetrics, version: 2 }));
  const migrated = loadPlanningSettings(storageVersion2);
  assert.equal(migrated.version, 3);
  assert.equal(migrated.products[0].minimumTotalSpend, 12_345);
  assert.deepEqual(migrated.overviewMetrics, DEFAULT_PLANNING_SETTINGS.overviewMetrics);
});

test("provisional catalog defaults are valid and US-only for every controlled product", () => {
  const validation = validatePlanningSettings(DEFAULT_PLANNING_SETTINGS);
  assert.equal(validation.valid, true, validation.errors.join("\n"));
  assert.ok(DEFAULT_PLANNING_SETTINGS.products.every((product) => product.supportedGeographies.length === 1 && product.supportedGeographies[0] === "United States"));
  assert.ok(DEFAULT_PLANNING_SETTINGS.publishers.every((publisher) => publisher.tier >= 1 && publisher.tier <= 4));
  assert.ok(DEFAULT_PLANNING_SETTINGS.enhancements.every((enhancement) => enhancement.trigger && enhancement.formatType && enhancement.specificationNotes));
});

test("rejects gaps, overlaps, invalid caps, and misplaced open-ended tiers", () => {
  const gap = clonePlanningSettings(DEFAULT_PLANNING_SETTINGS);
  gap.budgetChannelTiers[1].minBudget = 5_001;
  assert.equal(validatePlanningSettings(gap).valid, false);

  const overlap = clonePlanningSettings(DEFAULT_PLANNING_SETTINGS);
  overlap.budgetChannelTiers[1].minBudget = 4_999;
  assert.equal(validatePlanningSettings(overlap).valid, false);

  const fractional = clonePlanningSettings(DEFAULT_PLANNING_SETTINGS);
  fractional.budgetChannelTiers[0].maxChannels = 1.5;
  assert.equal(validatePlanningSettings(fractional).valid, false);

  const openEnded = clonePlanningSettings(DEFAULT_PLANNING_SETTINGS);
  openEnded.budgetChannelTiers[0].maxBudgetExclusive = null;
  assert.equal(validatePlanningSettings(openEnded).valid, false);
});

test("half-open boundaries select the confirmed default caps", () => {
  const settings = clonePlanningSettings(DEFAULT_PLANNING_SETTINGS);
  const cases: Array<[number, number]> = [
    [4_999, 1],
    [5_000, 3],
    [10_000, 4],
    [25_000, 5],
    [50_000, 6],
    [100_000, 8],
    [500_000, 10],
  ];
  cases.forEach(([budget, cap]) => assert.equal(findBudgetChannelTier(budget, settings).maxChannels, cap));
});

test("normalizes only the portfolio-size budget and records unknown duration", () => {
  const known = normalizeCampaignBudget(120_000, 180);
  assert.equal(known.normalized30DayBudget, 20_000);
  assert.equal(known.workingMediaBudget, 120_000);
  assert.deepEqual(known.assumptions, []);

  const unknown = normalizeCampaignBudget(25_000, null);
  assert.equal(unknown.normalized30DayBudget, 25_000);
  assert.equal(unknown.campaignFlightDays, null);
  assert.equal(unknown.assumptions.length, 1);
});
