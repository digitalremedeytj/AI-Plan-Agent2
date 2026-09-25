import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAudit, normalizeVerify, openFindingsAsFlags, planForAudit, type AuditFinding } from "./planAudit";
import { applyPatches, describeAppliedFixes, getAtPath, ownerOfPath } from "./planRemediation";

const finding = (over: Partial<AuditFinding>): AuditFinding => ({
  id: "F1", severity: "major", category: "Cohesion", owner: "narrative", paths: ["executiveSummary"],
  issue: "Issue", evidence: "", fix: "", ...over,
});

test("the total score is the sum of the categories, not the number the model wrote", () => {
  const audit = normalizeAudit({
    executiveSummary: "ok",
    totalScore: 99,
    scorecard: [
      { category: "Evidence & Data Integrity", score: 14, notes: "a" },
      { category: "Audience & Brief Fit", score: 18, notes: "b" },
      { category: "Cohesion", score: 25, notes: "over the max" },
      { category: "Strategic Quality", score: 15, notes: "d" },
      { category: "Clarity & Client Readiness", score: 16, notes: "e" },
    ],
    findings: [{ issue: "x", owner: "someone else", severity: "urgent" }],
  })!;
  assert.equal(audit.totalScore, 14 + 18 + 20 + 15 + 16);
  assert.equal(audit.findings[0].owner, "planner", "an unknown owner goes to the planner, never to the fixer");
  assert.equal(audit.findings[0].severity, "major");
  assert.equal(normalizeAudit({ scorecard: [] }), null);
});

test("the prose fixer can change narrative, persona and publisher text, and nothing else", () => {
  const profile: any = {
    intro: "Old intro.",
    executiveSummary: "Old summary.",
    personas: [{ name: "Core Cat Owner", age: "25-34", narrative: "Old." }],
    ctvPublishers: [{ publisher: "Hulu", why: "Old why." }],
    channelStrategy: { mediaPlan: { channels: [{ gapAddressed: "Old gap.", role: "awareness" }] } },
  };
  const findings = [finding({ id: "F1" }), finding({ id: "F2", owner: "channelStrategy" })];
  const { applied, rejected } = applyPatches(profile, [
    { findingId: "F1", path: "intro", value: "New intro." },
    // Synthesis's draft summary is not shown to anyone, so it is not fixed either.
    { findingId: "F1", path: "executiveSummary", value: "New summary." },
    { findingId: "F1", path: "personas[0].narrative", value: "New." },
    { findingId: "F1", path: "ctvPublishers[0].why", value: "New why." },
    { findingId: "F1", path: "personas[0].name", value: "Dog Owner" },
    { findingId: "F1", path: "personas[0].age", value: "55+" },
    { findingId: "F1", path: "channelStrategy.mediaPlan.channels[0].role", value: "conversion" },
    { findingId: "F2", path: "intro", value: "Sneaky." },
    { findingId: "F1", path: "takeaways[7]", value: "Does not exist." },
  ], findings);
  assert.deepEqual(applied.map((p) => p.path), ["intro", "personas[0].narrative", "ctvPublishers[0].why"]);
  assert.equal(profile.personas[0].name, "Core Cat Owner");
  assert.equal(profile.personas[0].age, "25-34");
  assert.equal(profile.channelStrategy.mediaPlan.channels[0].role, "awareness");
  assert.equal(profile.intro, "New intro.");
  assert.equal(profile.executiveSummary, "Old summary.");
  assert.equal(rejected.length, 6);
});

test("a channel's written rationale can be fixed, but not its catalog facts, and the fix survives re-adding the channel", () => {
  const evidence = () => [
    { sourceType: "audience_research", detail: "Nielsen says women 25-54 lead CTV viewing." },
    { sourceType: "digital_remedy_rule", detail: "CTV is live and Digital Remedy-executable." },
  ];
  const profile: any = {
    channelStrategy: {
      mediaPlan: {
        channels: [{ channelId: "ctv", gapAddressed: "Old gap.", tradeoffs: ["CPMs run $30-40 in this category."], evidence: evidence() }],
        evaluatedCandidates: [{ product: { id: "ctv" }, gapAddressed: "Old gap.", tradeoffs: ["CPMs run $30-40 in this category."], evidence: evidence() }],
      },
    },
  };
  const { applied, rejected } = applyPatches(profile, [
    { findingId: "F1", path: "channelStrategy.mediaPlan.channels[0].tradeoffs[0]", value: "CPMs are a planning assumption to confirm." },
    { findingId: "F1", path: "channelStrategy.mediaPlan.channels[0].evidence[0].detail", value: "Nielsen reports adults 25-34 stream the most." },
    { findingId: "F1", path: "channelStrategy.mediaPlan.channels[0].evidence[1].detail", value: "Rewritten catalog fact." },
  ], [finding({ id: "F1", owner: "channelRationale" })]);
  assert.equal(applied.length, 2);
  assert.deepEqual(rejected.map((r) => r.reason), ["catalog evidence is not prose"]);
  const candidate = profile.channelStrategy.mediaPlan.evaluatedCandidates[0];
  assert.equal(candidate.tradeoffs[0], "CPMs are a planning assumption to confirm.");
  assert.equal(candidate.evidence[0].detail, "Nielsen reports adults 25-34 stream the most.");
  assert.equal(candidate.evidence[1].detail, "CTV is live and Digital Remedy-executable.");
});

test("the fix list reports only findings a patch actually changed", () => {
  const findings = [finding({ id: "F1", issue: "Contradicts the chart" }), finding({ id: "F2", issue: "Never patched" })];
  const fixes = describeAppliedFixes(findings, [{ findingId: "F1", path: "takeaways[0]", value: "v", before: "b" }], [
    { findingId: "F1", resolution: "Aligned the takeaway with the day chart." },
    { findingId: "F2", resolution: "Claimed but not done." },
  ]);
  assert.deepEqual(fixes, [{ issue: "Contradicts the chart", resolution: "Aligned the takeaway with the day chart. (Changed: takeaways[0].)" }]);
});

test("verify marks earlier findings and keeps new ones apart", () => {
  const verify = normalizeVerify({
    executiveSummary: "better",
    scorecard: [{ category: "Evidence", score: 17, notes: "n" }],
    findingStatus: [{ id: "F1", status: "resolved", note: "fixed" }, { id: "F2", status: "bogus" }],
    findings: [{ id: "F9", issue: "introduced by a fix" }],
  })!;
  assert.equal(verify.findingStatus.get("F1")?.status, "resolved");
  assert.equal(verify.findingStatus.has("F2"), false);
  assert.equal(verify.findings[0].id, "N9");
});

test("red flags list what is still open, and say when a person has to act", () => {
  const flags = openFindingsAsFlags([
    finding({ id: "F1", issue: "Fixed", status: "resolved" }),
    finding({ id: "F2", issue: "Measurement mismatch", owner: "channelStrategy", severity: "critical" }),
    finding({ id: "F3", issue: "Wording", severity: "minor" }),
    finding({ id: "F4", issue: "Half done", status: "partially_resolved" }),
  ]);
  assert.deepEqual(flags, ["Measurement mismatch [needs channelStrategy change]", "Half done (partially resolved)"]);
});

test("the auditor reads the prose without the parts described to it separately", () => {
  const view = JSON.parse(planForAudit({
    intro: "i",
    personas: [{ name: "P", avatarUrl: "data:image/png;base64,xxx" }],
    demographics: { overview: "o", ageChartData: [{ value: 1 }] },
    channelStrategy: { big: true },
    researchSnapshot: { dossiers: [] },
  }));
  assert.equal(view.personas[0].avatarUrl, undefined);
  assert.equal(view.demographics.ageChartData, undefined);
  assert.equal(view.demographics.overview, "o");
  assert.equal(view.channelStrategy, undefined);
  assert.equal(view.researchSnapshot, undefined);
  assert.equal(ownerOfPath("recommendations[2].why"), "narrative");
  assert.equal(getAtPath({ a: [{ b: "x" }] }, "a[0].b"), "x");
});
