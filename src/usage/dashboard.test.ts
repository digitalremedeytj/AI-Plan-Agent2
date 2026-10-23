import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_DASHBOARD_CONFIG, SHARE_VIEWER_ACTOR, type UsageEvent } from "../storage/types";
import { buildDashboard, planBudgetFields } from "./dashboard";

let seq = 0;
const ev = (at: string, actor: string, action: string, extra: Partial<UsageEvent> = {}): UsageEvent => ({ id: `e${++seq}`, at, actor, action, ...extra });
const gen = (at: string, actor: string, extra: Partial<UsageEvent> = {}) => ev(at, actor, "plan_generate", { ok: true, ...extra });

const FROM = "2026-10-01T00:00:00.000Z";
const TO = "2026-10-30T23:59:59.999Z";
const build = (events: UsageEvent[], config = DEFAULT_DASHBOARD_CONFIG) => buildDashboard(events, FROM, TO, config);

test("re-running the same brief within a day adds plans but not media budget", () => {
  const data = build([
    gen("2026-10-05T09:00:00.000Z", "Ana", { advertiserName: "Acme", budget: 100_000 }),
    gen("2026-10-05T11:00:00.000Z", "ana", { advertiserName: "acme", budget: 100_000 }),
    gen("2026-10-08T09:00:00.000Z", "Ana", { advertiserName: "Acme", budget: 100_000 }),
    gen("2026-10-08T10:00:00.000Z", "Ben", { advertiserName: "Acme", budget: 100_000 }),
  ]);
  assert.equal(data.kpis.plans.value, 4);
  assert.equal(data.kpis.budget.value, 300_000);
});

test("a brief re-run just after the period starts is not counted as new budget", () => {
  const data = build([
    gen("2026-09-30T20:00:00.000Z", "Ana", { advertiserName: "Acme", budget: 50_000 }),
    gen("2026-10-01T08:00:00.000Z", "Ana", { advertiserName: "Acme", budget: 50_000 }),
  ]);
  assert.equal(data.kpis.plans.value, 1);
  assert.equal(data.kpis.budget.value, 0);
  assert.equal(data.kpis.budget.previous, 50_000);
});

test("each KPI is compared with the period of the same length just before it", () => {
  const data = build([
    gen("2026-09-15T10:00:00.000Z", "Ana"),
    gen("2026-10-10T10:00:00.000Z", "Ana"),
    gen("2026-10-11T10:00:00.000Z", "Ben"),
  ]);
  assert.deepEqual(data.kpis.plans, { value: 2, previous: 1 });
  assert.deepEqual(data.kpis.activeUsers, { value: 2, previous: 1 });
});

test("the funnel follows the period's plans, and a planner previewing their own link is not a client view", () => {
  const data = build([
    gen("2026-10-02T10:00:00.000Z", "Ana", { planId: "p1" }),
    gen("2026-10-03T10:00:00.000Z", "Ana", { planId: "p2" }),
    gen("2026-10-04T10:00:00.000Z", "Ana", { planId: "p3" }),
    ev("2026-10-05T10:00:00.000Z", "Ana", "share_create", { planId: "p1" }),
    ev("2026-10-05T10:00:00.000Z", "Ana", "share_create", { planId: "p2" }),
    ev("2026-10-06T10:00:00.000Z", "Ana", "share_view", { planId: "p2", detail: "staff_preview" }),
    ev("2026-10-07T10:00:00.000Z", SHARE_VIEWER_ACTOR, "share_view", { planId: "p1", detail: "client" }),
    ev("2026-10-05T10:00:00.000Z", "Ana", "share_create", { planId: "old-plan" }),
  ]);
  assert.deepEqual(data.funnel, { generated: 3, shared: 2, viewed: 1 });
  assert.equal(data.kpis.shareViews.value, 1);
});

test("client views are credited to whoever created the share link", () => {
  const data = build([
    gen("2026-10-02T10:00:00.000Z", "Ana", { planId: "p1" }),
    ev("2026-10-03T10:00:00.000Z", "Ben", "share_create", { planId: "p1" }),
    ev("2026-10-04T10:00:00.000Z", SHARE_VIEWER_ACTOR, "share_view", { planId: "p1" }),
    ev("2026-10-05T10:00:00.000Z", SHARE_VIEWER_ACTOR, "share_view", { planId: "p1" }),
  ]);
  const ben = data.users.find((u) => u.name === "Ben");
  assert.equal(ben?.shareViews, 2);
  assert.equal(ben?.shareLinks, 1);
  assert.equal(data.users[0].name, "Ana", "the leaderboard is ordered by plans generated");
});

test("each shared plan a client opened is listed with its sharer and view count, most recently opened first", () => {
  const data = build([
    gen("2026-10-02T09:00:00.000Z", "Ana", { planId: "p1", advertiserName: "Acme" }),
    ev("2026-10-02T10:00:00.000Z", "Ana", "share_create", { planId: "p1" }),
    ev("2026-10-03T10:00:00.000Z", SHARE_VIEWER_ACTOR, "share_view", { planId: "p1", advertiserName: "Acme", detail: "client" }),
    ev("2026-10-04T10:00:00.000Z", "Ana", "share_view", { planId: "p1", advertiserName: "Acme", detail: "staff_preview" }),
    ev("2026-10-05T10:00:00.000Z", SHARE_VIEWER_ACTOR, "share_view", { planId: "p2", advertiserName: "Globex", detail: "client" }),
    ev("2026-10-06T10:00:00.000Z", SHARE_VIEWER_ACTOR, "share_view", { planId: "p1", advertiserName: "Acme", detail: "client" }),
  ]);
  assert.deepEqual(
    data.openedPlans.map((p) => [p.advertiserName, p.sharedBy, p.views, p.firstViewedAt.slice(0, 10), p.lastViewedAt.slice(0, 10)]),
    [
      ["Acme", "Ana", 2, "2026-10-03", "2026-10-06"],
      ["Globex", undefined, 1, "2026-10-05", "2026-10-05"],
    ],
  );
});

test("excluded test accounts are left out of every number", () => {
  const data = build([
    gen("2026-10-02T10:00:00.000Z", "Ana", { budget: 10_000 }),
    gen("2026-10-02T11:00:00.000Z", "QA Bot", { budget: 99_000 }),
  ], { hoursPerPlan: 1, excludedNames: ["qa bot"] });
  assert.equal(data.kpis.plans.value, 1);
  assert.equal(data.kpis.budget.value, 10_000);
  assert.equal(data.totalUsers, 1);
  assert.deepEqual(data.users.map((u) => u.name), ["Ana"]);
});

test("failed runs lower the success rate but are not plans", () => {
  const data = build([
    gen("2026-10-02T10:00:00.000Z", "Ana", { durationMs: 600_000 }),
    ev("2026-10-02T11:00:00.000Z", "Ana", "plan_generate", { ok: false, detail: "abandoned" }),
  ]);
  assert.equal(data.kpis.plans.value, 1);
  assert.equal(data.reliability.successRate, 0.5);
  assert.equal(data.reliability.medianMinutes, 10);
});

test("a 30-day range charts by day with no gaps; a longer one charts by week", () => {
  const daily = build([gen("2026-10-10T10:00:00.000Z", "Ana")]);
  assert.equal(daily.bucket, "day");
  assert.equal(daily.series.length, 30);
  assert.equal(daily.series.find((p) => p.start === "2026-10-10")?.plans, 1);
  const weekly = buildDashboard([], "2026-07-01T00:00:00.000Z", TO, DEFAULT_DASHBOARD_CONFIG);
  assert.equal(weekly.bucket, "week");
});

test("media budget by channel adds up the counted briefs' allocations", () => {
  const data = build([
    gen("2026-10-02T10:00:00.000Z", "Ana", { advertiserName: "A", budget: 100, channels: { "Connected TV": 60, Search: 40 } }),
    gen("2026-10-03T10:00:00.000Z", "Ben", { advertiserName: "B", budget: 50, channels: { "Connected TV": 50 } }),
  ]);
  assert.deepEqual(data.channels, [
    { name: "Connected TV", budget: 110, plans: 2 },
    { name: "Search", budget: 40, plans: 1 },
  ]);
});

test("a plan's budget and channel allocations are read from its media plan", () => {
  const fields = planBudgetFields({
    channelStrategy: { mediaPlan: { workingMediaBudget: 100000, channels: [
      { channelName: "Connected TV", allocationDollars: 60000.4 },
      { channelName: "Search", allocationDollars: 39999.6 },
      { channelName: "Unfunded", allocationDollars: 0 },
    ] } },
  });
  assert.deepEqual(fields, { budget: 100000, channels: { "Connected TV": 60000, Search: 40000 } });
  assert.deepEqual(planBudgetFields({}), {});
});

test("days are the viewer's days: a 9pm New York plan is charted on that date, not the next", () => {
  // Oct 1-2 in New York (UTC-4, offset +240), as the browser sends it.
  const data = buildDashboard([gen("2026-10-02T01:00:00.000Z", "Ana")], "2026-10-01T04:00:00.000Z", "2026-10-03T03:59:59.999Z", DEFAULT_DASHBOARD_CONFIG, { tzOffsetMinutes: 240 });
  assert.deepEqual(data.series.map((p) => [p.start, p.plans]), [["2026-10-01", 1], ["2026-10-02", 0]]);
});

test("filtering to people keeps their work and the client views of plans they shared", () => {
  const events = [
    gen("2026-10-02T10:00:00.000Z", "Ana", { planId: "a1", advertiserName: "Acme", budget: 100 }),
    gen("2026-10-02T11:00:00.000Z", "Ben", { planId: "b1", advertiserName: "Bolt", budget: 50 }),
    ev("2026-10-03T10:00:00.000Z", "Ana", "share_create", { planId: "a1" }),
    ev("2026-10-03T11:00:00.000Z", "Ben", "share_create", { planId: "b1" }),
    ev("2026-10-04T10:00:00.000Z", SHARE_VIEWER_ACTOR, "share_view", { planId: "a1" }),
    ev("2026-10-04T11:00:00.000Z", SHARE_VIEWER_ACTOR, "share_view", { planId: "b1" }),
    ev("2026-10-04T12:00:00.000Z", SHARE_VIEWER_ACTOR, "share_view", { planId: "b1" }),
  ];
  const data = buildDashboard(events, FROM, TO, DEFAULT_DASHBOARD_CONFIG, { users: ["ana"] });
  assert.equal(data.kpis.plans.value, 1);
  assert.equal(data.kpis.budget.value, 100);
  assert.equal(data.kpis.shareViews.value, 1);
  assert.deepEqual(data.users.map((u) => u.name), ["Ana"]);
  assert.deepEqual(data.funnel, { generated: 1, shared: 1, viewed: 1 });
  assert.deepEqual(data.allUsers, ["Ana", "Ben"], "the filter still offers everyone");
  assert.deepEqual(data.selectedUsers, ["Ana"]);
});

test("no selection means everyone", () => {
  const data = build([gen("2026-10-02T10:00:00.000Z", "Ana"), gen("2026-10-02T11:00:00.000Z", "Ben")]);
  assert.equal(data.kpis.plans.value, 2);
  assert.equal(data.selectedUsers, null);
});

test("exports gather downloads and AI slides, broken out by type with the most used first", () => {
  const data = build([
    ev("2026-10-02T10:00:00.000Z", "Ana", "export", { detail: "pdf" }),
    ev("2026-10-02T11:00:00.000Z", "Ben", "export", { detail: "pdf" }),
    ev("2026-10-03T10:00:00.000Z", "Ana", "export", { detail: "ctv_slide_basic" }),
    ev("2026-10-03T11:00:00.000Z", "Ana", "slide_generate", { detail: "personas" }),
    ev("2026-10-03T12:00:00.000Z", "Ana", "export", { detail: "some_new_format" }),
  ]);
  const exports = data.adoption.find((a) => a.label === "Exports")!;
  assert.equal(exports.uses, 5);
  assert.equal(exports.people, 2);
  const rows = exports.breakdown![0].rows;
  assert.deepEqual(rows[0], { label: "Plan PDF", uses: 2, people: 2 });
  assert.deepEqual(rows.map((b) => b.label).sort(), ["AI slide: personas", "CTV publisher slide (basic)", "Plan PDF", "some_new_format"]);
  assert.equal(data.adoption.some((a) => a.action === "slide_generate"), false, "AI slides are no longer a row of their own");
});

const scoutGroup = (data: ReturnType<typeof build>, title: string) =>
  data.adoption.find((a) => a.action === "scout_chat")!.breakdown!.find((g) => g.title === title)?.rows ?? [];

test("ScoutAI questions from before prompts were recorded still add up, as one earlier row", () => {
  const data = build([
    ev("2026-10-02T10:00:00.000Z", "Ana", "scout_chat", { ok: true }),
    ev("2026-10-03T10:00:00.000Z", "Ben", "scout_chat", { ok: true, detail: "plan-health-check", label: "Plan health check", kind: "plan", count: 0 }),
  ]);
  const byPrompt = scoutGroup(data, "By prompt");
  assert.equal(byPrompt.reduce((sum, r) => sum + (r.uses ?? 0), 0), data.adoption.find((a) => a.action === "scout_chat")!.uses);
  assert.ok(byPrompt.some((r) => r.label === "Earlier questions (not broken out)" && r.uses === 1));
});

test("a library prompt and a typed question are counted on separate rows, by the title asked under", () => {
  const data = build([
    ev("2026-10-02T10:00:00.000Z", "Ana", "scout_chat", { ok: true, detail: "plan-health-check", label: "Plan health check", kind: "plan", count: 1 }),
    ev("2026-10-02T11:00:00.000Z", "Ana", "scout_chat", { ok: true, detail: "plan-health-check", label: "Plan health check", kind: "plan", count: 0 }),
    ev("2026-10-02T12:00:00.000Z", "Ben", "scout_chat", { ok: true, detail: "typed", label: "Typed question", kind: "live", count: 0 }),
  ]);
  assert.deepEqual(scoutGroup(data, "By prompt"), [
    { label: "Plan health check", uses: 2, people: 1 },
    { label: "Typed question", uses: 1, people: 1 },
  ]);
  assert.deepEqual(scoutGroup(data, "By type").map((r) => r.label), ["Plan questions", "Live-campaign check"]);
});

test("the ScoutAI outcome separates failures, proposals, applies and undos, and leaves out failed saves", () => {
  const data = build([
    ev("2026-10-02T10:00:00.000Z", "Ana", "scout_chat", { ok: true, detail: "typed", kind: "plan", count: 2, durationMs: 30_000 }),
    ev("2026-10-02T10:05:00.000Z", "Ana", "scout_chat", { ok: true, detail: "typed", kind: "plan", count: 0, durationMs: 50_000 }),
    ev("2026-10-02T10:10:00.000Z", "Ana", "scout_chat", { ok: false, detail: "typed", kind: "plan", durationMs: 200_000 }),
    ev("2026-10-02T10:20:00.000Z", "Ana", "scout_apply", { ok: true, detail: "typed", kind: "applied", count: 2 }),
    ev("2026-10-02T10:21:00.000Z", "Ana", "scout_apply", { ok: false, detail: "typed", kind: "applied" }),
    ev("2026-10-02T10:30:00.000Z", "Ana", "scout_apply", { ok: true, detail: "typed", kind: "reverted", count: 2 }),
  ]);
  const outcome = Object.fromEntries(scoutGroup(data, "Outcome").map((r) => [r.label, r.uses]));
  assert.deepEqual(outcome, { "Answered": 2, "Failed or timed out": 1, "Answers proposing changes": 1, "Proposals applied": 1, "Applied changes undone": 1 });
  assert.deepEqual(scoutGroup(data, "Response time"), [{ label: "Median time to answer", text: "40 s" }], "failed answers do not count toward response time");
});
