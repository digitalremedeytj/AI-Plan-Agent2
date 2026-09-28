import test from "node:test";
import assert from "node:assert/strict";
import { buildAuditResult } from "./auditRunner";

const unscored = { audit: null, verify: null, findings: [], autoFixes: [], qaBypassed: true, auditModel: "" };

test("a Quick mode plan says the audit was skipped, not that the QA agent failed", () => {
  const result = buildAuditResult({ ...unscored, quickMode: true });
  assert.equal(result.quickMode, true);
  assert.equal(result.qaBypassed, true);
  assert.match(result.executiveSummary, /Quick mode/);
  assert.doesNotMatch(result.executiveSummary, /unavailable/);
  assert.deepEqual(result.criticalRedFlags, ["Not audited - generated in Quick mode."]);
  assert.ok(result.scorecard.every((row) => row.notes === "Not evaluated - Quick mode"));
});

test("a full run whose audit failed is still reported as unavailable", () => {
  const result = buildAuditResult(unscored);
  assert.equal("quickMode" in result, false);
  assert.match(result.executiveSummary, /unavailable/);
  assert.match(result.criticalRedFlags[0], /did not run/);
});
