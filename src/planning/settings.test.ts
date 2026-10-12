import assert from "node:assert/strict";
import test from "node:test";
import {
  clonePlanningSettings,
  DEFAULT_PLANNING_SETTINGS,
  findBudgetChannelTier,
  loadPlanningSettings,
  normalizeCampaignBudget,
  migrateStoredSettings,
  PLANNING_SETTINGS_STORAGE_KEY,
  PLANNING_SETTINGS_VERSION,
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
  assert.equal(migrated.version, PLANNING_SETTINGS_VERSION);
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
  assert.equal(migrated.version, PLANNING_SETTINGS_VERSION);
  assert.equal(migrated.products[0].minimumTotalSpend, 12_345);
  assert.deepEqual(migrated.overviewMetrics, DEFAULT_PLANNING_SETTINGS.overviewMetrics);
});

test("internal-only defaults hide dollars, confidence, assumptions, and qa audit but keep allocation and score", () => {
  const visibility = Object.fromEntries(DEFAULT_PLANNING_SETTINGS.internalOnly.map((setting) => [setting.id, setting.show]));
  assert.deepEqual(visibility, {
    channelAllocationColumn: true,
    channelDollarsColumn: false,
    channelScoreColumn: true,
    channelConfidenceBadge: false,
    channelStatusTag: false,
    planningAssumptions: false,
    qaAudit: false,
    reachCalculationDetails: true,
  });
});

test("version 3 settings keep their catalog edits instead of being reseeded from defaults", () => {
  const storage = new MemoryStorage();
  const current = clonePlanningSettings(DEFAULT_PLANNING_SETTINGS);
  current.products[0].minimumTotalSpend = 54_321;
  current.overviewMetrics[1].show = true;
  const { internalOnly: _internalOnly, ...withoutInternalOnly } = current;
  storage.setItem(PLANNING_SETTINGS_STORAGE_KEY, JSON.stringify({ ...withoutInternalOnly, version: 3 }));
  const migrated = loadPlanningSettings(storage);
  assert.equal(migrated.version, PLANNING_SETTINGS_VERSION);
  assert.equal(migrated.products[0].minimumTotalSpend, 54_321);
  assert.equal(migrated.overviewMetrics[1].show, true);
  assert.deepEqual(migrated.internalOnly, DEFAULT_PLANNING_SETTINGS.internalOnly);
});

test("version 4 settings gain the enabled switch already on, so no product silently disappears", () => {
  const storage = new MemoryStorage();
  const current = clonePlanningSettings(DEFAULT_PLANNING_SETTINGS);
  current.products[0].minimumTotalSpend = 11_111;
  const stripped = {
    ...current,
    version: 4,
    products: current.products.map(({ enabled: _enabled, ...product }) => product),
  };
  delete (stripped as Record<string, unknown>).customProducts;
  storage.setItem(PLANNING_SETTINGS_STORAGE_KEY, JSON.stringify(stripped));

  const migrated = loadPlanningSettings(storage);
  assert.equal(migrated.version, PLANNING_SETTINGS_VERSION);
  assert.equal(migrated.products[0].minimumTotalSpend, 11_111);
  assert.ok(migrated.products.every((product) => product.enabled), "every pre-existing product stays in play");
  assert.deepEqual(migrated.customProducts, []);
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

test("migrating and cloning backfills missing internalOnly and overviewMetrics toggles so Target CTV Publishers Count saves cleanly", () => {
  // Simulate saved settings where internalOnly was omitted or missing some toggles
  const legacy: any = {
    ...DEFAULT_PLANNING_SETTINGS,
    ctvPublisherTargetCount: 12,
  };
  delete legacy.internalOnly;
  delete legacy.overviewMetrics;

  const cloned = clonePlanningSettings(legacy);
  assert.equal(cloned.ctvPublisherTargetCount, 12);
  assert.equal(cloned.internalOnly.length, 8);
  assert.equal(cloned.overviewMetrics.length, 7);

  const validation = validatePlanningSettings(cloned);
  assert.equal(validation.valid, true, validation.errors.join("; "));
  assert.equal(validation.settings?.ctvPublisherTargetCount, 12);
});

test("partial internalOnly settings are cleanly merged with defaults without duplicates", () => {
  const partial: any = {
    ...DEFAULT_PLANNING_SETTINGS,
    internalOnly: [
      { id: "channelAllocationColumn", label: "Allocation", show: false },
    ],
  };
  const cloned = clonePlanningSettings(partial);
  assert.equal(cloned.internalOnly.length, 8);
  const allocToggle = cloned.internalOnly.find((s) => s.id === "channelAllocationColumn");
  assert.equal(allocToggle?.show, false);
  const dollarsToggle = cloned.internalOnly.find((s) => s.id === "channelDollarsColumn");
  assert.equal(dollarsToggle?.show, false);

  const validation = validatePlanningSettings(cloned);
  assert.equal(validation.valid, true);
});

test("version 5 settings keep their edits and gain the reach defaults Media Planning signed off on", () => {
  const { reach: _reach, ...withoutReach } = clonePlanningSettings(DEFAULT_PLANNING_SETTINGS);
  const stored = { ...withoutReach, version: 5, ctvPublisherTargetCount: 12 };
  const result = validatePlanningSettings(migrateStoredSettings(stored));
  assert.equal(result.valid, true, result.errors.join("; "));
  assert.equal(result.settings?.version, PLANNING_SETTINGS_VERSION);
  assert.equal(result.settings?.ctvPublisherTargetCount, 12);
  assert.deepEqual(result.settings?.reach, DEFAULT_PLANNING_SETTINGS.reach);
});

test("a planner's reach edits survive save and reload", () => {
  const storage = new MemoryStorage();
  const settings = clonePlanningSettings(DEFAULT_PLANNING_SETTINGS);
  settings.reach.mediaTypes = settings.reach.mediaTypes.map((row) => (row.mediaTypeId === "ctv" ? { ...row, maxReachPercent: 72 } : row));
  settings.reach.targetMonthlyFrequencyMax = 10;
  assert.equal(savePlanningSettings(storage, settings).valid, true);
  const loaded = loadPlanningSettings(storage);
  assert.equal(loaded.reach.mediaTypes.find((row) => row.mediaTypeId === "ctv")?.maxReachPercent, 72);
  assert.equal(loaded.reach.targetMonthlyFrequencyMax, 10);
});

test("invalid reach assumptions block a save instead of reaching every plan", () => {
  const settings = clonePlanningSettings(DEFAULT_PLANNING_SETTINGS);
  settings.reach.mediaTypes = settings.reach.mediaTypes.map((row) => (row.mediaTypeId === "ctv" ? { ...row, maxReachPercent: 140 } : row));
  const result = validatePlanningSettings(settings);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /CTV \/ OTT: max reachable %/.test(error)));
});

test("stored overview metrics pick up renamed labels, keeping their show choice", () => {
  const stored: any = clonePlanningSettings(DEFAULT_PLANNING_SETTINGS);
  stored.version = 5;
  stored.overviewMetrics = stored.overviewMetrics.map((metric: any) =>
    metric.id === "estimatedReach" ? { ...metric, label: "Estimated Reach", show: false } : metric);
  const migrated = migrateStoredSettings(stored) as any;
  const reach = migrated.overviewMetrics.find((metric: any) => metric.id === "estimatedReach");
  assert.equal(reach.label, "Estimated Reach");
  assert.equal(reach.show, false);
});
