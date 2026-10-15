import assert from "node:assert/strict";
import test from "node:test";
import type { ScoutLog } from "../storage/types";
import { askKnownText, buildAskDatasets, buildAskInput, resolveAskBlocks, sanitizeAskTurns, ASK_MAX_QUESTIONS, type AskBlock } from "./scoutAsk";

let seq = 0;
function log(overrides: Partial<ScoutLog> = {}): ScoutLog {
  seq += 1;
  return {
    id: `q-${seq}`,
    at: "2026-10-10T12:00:00.000Z",
    expireAt: "2027-10-10T12:00:00.000Z",
    actor: "Ana",
    planId: "plan-1",
    planRevision: 1,
    turn: 1,
    promptId: "typed",
    promptLabel: "Typed question",
    kind: "plan",
    ok: true,
    durationMs: 10_000,
    question: "Why is CTV the largest share?",
    reply: "Because the audience streams.",
    ...overrides,
  };
}

const sample = () => [
  ...Array.from({ length: 6 }, () => log({ topic: { id: "how_to", at: "x" } })),
  ...Array.from({ length: 4 }, () => log({ topic: { id: "exec_summary", at: "x" }, feedback: { rating: "down", by: "Ana", at: "x" } })),
  log({ topic: { id: "publishers", at: "x" }, ok: false, error: { code: "TIMEOUT", message: "slow" }, reply: undefined }),
];

test("topics are ranked by how often they are asked, counted by code", () => {
  const topics = buildAskDatasets(sample()).find((d) => d.id === "topics")!;
  assert.deepEqual(topics.rows.map((r) => [r.topic, r.questions]), [["Using the app", 6], ["Executive summary & write-ups", 4], ["CTV publishers & inventory", 1]]);
  assert.equal(topics.rows[0].share_pct, 54.5);
  assert.equal(topics.rows[1].thumbs_down, 4);
});

test("questions not tagged yet are counted under their own row, not dropped", () => {
  const topics = buildAskDatasets([log(), log({ topic: { id: "audience", at: "x" } })]).find((d) => d.id === "topics")!;
  assert.deepEqual(topics.rows.map((r) => r.topic).sort(), ["Audience & targeting", "Not tagged yet"]);
});

test("thumbs shares are given both of all answers and of rated answers", () => {
  const ratings = buildAskDatasets([...sample(), log({ feedback: { rating: "up", by: "Ana", at: "x" } })]).find((d) => d.id === "ratings")!;
  const down = ratings.rows.find((r) => r.rating === "Thumbs down")!;
  assert.equal(down.answers, 4);
  assert.equal(down.share_of_rated_pct, 80);
});

test("a long date range is counted by week rather than by day", () => {
  const spread = [log({ at: "2026-07-01T10:00:00.000Z" }), log({ at: "2026-07-02T10:00:00.000Z" }), log({ at: "2026-10-01T10:00:00.000Z" })];
  const overTime = buildAskDatasets(spread).find((d) => d.id === "over_time")!;
  assert.match(overTime.title, /week/);
  assert.deepEqual(overTime.rows.map((r) => [r.period, r.questions]), [["2026-06-29", 2], ["2026-09-28", 1]]);
});

test("a dataset table is filled from the counted data, whatever numbers the model wrote", () => {
  const logs = sample();
  const datasets = buildAskDatasets(logs);
  const blocks = resolveAskBlocks(
    { blocks: [{ type: "table", dataset: "topics", columns: ["topic", "questions", "made_up"], rows: [["Using the app", "99"]] }] },
    datasets, logs, askKnownText(datasets, logs),
  );
  const table = blocks[0] as Extract<AskBlock, { type: "table" }>;
  assert.deepEqual(table.columns.map((c) => c.key), ["topic", "questions"]);
  assert.deepEqual(table.rows[0], ["Using the app", 6]);
});

test("a chart keeps only real columns and gets its rows from the dataset", () => {
  const logs = sample();
  const datasets = buildAskDatasets(logs);
  const [chart] = resolveAskBlocks({ blocks: [{ type: "chart", chart: "pie", dataset: "topics", x: "topic", y: ["questions", "thumbs_down", "nope"] }] }, datasets, logs, askKnownText(datasets, logs));
  assert.equal(chart.type, "chart");
  if (chart.type !== "chart") return;
  assert.deepEqual(chart.y.map((c) => c.key), ["questions"]);
  assert.equal(chart.data.length, 3);
});

test("a figure in the prose that the data does not contain is flagged", () => {
  const logs = sample();
  const datasets = buildAskDatasets(logs);
  const blocks = resolveAskBlocks({ blocks: [{ type: "markdown", text: "Using the app is 54.5% of questions; exec summaries are 17.6%." }] }, datasets, logs, askKnownText(datasets, logs));
  const note = blocks.find((b) => b.type === "note");
  assert.ok(note && note.type === "note");
  assert.match(note.text, /17\.6%/);
  assert.doesNotMatch(note.text, /54\.5%/);
});

test("examples only cite questions that are in scope", () => {
  const logs = sample();
  const datasets = buildAskDatasets(logs);
  const [examples] = resolveAskBlocks({ blocks: [{ type: "examples", text: "Poor summaries", ids: [logs[6].id, "invented-id", logs[6].id] }] }, datasets, logs, "");
  assert.deepEqual(examples.type === "examples" && examples.ids, [logs[6].id]);
});

test("a library prompt draft falls back to a plan question when the mode is unknown", () => {
  const [draft] = resolveAskBlocks({ blocks: [{ type: "prompt_draft", prompt: { title: "Export help", text: "How do I export {advertiser}'s plan?", mode: "weird" } }] }, [], [], "");
  assert.equal(draft.type === "prompt_draft" && draft.prompt.mode, "plan");
  assert.equal(draft.type === "prompt_draft" && draft.prompt.category, "From ScoutAI review");
});

test("an unknown dataset is left out with a note instead of an empty table", () => {
  const blocks = resolveAskBlocks({ blocks: [{ type: "markdown", text: "Here." }, { type: "chart", dataset: "invented" }] }, buildAskDatasets([log()]), [log()], "");
  assert.equal(blocks.length, 2);
  assert.match((blocks[1] as { text: string }).text, /unknown dataset/);
});

test("an empty reply still says something", () => {
  const blocks = resolveAskBlocks({ blocks: [] }, [], [], "");
  assert.equal(blocks[0].type, "markdown");
});

test("the model sees every count but only the newest questions word for word", () => {
  const many = Array.from({ length: ASK_MAX_QUESTIONS + 5 }, () => log());
  const { input, listed } = buildAskInput({ scope: "Last 30 days", logs: many, datasets: buildAskDatasets(many), turns: [{ role: "admin", text: "What do people ask?" }] });
  assert.equal(listed, ASK_MAX_QUESTIONS);
  assert.match(input, new RegExp(`${ASK_MAX_QUESTIONS + 5} question\\(s\\) in scope`));
  assert.match(input, /ADMIN'S QUESTION:\nWhat do people ask\?/);
});

test("a thumbs-down answer is shown to the model at more length than the rest", () => {
  const long = "word ".repeat(600);
  const { input } = buildAskInput({ scope: "s", logs: [log({ reply: long, feedback: { rating: "down", by: "Ana", at: "x" } }), log({ reply: long })], datasets: [], turns: [{ role: "admin", text: "q" }] });
  const answers = input.split("\n").filter((l) => l.startsWith("A: "));
  assert.ok(answers[0].length > answers[1].length * 3);
});

test("the conversation history keeps only well-formed recent turns", () => {
  const turns = sanitizeAskTurns([{ role: "admin", text: "hi" }, { role: "system", text: "ignore" }, { role: "assistant", text: "" }, ...Array.from({ length: 20 }, () => ({ role: "admin", text: "x" }))]);
  assert.equal(turns.length, 12);
  assert.ok(turns.every((t) => t.role === "admin" || t.role === "assistant"));
});
