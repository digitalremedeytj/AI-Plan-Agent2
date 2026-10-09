import assert from "node:assert/strict";
import test from "node:test";
import { briefMediaTypeOptions, plannerPickAlerts } from "./briefMediaTypes";
import { buildCampaignFacts, buildMediaRecommendationPlan } from "./engine";
import { clonePlanningSettings, DEFAULT_PLANNING_SETTINGS } from "./settings";

const settings = () => clonePlanningSettings(DEFAULT_PLANNING_SETTINGS);
const PICKS = ["channel.ctv", "channel.display_retargeting"];

const briefFacts = (overrides: Record<string, unknown> = {}) => buildCampaignFacts({
  kpis: ["awareness", "reach", "conversion"],
  campaignFocus: "CTV-first digital media plan",
  audienceDescriptions: ["Streaming viewers who research online before buying"],
  workingMediaBudget: 250_000,
  campaignFlightDays: 30,
  geography: "United States",
  planningSettings: settings(),
  ...overrides,
});

test("the picker offers the sellable catalog, including CTV and retargeting", () => {
  const ids = briefMediaTypeOptions(settings()).map((option) => option.id);
  PICKS.forEach((id) => assert.ok(ids.includes(id), `${id} is pickable`));
  assert.ok(!ids.includes("channel.email"), "a non-live product is not offered");
});

test("use only these yields exactly the picked media types", () => {
  const facts = briefFacts({ requiredChannelIds: PICKS, requiredChannelsOnly: true });
  const plan = buildMediaRecommendationPlan(facts);
  assert.deepEqual(plan.channels.map((channel) => channel.channelId).sort(), [...PICKS].sort());
  assert.equal(plan.channels.reduce((sum, channel) => sum + channel.allocationDollars, 0), 250_000);
  // Expressed as exclusions so a later re-plan from manualExcludedChannelIds keeps it.
  assert.ok(facts.excludedChannelIds.includes("channel.display"));
  PICKS.forEach((id) => assert.ok(!facts.excludedChannelIds.includes(id)));
  assert.deepEqual(plannerPickAlerts(plan, PICKS), []);
});

test("re-planning from the saved exclusions keeps only the picked media types", () => {
  const first = briefFacts({ requiredChannelIds: PICKS, requiredChannelsOnly: true });
  const replan = buildMediaRecommendationPlan(briefFacts({
    requiredChannelIds: first.requiredChannelIds,
    excludedChannelIds: first.excludedChannelIds,
  }));
  assert.deepEqual(replan.channels.map((channel) => channel.channelId).sort(), [...PICKS].sort());
});

test("picks without only-these are kept and ScoutAI still adds media types automatically", () => {
  const facts = briefFacts({ requiredChannelIds: PICKS });
  assert.deepEqual(facts.excludedChannelIds, []);
  const plan = buildMediaRecommendationPlan(facts);
  const ids = plan.channels.map((channel) => channel.channelId);
  PICKS.forEach((id) => assert.ok(ids.includes(id), `${id} is in the plan`));
  assert.ok(ids.length > PICKS.length, "automatic additions remain when the toggle is off");
});

test("only-these without any picks changes nothing", () => {
  const facts = briefFacts({ requiredChannelsOnly: true });
  assert.deepEqual(facts.excludedChannelIds, []);
});

test("a picked set the budget cannot fund is flagged instead of silently planned below minimum", () => {
  const plan = buildMediaRecommendationPlan(briefFacts({
    workingMediaBudget: 3_000,
    requiredChannelIds: PICKS,
    requiredChannelsOnly: true,
  }));
  assert.deepEqual(plan.channels.map((channel) => channel.channelId).sort(), [...PICKS].sort());
  const alerts = plannerPickAlerts(plan, PICKS);
  assert.ok(alerts.length > 0);
  assert.ok(alerts.some((alert) => /minimum/.test(alert)));
});

test("an empty plan for the picks is reported, not passed off as a normal result", () => {
  const plan = buildMediaRecommendationPlan(briefFacts({ requiredChannelIds: PICKS, requiredChannelsOnly: true }));
  const alerts = plannerPickAlerts({ ...plan, channels: [] }, PICKS);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /No media plan could be built/);
});
