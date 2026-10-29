import assert from "node:assert/strict";
import test from "node:test";
import { buildDashboard } from "../usage/dashboard";
import { DEFAULT_DASHBOARD_CONFIG, SHARE_VIEWER_ACTOR, type UsageEvent } from "../storage/types";
import { applyPeopleEdit as applyEdit, ensurePerson, indexPeople, parsePeopleList, removedPersonNamed, roleFor, withCanonicalActors, withCanonicalAuthors, type Person } from "./people";

const applyPeopleEdit = (stored: Person[], edited: unknown) => applyEdit(stored, edited, ["digitalremedy.com"]);

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

test("an admin can add someone before their first sign-in, with their old names already linked", () => {
  const edit = applyPeopleEdit([tj], [tj, { email: "Ana@DigitalRemedy.com", displayName: "Ana Smith", aliases: ["ana"] }]);
  assert.ok("people" in edit);
  assert.deepEqual(edit.people[1], { email: "ana@digitalremedy.com", displayName: "Ana Smith", aliases: ["ana"] });
  const events = withCanonicalActors([event("ana")], indexPeople(edit.people));
  assert.equal(events[0].actor, "Ana Smith", "their old records merge before they ever sign in");
});

test("their first Google sign-in takes the entry the admin prepared, not their Google name", () => {
  const ana: Person = { email: "ana@digitalremedy.com", displayName: "Ana Smith", aliases: ["ana"] };
  const { person, changed, people } = ensurePerson([tj, ana], "ana@digitalremedy.com", "Anastasia Smith-Jones", NOW);
  assert.equal(changed, true);
  assert.deepEqual(person, { ...ana, firstSignInAt: NOW });
  assert.equal(people.length, 2);
});

test("someone outside the allowed domain cannot be added ahead of time", () => {
  const edit = applyPeopleEdit([tj], [tj, { email: "ana@gmail.com", displayName: "Ana", aliases: [] }]);
  assert.ok("error" in edit && edit.error.includes("@digitalremedy.com"));
});

test("someone added ahead of time can be removed until they sign in; after that they stay", () => {
  const ana: Person = { email: "ana@digitalremedy.com", displayName: "Ana Smith", aliases: [] };
  const edit = applyPeopleEdit([tj, ana], []);
  assert.ok("people" in edit);
  assert.deepEqual(edit.people.map((p) => p.email), ["tpascal@digitalremedy.com"]);
});

test("renaming someone who has never signed in does not leave their draft name behind as an alias", () => {
  const ana: Person = { email: "ana@digitalremedy.com", displayName: "ana", aliases: [] };
  const edit = applyPeopleEdit([ana], [{ ...ana, displayName: "Ana Smith" }]);
  assert.ok("people" in edit);
  assert.deepEqual(edit.people[0].aliases, []);
});

test("a pasted list accepts names and emails in the usual shapes and flags lines without an email", () => {
  const { people, invalid } = parsePeopleList(`Ana Smith, ana@digitalremedy.com
Chris Lee <CLee@digitalremedy.com>
pat@digitalremedy.com

just a name`);
  assert.deepEqual(people, [
    { email: "ana@digitalremedy.com", displayName: "Ana Smith" },
    { email: "clee@digitalremedy.com", displayName: "Chris Lee" },
    { email: "pat@digitalremedy.com", displayName: "pat" },
  ]);
  assert.deepEqual(invalid, ["just a name"]);
});

test("a first Google sign-in adds the person under their Google name", () => {
  const { person, changed } = ensurePerson([], "Ana@DigitalRemedy.com", "Ana Smith", NOW);
  assert.equal(changed, true);
  assert.deepEqual(person, { email: "ana@digitalremedy.com", displayName: "Ana Smith", aliases: [], firstSignInAt: NOW });
});

test("a Google name another person already uses is made unique with the email's local part", () => {
  const { person } = ensurePerson([tj], "tj.other@digitalremedy.com", "TJ", NOW);
  assert.equal(person.displayName, "TJ (tj.other)");
});

test("signing in again changes nothing", () => {
  const people = [tj];
  const result = ensurePerson(people, "TPascal@digitalremedy.com", "Someone Else", NOW);
  assert.equal(result.changed, false);
  assert.equal(result.people, people);
});

test("ADMIN_EMAILS are always admins, whatever the directory says", () => {
  assert.equal(roleFor("TPascal@digitalremedy.com", { role: "user" }, ["tpascal@digitalremedy.com"]), "admin");
  assert.equal(roleFor("ana@digitalremedy.com", { role: "editor" }, ["tpascal@digitalremedy.com"]), "editor");
  assert.equal(roleFor("ana@digitalremedy.com", undefined, []), "user");
});

test("roles, departments and the dashboard default are saved; a department must be on the list", () => {
  const ana: Person = { email: "ana@digitalremedy.com", displayName: "Ana Smith", aliases: [] };
  const edit = applyEdit([ana], [{ ...ana, role: "editor", department: "sales", offDashboardByDefault: true }], ["digitalremedy.com"], ["Sales", "sales", " Ops "]);
  assert.ok("people" in edit);
  assert.deepEqual(edit.departments, ["Ops", "Sales"]);
  assert.deepEqual(edit.people[0], { ...ana, role: "editor", department: "Sales", offDashboardByDefault: true });

  const unknown = applyEdit([ana], [{ ...ana, department: "Finance" }], ["digitalremedy.com"], ["Sales"]);
  assert.ok("error" in unknown && unknown.error.includes("Finance"));
  const badRole = applyEdit([ana], [{ ...ana, role: "owner" }], ["digitalremedy.com"], []);
  assert.ok("error" in badRole);
});

test("setting someone back to user stores no role at all", () => {
  const ana: Person = { email: "ana@digitalremedy.com", displayName: "Ana Smith", aliases: [], role: "editor", department: "Sales" };
  const edit = applyEdit([ana], [{ ...ana, role: "user", department: "" }], ["digitalremedy.com"], ["Sales"]);
  assert.ok("people" in edit);
  assert.deepEqual(edit.people[0], { email: "ana@digitalremedy.com", displayName: "Ana Smith", aliases: [] });
});

test("removing access records who and when on the server's clock, not the browser's", () => {
  const ana: Person = { email: "ana@digitalremedy.com", displayName: "Ana Smith", aliases: [], firstSignInAt: NOW };
  const stamp = { by: "TJ Pascal", at: "2026-11-01T09:00:00.000Z" };
  const removed = applyEdit([ana], [{ ...ana, accessRemovedAt: "1999-01-01", accessRemovedBy: "someone else" }], ["digitalremedy.com"], [], stamp);
  assert.ok("people" in removed);
  assert.equal(removed.people[0].accessRemovedAt, stamp.at);
  assert.equal(removed.people[0].accessRemovedBy, "TJ Pascal");

  const again = applyEdit(removed.people, removed.people, ["digitalremedy.com"], [], { by: "Other Admin", at: "2026-12-01T00:00:00.000Z" });
  assert.ok("people" in again);
  assert.equal(again.people[0].accessRemovedBy, "TJ Pascal", "saving again keeps the original removal");

  const restored = applyEdit(removed.people, [{ ...ana }], ["digitalremedy.com"], [], stamp);
  assert.ok("people" in restored);
  assert.equal(restored.people[0].accessRemovedAt, undefined);
});

test("a removed person is found under any of their names, so a typed old name cannot get back in", () => {
  const ana: Person = { email: "ana@digitalremedy.com", displayName: "Ana Smith", aliases: ["ana"], accessRemovedAt: NOW };
  const index = indexPeople([tj, ana]);
  assert.equal(removedPersonNamed(index, " ANA ")?.email, "ana@digitalremedy.com");
  assert.equal(removedPersonNamed(index, "TJ"), undefined);
});
