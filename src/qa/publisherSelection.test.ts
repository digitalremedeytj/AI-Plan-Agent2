import test from "node:test";
import assert from "node:assert/strict";
import { publisherKey, restorePublisherSelection, settlePublisherSelection } from "./publisherSelection";

const pool = [
  { name: "Hulu", category: "App", enabled: true },
  { name: "Discovery+", category: "App", enabled: true },
  { name: "HGTV", category: "Network", enabled: true },
  { name: "Roku", category: "OS", enabled: true },
  { name: "Peacock", category: "App", enabled: false },
];

test("a publisher picked twice appears once, and the plan says it was de-duplicated", () => {
  const profile = { ctvPublishers: [{ publisher: "Hulu", why: "a" }, { publisher: "hulu", why: "b" }, { publisher: "HGTV", why: "c" }] };
  const alerts = settlePublisherSelection(profile, pool, 2);
  assert.deepEqual(profile.ctvPublishers.map((p: any) => p.publisher), ["Hulu", "HGTV"]);
  assert.ok(alerts.some((a) => /duplicate/.test(a.message)));
  assert.ok(!alerts.some((a) => /requested/.test(a.message)));
});

test("picks outside the enabled pool are removed, including disabled publishers", () => {
  const profile = { ctvPublishers: [{ publisher: "Netflix" }, { publisher: "Peacock" }, { publisher: "Roku" }] };
  const alerts = settlePublisherSelection(profile, pool, 3);
  assert.deepEqual(profile.ctvPublishers.map((p: any) => p.publisher), ["Roku"]);
  assert.match(alerts[0].message, /Netflix, Peacock/);
  assert.match(alerts[1].message, /1 of the 3/);
});

test("the category comes from the admin's publisher list, not the model", () => {
  const profile = { ctvPublishers: [{ publisher: "discovery plus", category: "Network" }] };
  settlePublisherSelection(profile, pool, 1);
  assert.deepEqual(profile.ctvPublishers[0], { publisher: "Discovery+", category: "App" });
  assert.equal(publisherKey("A&E"), publisherKey("A and E"));
});

test("remediation can rewrite a publisher's rationale but not change which publishers are selected", () => {
  const settled = [{ publisher: "Hulu", category: "App", why: "old" }, { publisher: "Roku", category: "OS", why: "old" }];
  const target = { ctvPublishers: [{ publisher: "Hulu", category: "Network", why: "new rationale" }, { publisher: "Tubi", why: "x" }] };
  const { changed } = restorePublisherSelection(target, settled);
  assert.equal(changed, true);
  assert.deepEqual(target.ctvPublishers, [
    { publisher: "Hulu", category: "App", why: "new rationale" },
    { publisher: "Roku", category: "OS", why: "old" },
  ]);
});
