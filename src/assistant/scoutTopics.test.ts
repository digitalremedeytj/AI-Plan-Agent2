import assert from "node:assert/strict";
import test from "node:test";
import { buildTopicInput, normalizeTopicTags, topicLabel } from "./scoutTopics";

test("a topic outside the fixed list is counted as other", () => {
  const tags = normalizeTopicTags({ tags: [{ id: "a", topic: "budget_mix" }, { id: "b", topic: "made_up" }] }, ["a", "b"]);
  assert.equal(tags.get("a"), "budget_mix");
  assert.equal(tags.get("b"), "other");
});

test("tags for questions that were not sent are ignored, and the first tag wins", () => {
  const tags = normalizeTopicTags({ tags: [{ id: "a", topic: "audience" }, { id: "a", topic: "creative" }, { id: "zzz", topic: "creative" }] }, ["a"]);
  assert.deepEqual([...tags.entries()], [["a", "audience"]]);
  assert.equal(normalizeTopicTags(null, ["a"]).size, 0);
});

test("each question is sent with its id so the tag lands on the right record", () => {
  const input = buildTopicInput([{ id: "log-9", question: "How do I\nexport?", promptLabel: "Typed question", kind: "plan" }]);
  assert.equal(input, "[log-9] (Typed question; plan question) How do I export?");
});

test("an untagged question and a retired topic still get a readable label", () => {
  assert.equal(topicLabel(undefined), "Not tagged yet");
  assert.equal(topicLabel("retired_topic"), "retired_topic");
  assert.equal(topicLabel("how_to"), "Using the app");
});
