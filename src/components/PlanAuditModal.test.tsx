import test from "node:test";
import assert from "node:assert/strict";
import { describePath } from "./PlanAuditModal";

test("proposed fixes name the field in planner terms, not as a JSON path", () => {
  assert.equal(describePath("recommendations[1].why"), "Recommendation 2 - why");
  assert.equal(describePath("executiveSummary"), "Executive summary");
  assert.equal(describePath("personas[0].narrative"), "Persona 1 - narrative");
  assert.equal(describePath("temporalPatterns.activationNotes"), "Timing - activation notes");
  assert.equal(describePath("something.odd[x]"), "something.odd[x]");
  assert.equal(describePath("channelStrategy.mediaPlan.channels[2].tradeoffs[0]"), "Channel 3 - trade-off 1");
  assert.equal(describePath("channelStrategy.mediaPlan.channels[0].evidence[1].detail"), "Channel 1 - evidence 2");
  assert.equal(describePath("channelStrategy.mediaPlan.channels[1].gapAddressed"), "Channel 2 - why");
});
