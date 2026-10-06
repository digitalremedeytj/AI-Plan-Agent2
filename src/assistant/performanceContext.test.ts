import assert from "node:assert/strict";
import test from "node:test";
import { buildCampaignFacts, buildMediaRecommendationPlan } from "../planning/engine";
import { clonePlanningSettings, DEFAULT_PLANNING_SETTINGS } from "../planning/settings";
import { platformReports } from "../performance/__fixtures__/load";
import { analyzeReportFiles } from "../performance/index";
import { buildPerformanceContext, canSummarize, matchChannel, matchPublisher, PERFORMANCE_CONTEXT_CHARS, wantsFullData } from "./performanceContext";
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

test("a plan's live campaign comes first, compared with the plan, ahead of past campaigns", () => {
  const p = plan();
  const live = { ...linked()[0], campaign: { ...linked()[0].campaign, id: "live", name: "Live flight", kind: "live" as const, flightStart: "2026-02-09", flightEnd: "2026-03-30", snapshots: [] } };
  const text = buildPerformanceContext([linked()[0], live], { planAdvertiser: "Acme Auto Accessories", plan: p, planPublishers: ["Hulu"], catalog, kpis: ["CPA under $30"] });
  assert.ok(text.startsWith("THIS PLAN'S LIVE CAMPAIGN: Live flight"));
  assert.match(text, /LIVE CAMPAIGN vs PLAN \(as of 2026-03-10; flight 2026-02-09 to 2026-03-30, 50 days\)/);
  assert.match(text, /Target: CPA \$30\.00/);
  assert.ok(text.indexOf("PAST CAMPAIGN PERFORMANCE") > text.indexOf("LIVE CAMPAIGN vs PLAN"));
});

const reviewed = (stale = false) => linked().map((l) => ({
  ...l,
  review: { generatedAt: "", generatedBy: "", fingerprint: "fp", summary: "Strong quarter on cost per checkout.", findings: [] },
  reviewStale: stale,
}));

test("analysis reads the summary only when every past campaign has a current review", () => {
  assert.equal(canSummarize(reviewed()), true);
  assert.equal(canSummarize(reviewed(true)), false, "an out-of-date review is not a basis for the summary");
  assert.equal(canSummarize(linked() as any), false, "no review: the full rows are the only analysis");
});

test("questions about cuts the summary trims, or that ask for everything, go straight to the full rows", () => {
  const l = reviewed();
  assert.equal(wantsFullData("Analyse our past campaign: what worked, what didn't, and what should this plan change?", l), false);
  assert.equal(wantsFullData("Which publishers did best?", l), true);
  assert.equal(wantsFullData("How did checkouts trend week by week?", l), true);
  assert.equal(wantsFullData("Dig deeper using the full campaign data.", l), true);
  assert.equal(wantsFullData("How did Pluto TV do?", l), true, "a row named in the question");
});

test("the summary is much shorter than the full section and says the full rows exist", () => {
  const args = { planAdvertiser: "Acme Auto Accessories", plan: plan(), planPublishers: ["Hulu"], catalog };
  const summary = buildPerformanceContext(reviewed(), { ...args, depth: "summary" });
  const full = buildPerformanceContext(reviewed(), { ...args, depth: "full" });
  assert.match(summary, /SUMMARY: totals, data notes and the largest rows/);
  assert.doesNotMatch(full, /SUMMARY:/);
  assert.ok(summary.length < full.length * 0.7, `${summary.length} vs ${full.length}`);
  assert.match(summary, /HOW THE REPORT MAPS TO THIS PLAN/, "the mapping that turns findings into plan changes stays");
});

test("the model can ask for the full rows instead of guessing", () => {
  assert.equal(normalizeScoutResponse({ reply: "x", needsFullData: "publisher rows for ESPN" }).needsFullData, "publisher rows for ESPN");
  assert.equal(normalizeScoutResponse({ reply: "x" }).needsFullData, null);
});
