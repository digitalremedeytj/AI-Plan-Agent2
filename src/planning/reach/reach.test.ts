import assert from "node:assert/strict";
import test from "node:test";
import type { GeoTargeting } from "../../types";
import { CANONICAL_MEDIA_TAXONOMY } from "../../utils/mediaTaxonomy";
import { NATIONAL_TV_HOUSEHOLDS } from "../knowledge/stateHouseholds";
import { describeAudienceShare, resolveAudienceShare } from "./audienceShare";
import { estimateMonthlyReach } from "./reachModel";
import {
  DEFAULT_REACH_SETTINGS,
  REACH_MEDIA_TYPE_IDS,
  mergeReachSettings,
  validateReachSettings,
  type ReachSettings,
} from "./reachSettings";
import { resolveHouseholdUniverse } from "./universe";

const geo = (scope: GeoTargeting["scope"], ids: string[]): GeoTargeting => ({
  scope,
  entries: ids.map((id) => ({ id, name: id })),
  unresolved: [],
  inputMethod: "select",
});

const DC_DMA = resolveHouseholdUniverse(geo("dma", ["511"]));
const NATIONAL = resolveHouseholdUniverse(undefined);

function withRow(settings: ReachSettings, id: string, patch: object): ReachSettings {
  return { ...settings, mediaTypes: settings.mediaTypes.map((row) => (row.mediaTypeId === id ? { ...row, ...patch } : row)) };
}

// --- Universe ---

test("national or missing geography uses the national TV household total", () => {
  assert.equal(NATIONAL.households, NATIONAL_TV_HOUSEHOLDS);
  assert.equal(resolveHouseholdUniverse(geo("national", [])).households, NATIONAL_TV_HOUSEHOLDS);
  assert.equal(resolveHouseholdUniverse(geo("dma", [])).scope, "national", "an empty selection is national, not zero");
});

test("a single DMA is sized at that market's households", () => {
  assert.equal(DC_DMA.households, 2_476_680);
  assert.equal(DC_DMA.scope, "dma");
  assert.match(DC_DMA.label, /Washington.*DMA/);
});

test("several DMAs add up, and a duplicated entry is counted once", () => {
  const universe = resolveHouseholdUniverse(geo("dma", ["501", "511", "511"]));
  assert.equal(universe.households, 7_348_620 + 2_476_680);
  assert.equal(universe.label, "2 DMAs");
});

test("states add up from the state table, not from straddling DMAs", () => {
  const universe = resolveHouseholdUniverse(geo("state", ["NY", "NJ"]));
  assert.equal(universe.households, 7_857_000 + 3_007_000);
  assert.equal(resolveHouseholdUniverse(geo("state", ["DC"])).households, 2_672_000);
});

test("entries that cannot be sized are reported, and nothing sized falls back to national", () => {
  const partial = resolveHouseholdUniverse(geo("dma", ["511", "999"]));
  assert.equal(partial.households, 2_476_680);
  assert.deepEqual(partial.unresolved, ["999"]);
  const none = resolveHouseholdUniverse(geo("state", ["ZZ"]));
  assert.equal(none.households, NATIONAL_TV_HOUSEHOLDS);
  assert.deepEqual(none.unresolved, ["ZZ"]);
});

// --- Model ---

test("the Washington DC test plan cannot reach more households than the DMA holds", () => {
  // $1.5M over 365 days at about $15.90 CPM: the case that showed 17.3M HH before.
  const estimate = estimateMonthlyReach({
    channels: [{ mediaTypeId: "ctv", impressions: 94_360_087 }],
    universe: DC_DMA,
    flightDays: 365,
    settings: DEFAULT_REACH_SETTINGS,
  });
  assert.ok(estimate.monthlyReach < DC_DMA.households * 0.8);
  assert.ok(Math.abs(estimate.monthlyReach - 1_333_822) < 1_000, `got ${estimate.monthlyReach}`);
  assert.ok(Math.abs(estimate.monthlyFrequency - 5.81) < 0.01, `got ${estimate.monthlyFrequency}`);
});

test("reach never falls as impressions grow and never passes the media type's ceiling", () => {
  let previous = 0;
  for (const impressions of [1e5, 1e6, 1e7, 1e8, 1e9, 1e11]) {
    const { monthlyReach } = estimateMonthlyReach({ channels: [{ mediaTypeId: "ctv", impressions }], universe: DC_DMA, flightDays: 30, settings: DEFAULT_REACH_SETTINGS });
    assert.ok(monthlyReach >= previous, `reach fell at ${impressions}`);
    assert.ok(monthlyReach <= DC_DMA.households * 0.8 + 1);
    previous = monthlyReach;
  }
});

test("at low volume reach is close to impressions divided by the duplication factor", () => {
  const { monthlyReach, monthlyFrequency } = estimateMonthlyReach({ channels: [{ mediaTypeId: "ctv", impressions: 100_000 }], universe: NATIONAL, flightDays: 30, settings: DEFAULT_REACH_SETTINGS });
  assert.ok(Math.abs(monthlyReach - 100_000 / 3.5) / (100_000 / 3.5) < 0.001);
  assert.ok(Math.abs(monthlyFrequency - 3.5) < 0.01);
});

test("combined reach is at least the best single media type and at most the universe", () => {
  const estimate = estimateMonthlyReach({
    channels: [
      { mediaTypeId: "ctv", impressions: 40_000_000 },
      { mediaTypeId: "digital_audio", impressions: 20_000_000 },
      { mediaTypeId: "programmatic_display", impressions: 60_000_000 },
    ],
    universe: DC_DMA,
    flightDays: 30,
    settings: DEFAULT_REACH_SETTINGS,
  });
  const best = Math.max(...estimate.channels.map((channel) => channel.monthlyReach));
  assert.ok(estimate.monthlyReach >= best);
  assert.ok(estimate.monthlyReach <= DC_DMA.households);
});

test("two placements of one media type are pooled rather than treated as separate audiences", () => {
  const split = estimateMonthlyReach({ channels: [{ mediaTypeId: "ctv", impressions: 5e6 }, { mediaTypeId: "ctv", impressions: 5e6 }], universe: DC_DMA, flightDays: 30, settings: DEFAULT_REACH_SETTINGS });
  const pooled = estimateMonthlyReach({ channels: [{ mediaTypeId: "ctv", impressions: 1e7 }], universe: DC_DMA, flightDays: 30, settings: DEFAULT_REACH_SETTINGS });
  assert.equal(split.channels.length, 1);
  assert.equal(split.monthlyReach, pooled.monthlyReach);
});

test("media types that do not count toward reach add neither reach nor frequency", () => {
  const withSearch = estimateMonthlyReach({
    channels: [{ mediaTypeId: "ctv", impressions: 1e7 }, { mediaTypeId: "google_search", impressions: 5e7 }, { mediaTypeId: "ad_serving", impressions: 1e7 }],
    universe: DC_DMA, flightDays: 30, settings: DEFAULT_REACH_SETTINGS,
  });
  const ctvOnly = estimateMonthlyReach({ channels: [{ mediaTypeId: "ctv", impressions: 1e7 }], universe: DC_DMA, flightDays: 30, settings: DEFAULT_REACH_SETTINGS });
  assert.equal(withSearch.monthlyReach, ctvOnly.monthlyReach);
  assert.equal(withSearch.monthlyFrequency, ctvOnly.monthlyFrequency);
  const search = withSearch.channels.find((channel) => channel.mediaTypeId === "google_search");
  assert.equal(search?.included, false);
  assert.ok(search?.excludedReason);
});

test("people-based media is converted to households when a planner turns it on", () => {
  const settings = withRow(DEFAULT_REACH_SETTINGS, "digital_out_of_home", { countsTowardReach: true });
  const estimate = estimateMonthlyReach({ channels: [{ mediaTypeId: "digital_out_of_home", impressions: 2_500_000 }], universe: DC_DMA, flightDays: 30, settings });
  assert.equal(estimate.channels[0].monthlyImpressions, 1_000_000);
  assert.ok(estimate.monthlyReach > 0);
});

test("a media type is left out when the geography is below its minimum targetable size", () => {
  const settings = withRow(DEFAULT_REACH_SETTINGS, "linear_tv", { minimumTargetableHouseholds: 5_000_000 });
  const estimate = estimateMonthlyReach({ channels: [{ mediaTypeId: "linear_tv", impressions: 1e7 }], universe: DC_DMA, flightDays: 30, settings });
  assert.equal(estimate.monthlyReach, 0);
  assert.match(estimate.channels[0].excludedReason || "", /Not targetable/);
});

test("flights of a month or less are not scaled; longer flights are reduced to a month", () => {
  const run = (flightDays: number | null) =>
    estimateMonthlyReach({ channels: [{ mediaTypeId: "ctv", impressions: 3_000_000 }], universe: NATIONAL, flightDays, settings: DEFAULT_REACH_SETTINGS });
  assert.equal(run(14).monthlyImpressions, 3_000_000);
  assert.equal(run(30).monthlyImpressions, 3_000_000);
  assert.equal(run(90).monthlyImpressions, 1_000_000);
  const unknown = run(null);
  assert.equal(unknown.monthlyImpressions, 3_000_000);
  assert.match(unknown.assumptions.join(" "), /Flight length unknown/);
});

test("frequency is flagged against the planner's target band", () => {
  const low = estimateMonthlyReach({ channels: [{ mediaTypeId: "ctv", impressions: 1e5 }], universe: NATIONAL, flightDays: 30, settings: DEFAULT_REACH_SETTINGS });
  assert.equal(low.frequencyBand.withinBand, true, "3.5 sits inside the default 3-8 band");
  const saturated = estimateMonthlyReach({ channels: [{ mediaTypeId: "ctv", impressions: 1e8 }], universe: DC_DMA, flightDays: 30, settings: DEFAULT_REACH_SETTINGS });
  assert.equal(saturated.frequencyBand.withinBand, false);
});

// --- Settings ---

test("reach settings carry a row for every media type in the taxonomy, plus unmapped", () => {
  assert.equal(REACH_MEDIA_TYPE_IDS.length, CANONICAL_MEDIA_TAXONOMY.length + 1);
  assert.deepEqual(DEFAULT_REACH_SETTINGS.mediaTypes.map((row) => row.mediaTypeId), REACH_MEDIA_TYPE_IDS);
  const errors: string[] = [];
  validateReachSettings(DEFAULT_REACH_SETTINGS, errors);
  assert.deepEqual(errors, []);
});

test("merging keeps planner edits and backfills rows a stored record lacks", () => {
  const merged = mergeReachSettings({ mediaTypes: [{ mediaTypeId: "ctv", maxReachPercent: 70, label: "Old label" }], targetMonthlyFrequencyMax: 10 });
  const ctv = merged.mediaTypes.find((row) => row.mediaTypeId === "ctv");
  assert.equal(ctv?.maxReachPercent, 70);
  assert.equal(ctv?.duplicationFactor, 3.5);
  assert.equal(ctv?.label, "CTV / OTT", "labels come from the taxonomy");
  assert.equal(merged.mediaTypes.length, REACH_MEDIA_TYPE_IDS.length);
  assert.equal(merged.targetMonthlyFrequencyMax, 10);
  assert.equal(merged.targetMonthlyFrequencyMin, 3);
});

test("out-of-range reach assumptions are rejected with a readable message", () => {
  const errors: string[] = [];
  validateReachSettings(withRow(DEFAULT_REACH_SETTINGS, "ctv", { maxReachPercent: 120, duplicationFactor: 0.5 }), errors);
  assert.ok(errors.some((error) => /CTV \/ OTT: max reachable %/.test(error)));
  assert.ok(errors.some((error) => /CTV \/ OTT: duplication factor/.test(error)));
  const bandErrors: string[] = [];
  validateReachSettings({ ...DEFAULT_REACH_SETTINGS, targetMonthlyFrequencyMin: 9, targetMonthlyFrequencyMax: 4 }, bandErrors);
  assert.ok(bandErrors.some((error) => /maximum must be at least the minimum/.test(error)));
});


// --- Audience narrowing (Phase 2) ---

test("a planner's own percentage wins over any filters", () => {
  const share = resolveAudienceShare({ filterIds: ["hhi-150k-plus"], overridePercent: 12 }, DEFAULT_REACH_SETTINGS);
  assert.equal(share.method, "override");
  assert.equal(share.sharePercent, 12);
});

test("filters in one category add up and categories multiply", () => {
  const share = resolveAudienceShare({ filterIds: ["hhi-100-150k", "hhi-150k-plus", "kids-yes"], overridePercent: null }, DEFAULT_REACH_SETTINGS);
  assert.equal(share.method, "filters");
  assert.ok(Math.abs(share.sharePercent - 37 * 0.27) < 1e-9, `got ${share.sharePercent}`);
  assert.equal(share.groups.length, 2);
  assert.match(describeAudienceShare(share), /\$100K–\$150K or \$150K\+ × Children under 18 at home/);
});

test("stacked filters are raised to the minimum share instead of shrinking to nothing", () => {
  const share = resolveAudienceShare({ filterIds: ["hhi-150k-plus", "age-under-35", "kids-yes", "home-renter"], overridePercent: null }, DEFAULT_REACH_SETTINGS);
  assert.equal(share.sharePercent, 2);
  assert.ok(share.flooredFrom !== null && share.flooredFrom < 2);
});

test("no narrowing, or only filters Settings no longer has, measures the whole geography", () => {
  assert.equal(resolveAudienceShare(undefined, DEFAULT_REACH_SETTINGS).sharePercent, 100);
  const stale = resolveAudienceShare({ filterIds: ["retired-filter"], overridePercent: null }, DEFAULT_REACH_SETTINGS);
  assert.equal(stale.method, "none");
  assert.deepEqual(stale.unknownFilterIds, ["retired-filter"]);
});

test("narrowing the audience lowers reach and raises frequency for targeted media", () => {
  const run = (overridePercent: number | null) => estimateMonthlyReach({
    channels: [{ mediaTypeId: "ctv", impressions: 8e6 }],
    universe: DC_DMA,
    flightDays: 30,
    settings: DEFAULT_REACH_SETTINGS,
    audience: resolveAudienceShare({ filterIds: [], overridePercent }, DEFAULT_REACH_SETTINGS),
  });
  const whole = run(null);
  const narrow = run(25);
  assert.ok(narrow.monthlyReach < whole.monthlyReach);
  assert.ok(narrow.monthlyFrequency > whole.monthlyFrequency);
  assert.ok(narrow.monthlyReach <= narrow.targetHouseholds * 0.8 + 1, "targeted reach stays inside the target ceiling");
  assert.equal(narrow.targetHouseholds, DC_DMA.households * 0.25);
});

test("media types that cannot target an audience still reach across the whole geography", () => {
  const audience = resolveAudienceShare({ filterIds: [], overridePercent: 10 }, DEFAULT_REACH_SETTINGS);
  const estimate = estimateMonthlyReach({
    channels: [{ mediaTypeId: "linear_tv", impressions: 2e7 }, { mediaTypeId: "ctv", impressions: 2e7 }],
    universe: DC_DMA, flightDays: 30, settings: DEFAULT_REACH_SETTINGS, audience,
  });
  const linear = estimate.channels.find((channel) => channel.mediaTypeId === "linear_tv");
  const ctv = estimate.channels.find((channel) => channel.mediaTypeId === "ctv");
  assert.equal(linear?.audienceTargeted, false);
  assert.equal(ctv?.audienceTargeted, true);
  assert.ok((linear?.monthlyReach || 0) > estimate.targetHouseholds, "linear is not capped by the target");
  assert.ok(estimate.monthlyReach <= DC_DMA.households);
  assert.ok(estimate.monthlyReach >= Math.max(linear?.monthlyReach || 0, ctv?.monthlyReach || 0));
});

test("an audience share of 100% gives exactly the geography-only result", () => {
  const channels = [{ mediaTypeId: "ctv" as const, impressions: 3e7 }, { mediaTypeId: "digital_audio" as const, impressions: 1e7 }];
  const plain = estimateMonthlyReach({ channels, universe: DC_DMA, flightDays: 30, settings: DEFAULT_REACH_SETTINGS });
  const full = estimateMonthlyReach({ channels, universe: DC_DMA, flightDays: 30, settings: DEFAULT_REACH_SETTINGS, audience: resolveAudienceShare({ filterIds: [], overridePercent: 100 }, DEFAULT_REACH_SETTINGS) });
  assert.equal(full.monthlyReach, plain.monthlyReach);
});

test("audience share rows are validated and a stored list is kept as the planner left it", () => {
  const errors: string[] = [];
  validateReachSettings({ ...DEFAULT_REACH_SETTINGS, audienceShareReference: [{ id: "x", category: "", label: "Bad", sharePercent: 0, source: "" }], minimumAudienceSharePercent: 0 }, errors);
  assert.ok(errors.some((error) => /category is required/.test(error)));
  assert.ok(errors.some((error) => /share must be above 0%/.test(error)));
  assert.ok(errors.some((error) => /Minimum audience share/.test(error)));
  const merged = mergeReachSettings({ audienceShareReference: [{ id: "pets", category: "Pets", label: "Pets", sharePercent: 55, source: "x" }] });
  assert.equal(merged.audienceShareReference.length, 1, "deleted reference rows are not re-added");
  assert.equal(mergeReachSettings({}).audienceShareReference.length, DEFAULT_REACH_SETTINGS.audienceShareReference.length);
  assert.equal(merged.mediaTypes.find((row) => row.mediaTypeId === "linear_tv")?.appliesAudienceTargeting, false);
});
