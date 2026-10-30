import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSegmentRationale, sanitizeSegmentRationaleRequest, segmentsNeedingRationale } from "./segmentRationale";

const brief = { primaryAudience: "Dog owners 28-44 who spend on premium pet wellness", includedSegments: ["Premium pet owners"], basis: "brief" };

test("only planner-added segments without a justification are sent to be written", () => {
  const needing = segmentsNeedingRationale([
    { id: "a", source: "User", justification: "" },
    { id: "b", source: "User", justification: "Already explained." },
    { id: "c", source: "ScoutAI", justification: "" },
  ] as any[]);
  assert.deepEqual(needing.map((s: any) => s.id), ["a"]);
});

test("a segment request needs the plan's audience and at least one segment", () => {
  assert.equal(sanitizeSegmentRationaleRequest({ segments: [{ id: "a", name: "Pet Owners" }] }), null);
  assert.equal(sanitizeSegmentRationaleRequest({ briefOfRecord: brief, segments: [] }), null);
  const request = sanitizeSegmentRationaleRequest({ briefOfRecord: brief, segments: [{ id: "a", name: "Pet Owners", dimension: "Demographics" }, { id: "a", name: "Duplicate" }] });
  assert.deepEqual(request?.segments, [{ id: "a", name: "Pet Owners", dimension: "Demographics" }]);
});

test("answers are matched by id or name, unrequested ones are dropped, and a statistic never reaches the client", () => {
  const requested = [{ id: "user-pet-owners", name: "Pet Owners", dimension: "Demographics" }, { id: "user-movers", name: "Recent Movers", dimension: "Behavioral" }];
  const result = normalizeSegmentRationale({
    segments: [
      { id: "user-pet-owners", justification: "Identifies households that buy premium pet food and supplies. It covers 40% of them." },
      { id: "Recent Movers", justification: "Reaches households setting up a new home and its routines." },
      { id: "user-other", justification: "Not requested, so this one is dropped." },
    ],
  }, requested);
  assert.deepEqual(result, [
    { id: "user-pet-owners", justification: "Identifies households that buy premium pet food and supplies." },
    { id: "user-movers", justification: "Reaches households setting up a new home and its routines." },
  ]);
});
