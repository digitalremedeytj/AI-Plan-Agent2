import assert from "node:assert/strict";
import test from "node:test";
import { buildScoutLog, sanitizeConversationId, SCOUT_LOG_LIMITS, scoutReviewUpdate, type ScoutLogInput } from "./scoutLog";

const base: ScoutLogInput = {
  id: "log-1",
  at: "2026-10-14T12:00:00.000Z",
  actor: "Ana",
  planId: "plan-1",
  planRevision: 3,
  turn: 1,
  promptId: "typed",
  promptLabel: "Typed question",
  kind: "plan",
  ok: true,
  durationMs: 12_000,
  question: "Why is CTV the largest share?",
};

test("a ScoutAI record expires a year after it was asked", () => {
  assert.equal(buildScoutLog(base).expireAt, "2027-10-14T12:00:00.000Z");
});

test("a very long question, answer and proposal are cut so one record stays far under Firestore's 1MB", () => {
  const huge = "x".repeat(200_000);
  const log = buildScoutLog({
    ...base,
    question: huge,
    reply: huge,
    proposal: { summary: huge, items: Array.from({ length: 50 }, () => ({ title: huge, why: huge, evidence: huge, changes: Array.from({ length: 100 }, () => ({ label: huge, before: huge, after: huge })) })) },
    dropped: Array.from({ length: 50 }, () => huge),
  });
  assert.equal(log.question.length, SCOUT_LOG_LIMITS.question + 1);
  assert.equal(log.reply!.length, SCOUT_LOG_LIMITS.reply + 1);
  assert.equal(log.proposal!.items.length, SCOUT_LOG_LIMITS.items);
  assert.ok(JSON.stringify(log).length < 120_000, `under 120KB, got ${JSON.stringify(log).length}`);
});

test("the stored proposal keeps what the planner saw and drops the raw operations", () => {
  const log = buildScoutLog({
    ...base,
    proposal: { summary: "Shift to CTV", items: [{ title: "More CTV", why: "Reach", changes: [{ label: "CTV", before: "20%", after: "25%" }], ops: [{ type: "set_allocation" }] } as any] },
  });
  assert.deepEqual(log.proposal, { summary: "Shift to CTV", items: [{ title: "More CTV", why: "Reach", changes: [{ label: "CTV", before: "20%", after: "25%" }] }] });
});

test("an answer with nothing proposed stores no proposal", () => {
  assert.equal(buildScoutLog({ ...base, proposal: { items: [] } }).proposal, undefined);
  assert.equal(buildScoutLog({ ...base, proposal: null }).proposal, undefined);
});

test("only a browser-shaped conversation id is stored", () => {
  assert.equal(sanitizeConversationId("cabc123def"), "cabc123def");
  assert.equal(sanitizeConversationId("../../etc"), undefined);
  assert.equal(sanitizeConversationId(42), undefined);
});

test("a reviewer's rating only ever writes the review, never the planner's thumbs", () => {
  const result = scoutReviewUpdate({ rating: "down", notes: "  Cited the wrong CPA  ", feedback: { rating: "up" } }, "Admin", new Date("2026-10-15T09:00:00.000Z"));
  assert.ok("update" in result);
  assert.deepEqual(Object.keys(result.update), ["review"]);
  assert.deepEqual(result.update.review, { rating: "down", notes: "Cited the wrong CPA", by: "Admin", at: "2026-10-15T09:00:00.000Z" });
});

test("clearing a review removes it, and an unknown rating is refused", () => {
  const cleared = scoutReviewUpdate({ rating: null }, "Admin");
  assert.ok("update" in cleared);
  assert.equal(cleared.update.review, undefined);
  assert.ok("error" in scoutReviewUpdate({ rating: "meh" }, "Admin"));
  assert.ok("error" in scoutReviewUpdate(null, "Admin"));
});
