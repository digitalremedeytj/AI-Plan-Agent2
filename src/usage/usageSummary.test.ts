import assert from "node:assert/strict";
import test from "node:test";
import { SHARE_VIEWER_ACTOR, type UsageEvent } from "../storage/types";
import { isClientUsageAction, summarizeUsage } from "./usageSummary";

let seq = 0;
const ev = (at: string, actor: string, action: string, extra: Partial<UsageEvent> = {}): UsageEvent => ({ id: String(++seq), at, actor, action, ...extra });

const SINCE = "2026-10-01T00:00:00.000Z";
const UNTIL = "2026-10-31T23:59:59.999Z";

test("one person who types their name differently is counted once, under their latest spelling", () => {
  const summary = summarizeUsage([
    ev("2026-10-05T10:00:00.000Z", "tj", "login"),
    ev("2026-10-06T10:00:00.000Z", "TJ ", "plan_generate", { ok: true }),
    ev("2026-10-07T10:00:00.000Z", "TJ", "export"),
  ], SINCE, UNTIL);

  assert.equal(summary.activePeople, 1);
  assert.equal(summary.people[0].name, "TJ");
  assert.equal(summary.people[0].activeDays, 3);
  assert.equal(summary.people[0].generated, 1);
  assert.equal(summary.people[0].exports, 1);
});

test("failed runs are counted apart from generated plans and left out of the median run time", () => {
  const summary = summarizeUsage([
    ev("2026-10-05T10:00:00.000Z", "Ana", "plan_generate", { ok: true, durationMs: 6 * 60_000 }),
    ev("2026-10-05T11:00:00.000Z", "Ana", "plan_generate", { ok: true, durationMs: 10 * 60_000 }),
    ev("2026-10-05T12:00:00.000Z", "Ana", "plan_generate", { ok: false, durationMs: 15 * 60_000 }),
  ], SINCE, UNTIL);

  assert.equal(summary.generation.count, 3);
  assert.equal(summary.generation.failed, 1);
  assert.equal(summary.generation.medianMinutes, 8);
  assert.equal(summary.people[0].generated, 2);
  assert.equal(summary.people[0].failedGenerations, 1);
});

test("a client opening a share link counts toward the advertiser but is not an active person", () => {
  const summary = summarizeUsage([
    ev("2026-10-05T10:00:00.000Z", "Ana", "plan_generate", { ok: true, advertiserName: "Acme" }),
    ev("2026-10-06T10:00:00.000Z", SHARE_VIEWER_ACTOR, "share_view", { advertiserName: "acme" }),
  ], SINCE, UNTIL);

  assert.equal(summary.activePeople, 1);
  assert.deepEqual(summary.advertisers, [{ name: "Acme", generated: 1, shareViews: 1, people: ["Ana"] }]);
  assert.equal(summary.weeks.reduce((n, w) => n + w.shareViews, 0), 1);
});

test("weeks start on Monday so a Sunday and the following Monday land in different weeks", () => {
  const summary = summarizeUsage([
    ev("2026-10-11T10:00:00.000Z", "Ana", "plan_generate", { ok: true }), // Sunday
    ev("2026-10-12T10:00:00.000Z", "Ben", "plan_generate", { ok: true }), // Monday
  ], SINCE, UNTIL);

  assert.deepEqual(summary.weeks.map((w) => w.weekStart), ["2026-10-05", "2026-10-12"]);
});

test("events outside the requested window are ignored", () => {
  const summary = summarizeUsage([ev("2026-09-30T23:59:59.000Z", "Ana", "login")], SINCE, UNTIL);
  assert.equal(summary.activePeople, 0);
  assert.deepEqual(summary.totals, {});
});

test("the browser may only report the actions only it can see", () => {
  assert.equal(isClientUsageAction("export"), true);
  assert.equal(isClientUsageAction("plan_generate"), false);
  assert.equal(isClientUsageAction("anything_else"), false);
});
