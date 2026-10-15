import assert from "node:assert/strict";
import test from "node:test";
import type { ScoutLog } from "../storage/types";
import { conversationOf, EMPTY_FILTERS, filterOptions, filterScoutLogs, formatDuration, sanitizeReviewFilters, scoutLogsCsv, summarizeScoutLogs, UNTAGGED } from "./scoutReviewData";

let seq = 0;
function log(overrides: Partial<ScoutLog> = {}): ScoutLog {
  seq += 1;
  return {
    id: `log-${seq}`,
    at: `2026-10-${String(10 + (seq % 5)).padStart(2, "0")}T12:00:00.000Z`,
    expireAt: "2027-10-14T12:00:00.000Z",
    actor: "Ana",
    planId: "plan-1",
    planRevision: 1,
    turn: 1,
    promptId: "typed",
    promptLabel: "Typed question",
    kind: "plan",
    ok: true,
    durationMs: 9_000,
    question: "Why is CTV the largest share?",
    ...overrides,
  };
}

test("the thumbs filter separates rated answers from the ones nobody rated", () => {
  const up = log({ feedback: { rating: "up", by: "Ana", at: "x" } });
  const down = log({ feedback: { rating: "down", by: "Ana", at: "x" } });
  const unrated = log();
  const logs = [up, down, unrated];
  assert.deepEqual(filterScoutLogs(logs, { ...EMPTY_FILTERS, rating: "up" }), [up]);
  assert.deepEqual(filterScoutLogs(logs, { ...EMPTY_FILTERS, rating: "down" }), [down]);
  assert.deepEqual(filterScoutLogs(logs, { ...EMPTY_FILTERS, rating: "unrated" }), [unrated]);
});

test("an admin's review does not count as the planner's thumbs", () => {
  const reviewedOnly = log({ review: { rating: "down", by: "Admin", at: "x" } });
  assert.deepEqual(filterScoutLogs([reviewedOnly], { ...EMPTY_FILTERS, rating: "unrated" }), [reviewedOnly]);
  assert.equal(summarizeScoutLogs([reviewedOnly]).rated, 0);
  assert.deepEqual(filterScoutLogs([reviewedOnly, log()], { ...EMPTY_FILTERS, reviewed: "reviewed" }), [reviewedOnly]);
});

test("failed, applied and reverted answers can each be picked out", () => {
  const failed = log({ ok: false, error: { code: "TIMEOUT", message: "Took too long" } });
  const applied = log({ outcome: { status: "applied", changes: 2, by: "Ana", at: "x" } });
  const reverted = log({ outcome: { status: "reverted", changes: 2, by: "Ana", at: "x" } });
  const logs = [failed, applied, reverted, log()];
  assert.deepEqual(filterScoutLogs(logs, { ...EMPTY_FILTERS, status: "failed" }), [failed]);
  assert.deepEqual(filterScoutLogs(logs, { ...EMPTY_FILTERS, status: "applied" }), [applied]);
  assert.deepEqual(filterScoutLogs(logs, { ...EMPTY_FILTERS, status: "reverted" }), [reverted]);
});

test("the person filter ignores case and spacing in the name planners signed in with", () => {
  const ana = log({ actor: "Ana Ruiz" });
  const ben = log({ actor: "Ben" });
  assert.deepEqual(filterScoutLogs([ana, ben], { ...EMPTY_FILTERS, person: " ana ruiz" }), [ana]);
});

test("search matches every word of the question or the advertiser, in any order", () => {
  const nike = log({ question: "Which CTV publishers drove the best completion rate?", advertiserName: "Nike" });
  const other = log({ question: "Shift budget to audio", advertiserName: "Acme" });
  assert.deepEqual(filterScoutLogs([nike, other], { ...EMPTY_FILTERS, search: "completion ctv" }), [nike]);
  assert.deepEqual(filterScoutLogs([nike, other], { ...EMPTY_FILTERS, search: "nike" }), [nike]);
  assert.deepEqual(filterScoutLogs([nike, other], { ...EMPTY_FILTERS, search: "ctv audio" }), []);
});

test("the summary's thumbs percentages are of rated answers only, failures of all questions", () => {
  const logs = [
    log({ feedback: { rating: "up", by: "Ana", at: "x" } }),
    log({ feedback: { rating: "up", by: "Ana", at: "x" } }),
    log({ feedback: { rating: "down", by: "Ben", at: "x" }, actor: "Ben" }),
    log({ ok: false }),
  ];
  const summary = summarizeScoutLogs(logs);
  assert.equal(summary.questions, 4);
  assert.equal(summary.people, 2);
  assert.equal(summary.rated, 3);
  assert.equal(summary.upPct, 67);
  assert.equal(summary.downPct, 33);
  assert.equal(summary.failurePct, 25);
});

test("with nothing rated the summary reports no percentage rather than 0%", () => {
  const summary = summarizeScoutLogs([log()]);
  assert.equal(summary.upPct, null);
  assert.equal(summary.downPct, null);
  assert.equal(summarizeScoutLogs([]).failurePct, null);
});

test("top prompts are the most asked, labelled by the prompt's title", () => {
  const logs = [
    log({ promptId: "pacing", promptLabel: "Pacing check" }),
    log({ promptId: "pacing", promptLabel: "Pacing check" }),
    log({ promptId: "typed", promptLabel: "Typed question" }),
  ];
  assert.deepEqual(summarizeScoutLogs(logs).topPrompts, [
    { promptId: "pacing", label: "Pacing check", count: 2 },
    { promptId: "typed", label: "Typed question", count: 1 },
  ]);
  assert.deepEqual(filterOptions(logs).prompts.map((p) => p.promptId), ["pacing", "typed"]);
});

test("a conversation reads back first question first, whatever order the records arrived in", () => {
  const second = log({ conversationId: "conv-123456", turn: 2, at: "2026-10-10T12:05:00.000Z" });
  const first = log({ conversationId: "conv-123456", turn: 1, at: "2026-10-10T12:00:00.000Z" });
  const elsewhere = log({ conversationId: "conv-999999", turn: 1 });
  const { turns, missingEarlier } = conversationOf([second, elsewhere, first], second);
  assert.deepEqual(turns, [first, second]);
  assert.equal(missingEarlier, false);
});

test("a chat that began before the loaded range says earlier turns are missing", () => {
  const third = log({ conversationId: "conv-abcdef", turn: 3 });
  assert.equal(conversationOf([third], third).missingEarlier, true);
});

test("a record from before conversation ids stands alone", () => {
  const a = log();
  const b = log();
  assert.deepEqual(conversationOf([a, b], a).turns, [a]);
});

test("durations read as seconds, then minutes and seconds", () => {
  assert.equal(formatDuration(12_340), "12.3s");
  assert.equal(formatDuration(65_000), "1m 05s");
});

test("the CSV keeps commas, quotes and line breaks inside a question in one cell", () => {
  const csv = scoutLogsCsv([log({ question: 'Compare "Hulu", ESPN\nand Roku', topic: { id: "publishers", at: "x" } })], (id) => (id === "publishers" ? "CTV publishers & inventory" : ""));
  const [header, row] = csv.split("\r\n");
  assert.match(header, /^Asked at \(UTC\),Person,/);
  assert.ok(row.includes('"Compare ""Hulu"", ESPN\nand Roku"'));
  assert.ok(row.includes("CTV publishers & inventory"));
});

test("a question that looks like a spreadsheet formula opens as text", () => {
  const csv = scoutLogsCsv([log({ question: "=HYPERLINK(\"http://x\")" })], () => "");
  assert.ok(csv.split("\r\n")[1].includes(`"'=HYPERLINK(""http://x"")"`));
});

test("the topic filter separates tagged questions from the ones not tagged yet", () => {
  const tagged = log({ topic: { id: "how_to", at: "x" } });
  const untagged = log();
  assert.deepEqual(filterScoutLogs([tagged, untagged], { ...EMPTY_FILTERS, topic: "how_to" }), [tagged]);
  assert.deepEqual(filterScoutLogs([tagged, untagged], { ...EMPTY_FILTERS, topic: UNTAGGED }), [untagged]);
});

test("filters from a request body keep only values the page can send", () => {
  const f = sanitizeReviewFilters({ rating: "sideways", status: "failed", kind: "live", person: 42, search: "x".repeat(900) });
  assert.equal(f.rating, "all");
  assert.equal(f.status, "failed");
  assert.equal(f.kind, "live");
  assert.equal(f.person, "");
  assert.equal(f.search.length, 500);
});
