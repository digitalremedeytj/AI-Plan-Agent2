import test from "node:test";
import assert from "node:assert/strict";
import { exclusionReason, filterCitationPool } from "./sourceFilter";

test("social, forum and homework domains are kept out of the citation pool", () => {
  const { kept, excluded } = filterCitationPool([
    { title: "r/dogs", uri: "https://www.reddit.com/r/dogs/comments/1" },
    { title: "FB", uri: "https://m.facebook.com/groups/x" },
    { title: "Essay", uri: "https://sweetstudy.com/doc" },
    { title: "APPA", uri: "https://www.americanpetproducts.org/research" },
  ]);
  assert.deepEqual(kept.map((s) => s.title), ["APPA"]);
  assert.deepEqual(excluded.map((s) => s.reason), ["forum", "social", "homework site"]);
});

test("a domain is only excluded on an exact or subdomain match, not a lookalike", () => {
  assert.equal(exclusionReason("https://notreddit.com/page"), null);
  assert.equal(exclusionReason("https://www.nielsen.com/insights"), null);
  assert.equal(exclusionReason("not a url"), null);
});
