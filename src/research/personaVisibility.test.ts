import test from "node:test";
import assert from "node:assert/strict";
import { briefForShare, isPersonaAvatarShared, isPersonaShared, personasForShare } from "./personaVisibility";
import { buildBriefSnapshot } from "./executiveBrief";
import { exportProfileToMarkdown } from "../utils/markdownExporter";

const persona = (name: string, extra: Record<string, unknown> = {}): any => ({
  name, age: "30-44", gender: "Female", income: "$75K+", watch: "Hulu", browse: "Reddit", buy: "Chewy", narrative: `${name} story.`,
  avatarUrl: `data:image/png;base64,${name}`, avatarHistory: [{ id: "a", url: "data:old", createdAt: "" }],
  ...extra,
});

test("a hidden persona reaches the share link emptied but keeps its slot, so segment positions still line up", () => {
  const shared = personasForShare([persona("Road Trip Families"), persona("Weekend Anglers", { hiddenFromShare: true }), persona("Pet Parents")]);
  assert.equal(shared.length, 3);
  assert.equal(shared[1].name, "");
  assert.equal(shared[1].narrative, "");
  assert.equal(shared[1].avatarUrl, undefined);
  assert.equal(shared[1].hiddenFromShare, true);
  assert.equal(shared[2].name, "Pet Parents");
});

test("a hidden headshot is not in the share response, and earlier headshots never are", () => {
  const [hidden, shown] = personasForShare([persona("A", { avatarHiddenFromShare: true }), persona("B")]);
  assert.equal(hidden.avatarUrl, undefined);
  assert.equal(hidden.name, "A", "hiding the photo keeps the persona");
  assert.equal(shown.avatarUrl, "data:image/png;base64,B");
  assert.equal(shown.avatarHistory, undefined);
});

test("a hidden persona's photo counts as hidden too", () => {
  assert.equal(isPersonaShared(persona("A")), true);
  assert.equal(isPersonaAvatarShared(persona("A", { hiddenFromShare: true })), false);
  assert.equal(isPersonaAvatarShared(persona("A", { avatarHiddenFromShare: true })), false);
});

test("the executive brief neither describes a hidden persona nor names it as a segment's audience", () => {
  const snapshot = buildBriefSnapshot({
    intro: "x",
    personas: [persona("Road Trip Families"), persona("Weekend Anglers", { hiddenFromShare: true })],
    segmentRecommendations: [{ id: "s", name: "Boat Owners", dimension: "Behavioral", justification: "", personaIndices: [0, 1] }],
  } as any, { advertiserName: "Acme", kpis: [], geography: "US" });
  assert.deepEqual(snapshot.personas.map((p) => p.name), ["Road Trip Families"]);
  assert.deepEqual(snapshot.segments[0].personas, ["Road Trip Families"]);
});

test("the plan export leaves out a hidden persona and numbers the rest without a gap", () => {
  const others = ["intro", "segments", "domainAffinity", "deviceShare", "demographics", "temporal", "channels", "executiveSummary", "sources"];
  const markdown = exportProfileToMarkdown({
    intro: "x", takeaways: [], recommendations: [], sources: [], hiddenSections: others,
    personas: [persona("Weekend Anglers", { hiddenFromShare: true }), persona("Pet Parents")],
  } as any, false, false);
  assert.doesNotMatch(markdown, /Weekend Anglers/);
  assert.match(markdown, /Persona 1: Pet Parents/);
});

test("a brief written before a persona was hidden loses that persona's audience card on the share link", () => {
  const brief = {
    sections: [{ key: "audience", audienceMatches: [{ audience: "Weekend Anglers", reachedWith: ["Boat Owners"], why: "" }, { audience: "Pet Parents", reachedWith: ["Chewy Shoppers"], why: "" }] }],
    previous: { sections: [] },
  };
  const shared = briefForShare(brief, [persona("Weekend Anglers", { hiddenFromShare: true }), persona("Pet Parents")])!;
  assert.deepEqual(shared.sections![0].audienceMatches!.map((m) => m.audience), ["Pet Parents"]);
  assert.equal(shared.previous, undefined, "the replaced version is the planner's undo, not the client's");
});
