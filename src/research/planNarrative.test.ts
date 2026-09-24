import test from "node:test";
import assert from "node:assert/strict";
import { applyNarrative, currentNarrative } from "./planNarrative";

const recs = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `T${i}`, action: "a", why: "w", channels: "CTV / OTT" }));

test("the final narrative replaces the draft section by section", () => {
  const profile: any = { intro: "old", demographics: { overview: "old", ageChartData: [1] }, takeaways: ["a", "b", "c", "d"], recommendations: recs(4) };
  const replaced = applyNarrative(profile, {
    intro: "New intro.",
    demographicsOverview: "New overview.",
    takeaways: ["1", "2", "3", "4"],
    recommendations: recs(4).map((r) => ({ ...r, title: `New ${r.title}` })),
  });
  assert.equal(profile.intro, "New intro.");
  assert.equal(profile.demographics.overview, "New overview.");
  assert.deepEqual(profile.demographics.ageChartData, [1], "charts on the same section are untouched");
  assert.equal(profile.recommendations[0].title, "New T0");
  assert.deepEqual(replaced.sort(), ["demographics.overview", "intro", "recommendations", "takeaways"]);
});

test("an empty field or a wrong-length list keeps the draft instead of blanking the section", () => {
  const profile: any = { intro: "Draft intro.", takeaways: ["a", "b", "c", "d"], recommendations: recs(4) };
  const replaced = applyNarrative(profile, { intro: "  ", takeaways: ["only one"], recommendations: recs(3) });
  assert.equal(profile.intro, "Draft intro.");
  assert.deepEqual(profile.takeaways, ["a", "b", "c", "d"]);
  assert.equal(profile.recommendations.length, 4);
  assert.deepEqual(replaced, []);
  assert.deepEqual(applyNarrative(profile, null), []);
});

test("the draft handed to the writer is the narrative currently on the profile", () => {
  const draft = currentNarrative({ intro: "i", temporalPatterns: { overview: "t", activationNotes: "n" } });
  assert.equal(draft.intro, "i");
  assert.equal(draft.temporalOverview, "t");
  assert.equal(draft.activationNotes, "n");
});

test("the narrative no longer writes the executive summary; the executive brief does", () => {
  const profile: any = { executiveSummary: "Synthesis draft." };
  applyNarrative(profile, { executiveSummary: "Should be ignored." });
  assert.equal(profile.executiveSummary, "Synthesis draft.");
});
