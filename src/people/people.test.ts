import assert from "node:assert/strict";
import test from "node:test";
import { buildDashboard } from "../usage/dashboard";
import { DEFAULT_DASHBOARD_CONFIG, SHARE_VIEWER_ACTOR, type UsageEvent } from "../storage/types";
import { applyPeopleEdit, ensurePerson, indexPeople, withCanonicalActors, withCanonicalAuthors, type Person } from "./people";

const NOW = "2026-10-29T00:00:00.000Z";
const tj: Person = { email: "tpascal@digitalremedy.com", displayName: "TJ Pascal", aliases: ["TJ", "t.j."], firstSignInAt: NOW };

let n = 0;
const event = (actor: string, action = "plan_generate", at = "2026-10-20T12:00:00.000Z"): UsageEvent => ({ id: `e${++n}`, at, actor, action, ok: true });

test("a person's old typed names resolve to their current display name", () => {
  const index = indexPeople([tj]);
  const events = withCanonicalActors([event("tj"), event("T.J."), event("TJ Pascal"), event("Ana")], index);
  assert.deepEqual(events.map((e) => e.actor), ["TJ Pascal", "TJ Pascal", "TJ Pascal", "Ana"]);
});

test("old names merge into one row on the leadership dashboard", () => {
  const events = withCanonicalActors([event("TJ"), event("t.j."), event("Ana")], indexPeople([tj]));
  const data = buildDashboard(events, "2026-10-01T00:00:00.000Z", "2026-10-29T00:00:00.000Z", DEFAULT_DASHBOARD_CONFIG);
  assert.deepEqual(data.allUsers, ["Ana", "TJ Pascal"]);
});

test("names nobody has claimed stay their own person", () => {
  const events = withCanonicalActors([event("Chris"), event(SHARE_VIEWER_ACTOR, "share_view")], indexPeople([tj]));
  assert.deepEqual(events.map((e) => e.actor), ["Chris", SHARE_VIEWER_ACTOR]);
});

test("removing an alias splits that name's records back out", () => {
  const edit = applyPeopleEdit([tj], [{ ...tj, aliases: ["TJ"] }]);
  assert.ok("people" in edit);
  const events = withCanonicalActors([event("TJ"), event("t.j.")], indexPeople(edit.people));
  assert.deepEqual(events.map((e) => e.actor), ["TJ Pascal", "t.j."]);
});

test("plan creators resolve the same way, so 'My plans' finds plans saved under an old name", () => {
  const [plan] = withCanonicalAuthors([{ createdBy: "tj", updatedBy: "Ana" }], indexPeople([tj]));
  assert.deepEqual(plan, { createdBy: "TJ Pascal", updatedBy: "Ana" });
});

test("renaming someone keeps their old display name as an alias, so past records stay theirs", () => {
  const edit = applyPeopleEdit([tj], [{ ...tj, displayName: "Tj Pascal-Smith" }]);
  assert.ok("people" in edit);
  assert.deepEqual(edit.people[0].aliases, ["TJ", "t.j.", "TJ Pascal"]);
});

test("one name cannot belong to two people", () => {
  const ana: Person = { email: "ana@digitalremedy.com", displayName: "Ana Smith", aliases: [] };
  const edit = applyPeopleEdit([tj, ana], [tj, { ...ana, aliases: ["TJ"] }]);
  assert.ok("error" in edit && edit.error.includes("TJ"));
});

test("placeholder actors like the client share viewer cannot be claimed", () => {
  const edit = applyPeopleEdit([tj], [{ ...tj, aliases: [SHARE_VIEWER_ACTOR] }]);
  assert.ok("error" in edit);
});

test("an edit cannot invent a person who has never signed in", () => {
  const edit = applyPeopleEdit([tj], [tj, { email: "ghost@digitalremedy.com", displayName: "Ghost", aliases: [] }]);
  assert.ok("error" in edit);
});

test("a first Google sign-in adds the person under their Google name", () => {
  const { person, added } = ensurePerson([], "Ana@DigitalRemedy.com", "Ana Smith", NOW);
  assert.equal(added, true);
  assert.deepEqual(person, { email: "ana@digitalremedy.com", displayName: "Ana Smith", aliases: [], firstSignInAt: NOW });
});

test("a Google name another person already uses is made unique with the email's local part", () => {
  const { person } = ensurePerson([tj], "tj.other@digitalremedy.com", "TJ", NOW);
  assert.equal(person.displayName, "TJ (tj.other)");
});

test("signing in again changes nothing", () => {
  const people = [tj];
  const result = ensurePerson(people, "TPascal@digitalremedy.com", "Someone Else", NOW);
  assert.equal(result.added, false);
  assert.equal(result.people, people);
});
