import assert from "node:assert/strict";
import test from "node:test";
import { buildCampaignFacts, buildMediaRecommendationPlan } from "../planning/engine";
import { clonePlanningSettings, DEFAULT_PLANNING_SETTINGS } from "../planning/settings";
import { platformReports } from "../performance/__fixtures__/load";
import { analyzeReportFiles } from "../performance/index";
import { buildPerformanceContext, matchChannel, matchPublisher, PERFORMANCE_CONTEXT_CHARS } from "./performanceContext";
import { normalizeScoutResponse } from "./scoutChat";

const plan = () => buildMediaRecommendationPlan(buildCampaignFacts({
  kpis: ["conversions", "cpa"],
  audienceDescriptions: ["Truck and SUV owners"],
  workingMediaBudget: 250_000,
  campaignFlightDays: 30,
  geography: "United States",
  creativeReadiness: { ctvVideoAssets: true, onlineVideoAssets: true, displayAssets: true },
  planningSettings: clonePlanningSettings(DEFAULT_PLANNING_SETTINGS),
}));

const channels = () => plan().evaluatedCandidates.map((c: any) => ({ id: c.product.id, name: c.product.displayName, aliases: c.product.aliases || [] }));
const linked = (advertiserName = "Acme Auto Accessories", campaignGoal: string | null = "cpa") => [{
  campaign: { id: "c1", name: "Feb 9 to Mar 10", advertiserName, campaignGoal, flightEnd: "2026-03-10" },
  analysis: analyzeReportFiles(platformReports()),
  review: null,
  reviewStale: false,
}];
const catalog = [
  { name: "Hulu", category: "SVOD", enabled: true },
  { name: "Pluto", category: "FAST", enabled: true },
  { name: "Paramount+", category: "SVOD", enabled: true },
  { name: "Retired App", category: "FAST", enabled: false },
];

test("the platform's media type names map onto the catalog's media types", () => {
  const list = channels();
  assert.equal(matchChannel("OTT", list)?.id, "channel.ctv");
  assert.equal(matchChannel("Pre-Roll/Mid-Roll", list)?.id, "channel.olv");
  assert.equal(matchChannel("Display", list)?.id, "channel.display");
  assert.equal(matchChannel("Display Retargeting", list)?.id, "channel.display_retargeting", "retargeting is not plain display");
  assert.equal(matchChannel("Carrier pigeon", list), null);
});

test("report publisher names match the catalog's shorter names", () => {
  const names = catalog.map((c) => c.name);
  assert.deepEqual(matchPublisher("Pluto TV", names), { name: "Pluto", approximate: true });
  assert.deepEqual(matchPublisher("Paramount", names), { name: "Paramount+", approximate: true });
  assert.deepEqual(matchPublisher("hulu", names), { name: "Hulu", approximate: false });
  assert.equal(matchPublisher("Discovery+", ["Discovery", "Discovery+"])?.name, "Discovery+");
  assert.deepEqual(matchPublisher("Discovery", ["Discovery", "Discovery+"]), { name: "Discovery", approximate: false });
  assert.equal(matchPublisher("NCAA Basketball", names), null);
});

test("the section says which report rows are in the plan, can be added, or cannot", () => {
  const p = plan();
  const text = buildPerformanceContext(linked(), { planAdvertiser: "Acme Auto Accessories", plan: p, planPublishers: ["Hulu"], catalog });
  assert.match(text, /OTT -> CTV \/ OTT \(channelId: channel\.ctv\)/);
  assert.match(text, /Hulu = Hulu \(in this plan\)/);
  assert.match(text, /Pluto TV probably Pluto \(can be added\)/, "a name-prefix match is marked as approximate");
  assert.match(text, /NCAA Basketball \(not in the catalog; cannot be added\)/);
  assert.doesNotMatch(text, /Display Retargeting = /, "media type rows in the publisher report are not offered as publishers");
});

test("a campaign is the client's own only when the plan, campaign and files all name the same advertiser", () => {
  const args = { plan: plan(), planPublishers: [], catalog };
  assert.match(buildPerformanceContext(linked(), { ...args, planAdvertiser: "acme auto accessories " }), /This is the client's own past campaign/);
  assert.match(buildPerformanceContext(linked(), { ...args, planAdvertiser: "Other Brand" }), /NOT this client's campaign/);
  // The planner filed another brand's reports under this advertiser: the files still say whose they are.
  const mislabelled = linked("Other Brand");
  assert.match(buildPerformanceContext(mislabelled, { ...args, planAdvertiser: "Other Brand" }), /NOT this client's campaign \(Acme Auto Accessories\)/);
});

test("the campaign goal is stated, and a missing one is called out", () => {
  const args = { planAdvertiser: "Acme Auto Accessories", plan: plan(), planPublishers: [], catalog };
  assert.match(buildPerformanceContext(linked(), args), /It optimised for: Cost per conversion \(CPA\)/);
  assert.match(buildPerformanceContext(linked(undefined, null), args), /not stated/);
});

test("several campaigns stay inside the section's length, newest first", () => {
  const many = [1, 2, 3, 4].map((n) => ({ ...linked()[0], campaign: { ...linked()[0].campaign, name: `Flight ${n}`, flightEnd: `2026-0${n}-01` } }));
  const text = buildPerformanceContext(many, { planAdvertiser: "Acme Auto Accessories", plan: plan(), planPublishers: [], catalog });
  assert.ok(text.length <= PERFORMANCE_CONTEXT_CHARS);
  assert.ok(text.indexOf("Flight 4") < text.indexOf("Flight 3"));
  assert.doesNotMatch(text, /=== Flight 1/);
  assert.match(text, /oldest left out/);
});

test("no linked campaigns adds nothing to the prompt", () => {
  assert.equal(buildPerformanceContext([], { planAdvertiser: "A", planPublishers: [], catalog }), "");
});

test("an item's past-performance evidence is kept, and an item without it has none", () => {
  const response = normalizeScoutResponse({
    reply: "ok",
    proposal: { summary: "s", items: [
      { title: "A", why: "w", evidence: "OTT PM 0.44 last-touch; medium confidence", ops: [{ type: "lock_channel", channelId: "channel.ctv" }] },
      { title: "B", why: "w", ops: [{ type: "lock_channel", channelId: "channel.olv" }] },
    ] },
  });
  assert.equal(response.items[0].evidence, "OTT PM 0.44 last-touch; medium confidence");
  assert.equal(response.items[1].evidence, null);
});
