import assert from "node:assert/strict";
import test from "node:test";
import { SHARE_VIEWER_ACTOR } from "../storage/types";
import { knownPeople, suggestNames } from "./knownPeople";

const plan = (createdBy: string, createdAt: string) => ({ createdBy, createdAt });

test("one person under several capitalisations is suggested once, under their latest spelling", () => {
  const people = knownPeople([plan("tj pascal", "2026-09-01T00:00:00Z"), plan("TJ Pascal", "2026-10-01T00:00:00Z")], []);
  assert.deepEqual(people.map((p) => [p.name, p.plans]), [["TJ Pascal", 2]]);
});

test("suggestions start after two characters and match the start of any word", () => {
  const people = knownPeople([plan("TJ Pascal", "2026-10-01T00:00:00Z"), plan("Ana Smith", "2026-10-01T00:00:00Z")], []);
  assert.deepEqual(suggestNames(people, "p"), []);
  assert.deepEqual(suggestNames(people, "pa").map((p) => p.name), ["TJ Pascal"]);
  assert.deepEqual(suggestNames(people, "sm").map((p) => p.name), ["Ana Smith"]);
  assert.deepEqual(suggestNames(people, "as"), [], "the middle of a word is not a match");
});

test("the spelling with the most plans comes first, so people pick their usual name", () => {
  const people = knownPeople(
    [plan("TJ", "2026-10-01T00:00:00Z"), plan("TJ Pascal", "2026-10-01T00:00:00Z"), plan("TJ Pascal", "2026-10-02T00:00:00Z")],
    [{ actor: "T.J.", at: "2026-10-03T00:00:00Z" }],
  );
  assert.deepEqual(suggestNames(people, "tj").map((p) => [p.name, p.plans]), [["TJ Pascal", 2], ["TJ", 1], ["T.J.", 0]]);
});

test("placeholders, client share viewers and excluded test accounts are never suggested", () => {
  const people = knownPeople(
    [plan("unknown", "2026-10-01T00:00:00Z"), plan("QA Bot", "2026-10-01T00:00:00Z")],
    [{ actor: SHARE_VIEWER_ACTOR, at: "2026-10-01T00:00:00Z" }],
    ["qa bot"],
  );
  assert.deepEqual(people, []);
});
