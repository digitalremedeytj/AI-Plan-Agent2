import test from "node:test";
import assert from "node:assert/strict";
import { normalizePublisherHighlights, pillarPublishersInPlan, publisherHighlightFields, publisherMixStats } from "./publisherHighlights";
import { ownerOfPath } from "../qa/planRemediation";

const plan = [
  { publisher: "ESPN", category: "Network", why: "w" },
  { publisher: "NFL Network", category: "Network", why: "w" },
  { publisher: "Hulu", category: "App", why: "w" },
  { publisher: "Roku", category: "OS", why: "w" },
];
const pillar = (title: string, publishers: string[], icon = "sports") => ({ icon, title, detail: `${title} detail.`, publishers });

test("pillars may only name publishers in the plan, in the plan's spelling", () => {
  const h = normalizePublisherHighlights({
    headline: "Built for truck owners.",
    pillars: [pillar("Live sports", ["espn", "NFL Network", "Fox Sports"]), pillar("Family", ["Hulu"]), pillar("Scale", ["Roku", "roku"])],
  }, plan);
  assert.equal(h?.headline, "Built for truck owners");
  assert.deepEqual(h?.pillars.map((p) => p.publishers), [["ESPN", "NFL Network"], ["Hulu"], ["Roku"]]);
});

test("an icon outside the list falls back instead of rendering blank", () => {
  const h = normalizePublisherHighlights({ headline: "H", pillars: [pillar("A", [], "rocket"), pillar("B", []), pillar("C", [])] }, plan);
  assert.equal(h?.pillars[0].icon, "premium");
});

test("too few usable pillars keeps what the plan had rather than a thin panel", () => {
  assert.equal(normalizePublisherHighlights({ headline: "H", pillars: [pillar("A", []), { icon: "news", title: "", detail: "d", publishers: [] }] }, plan), null);
  assert.equal(normalizePublisherHighlights({ pillars: [pillar("A", []), pillar("B", []), pillar("C", [])] }, plan), null);
  assert.equal(normalizePublisherHighlights("a paragraph", plan), null);
});

test("no more than four pillars are kept", () => {
  const h = normalizePublisherHighlights({ headline: "H", pillars: ["A", "B", "C", "D", "E"].map((t) => pillar(t, [])) }, plan);
  assert.equal(h?.pillars.length, 4);
});

test("a publisher removed from the plan drops out of its pillar", () => {
  assert.deepEqual(pillarPublishersInPlan(pillar("Live sports", ["ESPN", "NFL Network"]) as any, plan.slice(1)), ["NFL Network"]);
});

test("the stat row counts the plan's publishers by category", () => {
  assert.deepEqual(publisherMixStats(plan), { total: 4, network: 2, app: 1, os: 1 });
});

test("every highlight field the chat and QA can see is a path the prose fixer may write", () => {
  const profile = { publisherHighlights: normalizePublisherHighlights({ headline: "H", pillars: [pillar("A", []), pillar("B", []), pillar("C", [])] }, plan) };
  const fields = publisherHighlightFields(profile);
  assert.equal(fields.length, 7);
  for (const f of fields) assert.equal(ownerOfPath(f.path), "narrative", f.path);
  assert.equal(ownerOfPath("publisherHighlights.pillars[0].publishers"), null);
  assert.equal(ownerOfPath("publisherHighlights.pillars[0].icon"), null);
});
