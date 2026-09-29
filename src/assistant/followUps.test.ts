import assert from "node:assert/strict";
import test from "node:test";
import { detectFollowUps } from "./followUps";
import { applyOps } from "./operations";

const persona = (name: string) => ({ name, age: "30-39", income: "$80k", gender: "Female", watch: "Hulu", browse: "Reddit", buy: "Target", narrative: `${name} streams.` });

function payload() {
  return {
    kpis: ["Awareness"],
    geography: "United States",
    profile: {
      intro: "Ava and Ben anchor this plan; Ava streams nightly.",
      takeaways: ["Ben responds to Hulu placements."],
      personas: [persona("Ava"), persona("Ben")],
      segmentRecommendations: [
        { id: "s1", name: "Night Streamers", dimension: "Behavioral", justification: "For Ava.", personaIndices: [0], source: "ScoutAI" },
        { id: "s2", name: "Deal Seekers", dimension: "Behavioral", justification: "For Ben.", personaIndices: [1], source: "ScoutAI" },
      ],
      ctvPublishers: [{ publisher: "Hulu", category: "App", why: "Reach." }],
      briefOfRecord: { primaryAudience: "Parents", includedSegments: ["Parents"], coreSegments: ["Parents"], excludedSegments: [], uncertainties: [] },
    },
  };
}

test("replacing a persona flags the segments chosen for the old one and the text that still names it", () => {
  const before = payload();
  const after = applyOps(before, [{ type: "update_persona", persona: "Ava", fields: { name: "Cora" } }]).payload;
  const followUps = detectFollowUps(before, after);
  assert.deepEqual(followUps.map((f) => f.kind), ["retag_segments", "update_text"]);
  assert.match(followUps[0].label, /chosen for Ava, now Cora/);
  assert.match(followUps[1].label, /mentions Ava \(3 places\)/);
});

test("removing a persona flags segments left with no persona", () => {
  const before = payload();
  const after = applyOps(before, [{ type: "remove_persona", persona: "Ben" }]).payload;
  const retag = detectFollowUps(before, after).find((f) => f.kind === "retag_segments");
  assert.ok(retag);
  assert.match(retag.prompt!, /Deal Seekers/);
});

test("a removed publisher still named in the text is flagged, and brief or KPI edits suggest a regenerate", () => {
  const before = payload();
  const after = applyOps(before, [
    { type: "remove_ctv_publisher", publisher: "Hulu" },
    { type: "set_kpis", values: ["Awareness", "Visits"] },
  ]).payload;
  const kinds = detectFollowUps(before, after).map((f) => f.kind);
  assert.deepEqual(kinds, ["update_text", "regenerate_plan"]);
});

test("a change that leaves nothing stale has no follow-ups", () => {
  const before = payload();
  const after = applyOps(before, [{ type: "update_persona", persona: "Ben", fields: { watch: "Netflix" } }]).payload;
  assert.deepEqual(detectFollowUps(before, after), []);
});
