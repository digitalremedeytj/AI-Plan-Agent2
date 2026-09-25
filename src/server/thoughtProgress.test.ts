import test from "node:test";
import assert from "node:assert/strict";
import { ThoughtHeadlines, throttledProgress } from "./thoughtProgress";

test("each bold headline is reported once, as soon as it has fully streamed in", () => {
  const lines: string[] = [];
  const headlines = new ThoughtHeadlines((line) => lines.push(line));
  headlines.push("**Checking the CTV ");
  assert.deepEqual(lines, []);
  headlines.push("allocation**\n\nI'm comparing the split to the brief. ");
  headlines.push("**Reviewing evidence for persona stats**\n\nThe dossier says...");
  headlines.end();
  assert.deepEqual(lines, ["Checking the CTV allocation", "Reviewing evidence for persona stats"]);
});

test("a summary section with no headline falls back to its first sentence", () => {
  const lines: string[] = [];
  const headlines = new ThoughtHeadlines((line) => lines.push(line));
  headlines.push("I'm weighing whether the budget split matches the KPIs. Then I'll check reach.");
  headlines.end();
  assert.deepEqual(lines, ["I'm weighing whether the budget split matches the KPIs"]);
});

test("a very long headline is trimmed so one thought cannot flood the console", () => {
  const lines: string[] = [];
  const headlines = new ThoughtHeadlines((line) => lines.push(line));
  headlines.push(`**${"a".repeat(190)}**`);
  assert.equal(lines[0].length, 140);
  assert.ok(lines[0].endsWith("…"));
});

test("headlines about the task rather than the plan are dropped", () => {
  const lines: string[] = [];
  const headlines = new ThoughtHeadlines((line) => lines.push(line));
  for (const h of ["Defining the Output", "Validating Schema Accuracy", "Defining the Synthesis Focus", "Summarizing Browser Behavior", "Evaluating claims in advertising"]) {
    headlines.push(`**${h}**\n\nDetail. `);
  }
  assert.deepEqual(lines, ["Summarizing Browser Behavior", "Evaluating claims in advertising"]);
});

test("lines inside the throttle window are held, and only the newest is sent", async () => {
  const sent: string[] = [];
  const progress = throttledProgress((line) => sent.push(line), 40);
  progress.report("first");
  progress.report("second");
  progress.report("third");
  assert.deepEqual(sent, ["first"]);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(sent, ["first", "third"]);
  progress.stop();
});

test("nothing is sent after stop, even from a call still streaming past its timeout", async () => {
  const sent: string[] = [];
  const progress = throttledProgress((line) => sent.push(line), 40);
  progress.report("first");
  progress.report("held");
  progress.stop();
  progress.report("late");
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(sent, ["first"]);
});

test("a repeated line is not sent twice", () => {
  const sent: string[] = [];
  const progress = throttledProgress((line) => sent.push(line), 0);
  progress.report("same");
  progress.report("same");
  assert.deepEqual(sent, ["same"]);
  progress.stop();
});
