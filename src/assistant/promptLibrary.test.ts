import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SCOUT_PROMPTS, featuredPrompts, mergeWithDefaults, promptAvailability, validatePromptLibrary, type PromptContext, type ScoutPrompt,
} from "./promptLibrary";

const ctx = (extra: Partial<PromptContext> = {}): PromptContext => ({
  advertiser: "Husky Liners",
  kpis: ["CPA under $30"],
  largestMediaType: { name: "CTV / OTT", share: 17.4 },
  openQaFindings: 0,
  hasPastCampaign: false,
  hasLiveCampaign: false,
  hasRecap: false,
  ...extra,
});
const byId = (id: string) => DEFAULT_SCOUT_PROMPTS.find((p) => p.id === id)!;

test("the library starts with the built-in prompts, each with a unique id", () => {
  const ids = DEFAULT_SCOUT_PROMPTS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(validatePromptLibrary(DEFAULT_SCOUT_PROMPTS).valid, validatePromptLibrary(DEFAULT_SCOUT_PROMPTS).errors.join("; "));
  assert.deepEqual(mergeWithDefaults(null).map((p) => p.id), ids);
});

test("an admin's edits and order are kept, and a built-in prompt added in a later release still appears", () => {
  const stored = [{ ...byId("personas-fit"), text: "Edited." }, byId("plan-health-check")];
  const merged = mergeWithDefaults(stored);
  assert.deepEqual(merged.slice(0, 2).map((p) => p.id), ["personas-fit", "plan-health-check"]);
  assert.equal(merged[0].text, "Edited.");
  assert.equal(merged.length, DEFAULT_SCOUT_PROMPTS.length);
});

test("a prompt the plan cannot answer says what it needs, instead of being sent", () => {
  const a = promptAvailability(byId("past-vs-kpis"), ctx());
  assert.equal(a.available, false);
  assert.equal(a.reason, "Needs a past campaign linked to this plan");
  assert.equal(promptAvailability(byId("past-vs-kpis"), ctx({ hasPastCampaign: true })).available, true);
  assert.match(promptAvailability(byId("apply-recap"), ctx()).reason ?? "", /Campaign Recap/);
});

test("variables are filled from the plan, and a prompt whose variable has no value is unavailable", () => {
  assert.equal(promptAvailability(byId("largest-media-type"), ctx()).text, "Why does CTV / OTT get 17% of the budget?");
  assert.equal(promptAvailability(byId("largest-media-type"), ctx({ largestMediaType: null })).reason, "Needs a channel plan");
  const qa = promptAvailability(byId("qa-findings"), ctx({ openQaFindings: 3 }));
  assert.equal(qa.text, "How should we handle the 3 open QA findings?");
});

test("quick suggestions are the first starred prompts the plan can answer", () => {
  const plain = featuredPrompts(DEFAULT_SCOUT_PROMPTS, ctx()).map((p) => p.prompt.id);
  assert.deepEqual(plain, ["improve-kpis", "brief-delivery", "largest-media-type", "personas-fit"]);
  const withPast = featuredPrompts(DEFAULT_SCOUT_PROMPTS, ctx({ hasPastCampaign: true })).map((p) => p.prompt.id);
  assert.equal(withPast[0], "past-analysis");
  const off = DEFAULT_SCOUT_PROMPTS.map((p) => (p.id === "improve-kpis" ? { ...p, enabled: false } : p));
  assert.ok(!featuredPrompts(off, ctx()).some((p) => p.prompt.id === "improve-kpis"), "a prompt switched off is not suggested");
});

test("saving rejects unknown variables, missing text and removed built-in prompts", () => {
  const custom: ScoutPrompt = { id: "custom-1", title: "Mine", category: "Plan review", text: "Check {budgetz}", needs: [], mode: "plan", featured: false, enabled: true, builtIn: false };
  const result = validatePromptLibrary([...DEFAULT_SCOUT_PROMPTS, custom, { ...custom, id: "custom-2", text: "" }]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /\{budgetz\}/.test(e)));
  assert.ok(result.errors.some((e) => /needs prompt text/.test(e)));
  const missing = validatePromptLibrary(DEFAULT_SCOUT_PROMPTS.filter((p) => p.id !== "personas-fit"));
  assert.ok(missing.errors.some((e) => /turned off but not removed/.test(e)));
});

test("a browser cannot claim a custom prompt is built in, or slip in an unknown mode", () => {
  const sneaky = { id: "custom-9", title: "X", category: "Plan review", text: "Ask", needs: ["nonsense"], mode: "superfast", featured: true, enabled: true, builtIn: true };
  const { prompts } = validatePromptLibrary([...DEFAULT_SCOUT_PROMPTS, sneaky]);
  const saved = prompts.find((p) => p.id === "custom-9")!;
  assert.equal(saved.builtIn, false);
  assert.equal(saved.mode, "plan");
  assert.deepEqual(saved.needs, []);
});
