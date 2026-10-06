import test from "node:test";
import assert from "node:assert/strict";
import { classifyScoutError, scoutFailureMessage } from "./scoutErrors";

test("a turn that ran out of time is told apart from a bad answer and an unreachable service", () => {
  assert.equal(classifyScoutError(new Error("ScoutAI timed out after 90s.")), "timeout");
  assert.equal(classifyScoutError(Object.assign(new Error("The operation was aborted"), { name: "AbortError" })), "timeout");
  assert.equal(classifyScoutError(new SyntaxError("Unexpected end of JSON input")), "unreadable");
  assert.equal(classifyScoutError(new Error("Gemini returned no output text.")), "unreadable");
  assert.equal(classifyScoutError(new Error("503 Service Unavailable")), "unavailable");
});

test("a timed-out analysis says so, instead of the generic couldn't-answer message", () => {
  assert.match(scoutFailureMessage("timeout", true), /analysis took longer/);
  assert.match(scoutFailureMessage("timeout", true, 270000), /about 4.5 minutes in all/);
  assert.match(scoutFailureMessage("timeout", false), /took too long/);
  for (const failure of ["timeout", "unreadable", "unavailable"] as const) assert.doesNotMatch(scoutFailureMessage(failure, false), /couldn't answer just now/);
});
