import test from "node:test";
import assert from "node:assert/strict";
import { isUserAddedPublisher, publisherRationale } from "../types";
import {
  buildPublisherRationaleInput,
  normalizePublisherRationale,
  publishersNeedingRationale,
  sanitizePublisherRationaleRequest,
} from "./publisherRationale";

const pool = [
  { name: "Discovery+", category: "App", notes: "Include for Female Focused Audience" },
  { name: "ESPN", category: "Network", notes: "" },
];
const brief = { primaryAudience: "Dog owners 28-44 who spend on premium pet wellness", includedSegments: ["Premium pet owners"], basis: "brief" };

test("only publishers without a real justification are sent to be written", () => {
  const needing = publishersNeedingRationale([
    { publisher: "Hulu", why: "Hulu's originals reach young professional dog owners." },
    { publisher: "ESPN", why: "" },
    { publisher: "Discovery+", why: "Include for Female Focused Audience" },
  ]);
  assert.deepEqual(needing.map((p) => p.publisher), ["ESPN", "Discovery+"]);
});

test("a planner-added publisher with a written justification shows it; a stock targeting note never shows", () => {
  assert.equal(publisherRationale({ publisher: "ESPN", category: "Network", why: "Live sports reach active owners.", isUserAdded: true }), "Live sports reach active owners.");
  assert.equal(publisherRationale({ publisher: "Discovery+", category: "App", why: "Include as often as possible" }), "");
  // Still recorded as the planner's, so the flag keeps its meaning once a 'why' is written.
  assert.equal(isUserAddedPublisher({ publisher: "ESPN", category: "Network", why: "Live sports reach active owners.", isUserAdded: true }), true);
});

test("targeting notes come from the server's publisher list, and names are matched however they are written", () => {
  const request = sanitizePublisherRationaleRequest(
    { briefOfRecord: brief, publishers: [{ publisher: "discovery plus", category: "OS" }, { publisher: "Discovery+" }, { publisher: "Local Station 5", category: "Network" }] },
    pool,
  );
  assert.ok(request);
  assert.deepEqual(request.publishers, [
    { publisher: "Discovery+", category: "App", note: "Include for Female Focused Audience" },
    { publisher: "Local Station 5", category: "Network", note: "" },
  ]);
  assert.match(buildPublisherRationaleInput(request), /Dog owners 28-44/);
});

test("a request with no audience or no publishers is refused rather than sent to the model", () => {
  assert.equal(sanitizePublisherRationaleRequest({ briefOfRecord: brief, publishers: [] }, pool), null);
  assert.equal(sanitizePublisherRationaleRequest({ publishers: [{ publisher: "ESPN" }] }, pool), null);
});

test("an answer never reaches the client with a tier or a statistic in it, and only requested publishers are kept", () => {
  const requested = [{ publisher: "ESPN", category: "Network", note: "" }, { publisher: "Discovery+", category: "App", note: "" }];
  const result = normalizePublisherRationale({
    publishers: [
      { publisher: "espn", why: "Live sports reach active, outdoorsy dog owners. As a Tier 1 network it is premium. It reaches 40% of them." },
      { publisher: "Hulu", why: "Not requested, so this must be dropped entirely." },
      { publisher: "Discovery+", why: "Tier 2 pick." },
    ],
  }, requested);
  assert.deepEqual(result, [{ publisher: "ESPN", why: "Live sports reach active, outdoorsy dog owners." }]);
});

test("an answer is still matched when the model repeats the category after the name", () => {
  const result = normalizePublisherRationale(
    { publishers: [{ publisher: "AMC Networks (Network)", why: "Premium drama reaches truck owners who value durability." }] },
    [{ publisher: "AMC Networks", category: "Network", note: "" }],
  );
  assert.deepEqual(result, [{ publisher: "AMC Networks", why: "Premium drama reaches truck owners who value durability." }]);
});
