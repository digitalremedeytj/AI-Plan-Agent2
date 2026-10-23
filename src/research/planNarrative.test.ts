import test from "node:test";
import assert from "node:assert/strict";
import { AS_IS_PLAN_NOTE, applyNarrative, buildNarrativeInput, currentNarrative, narrativeChannelKey, planNarrativeNote } from "./planNarrative";
import { RFP_OPTIONS, rfpStrategy } from "../planning/testing/rfpPlans";

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

test("the narrative's publisher highlights are held to the plan's publishers", () => {
  const profile: any = { ctvPublishers: [{ publisher: "ESPN", category: "Network", why: "w" }], publisherHighlights: { headline: "Old", pillars: [] } };
  const pillars = ["A", "B", "C"].map((title) => ({ icon: "sports", title, detail: "d", publishers: ["ESPN", "Netflix"] }));
  assert.ok(applyNarrative(profile, { publisherHighlights: { headline: "New", pillars } }).includes("publisherHighlights"));
  assert.deepEqual(profile.publisherHighlights.pillars[0].publishers, ["ESPN"]);

  applyNarrative(profile, { publisherHighlights: { headline: "Thin", pillars: pillars.slice(0, 1) } });
  assert.equal(profile.publisherHighlights.headline, "New");
});

const withStrategy = (strategy: any, publishers: string[] = ["Hulu", "Roku"]) => ({ channelStrategy: strategy, ctvPublishers: publishers.map((publisher) => ({ publisher })) });

test("the narrative is out of date when the channels or publishers change, but not when only the budget split does", () => {
  const plan = withStrategy(rfpStrategy("asIs"));
  const key = narrativeChannelKey(plan);
  assert.equal(narrativeChannelKey(withStrategy(rfpStrategy("asIs"), ["roku", "Hulu"])), key, "publisher order and case do not matter");

  const resplit = withStrategy(rfpStrategy("asIs"));
  resplit.channelStrategy.mediaPlan.channels = resplit.channelStrategy.mediaPlan.channels.map((c: any) => ({ ...c, allocationDollars: 25_000, allocationPercent: 50 }));
  assert.equal(narrativeChannelKey(resplit), key);

  assert.notEqual(narrativeChannelKey(withStrategy(rfpStrategy("reallocation"))), key, "a different mix of media types");
  assert.notEqual(narrativeChannelKey(withStrategy(rfpStrategy("asIs"), ["Hulu"])), key, "a different publisher list");
  const withPrint = rfpStrategy("asIs", 0, [{ ...RFP_OPTIONS[0], placements: [...RFP_OPTIONS[0].placements, { mediaType: "Print", productType: "Newspaper insert", budget: 5_000 }] }]);
  assert.notEqual(narrativeChannelKey(withStrategy(withPrint)), key, "an uploaded line outside the catalog");
});

test("a client plan used as is tells the writer to back it without inventing evidence; other plans get no extra rules", () => {
  assert.equal(planNarrativeNote(withStrategy(rfpStrategy("asIs"))), AS_IS_PLAN_NOTE);
  assert.equal(planNarrativeNote(withStrategy(rfpStrategy("reallocation"))), "");
  assert.match(AS_IS_PLAN_NOTE, /Never invent or stretch evidence/);
  assert.match(AS_IS_PLAN_NOTE, /Do not suggest adding, cutting or moving budget/);
  const input = buildNarrativeInput({ briefBlock: "BRIEF", campaign: "", personas: "", charts: "", channelPlan: "CHANNELS", publishers: "", ledger: "", research: "", draft: {}, planNote: AS_IS_PLAN_NOTE });
  assert.ok(input.indexOf("THE CLIENT'S OWN PLAN") > input.indexOf("CHANNELS"), "the rules follow the channel plan they are about");
});
