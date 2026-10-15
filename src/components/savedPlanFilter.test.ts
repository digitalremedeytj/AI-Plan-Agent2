import assert from "node:assert/strict";
import test from "node:test";
import { filterSavedPlans, planCreators } from "./savedPlanFilter";

const plans = [
  { title: "Acme Q1", createdBy: "Ana", advertiserName: "Acme" },
  { title: "Bolt launch", createdBy: "Ben", advertiserName: "Bolt" },
  { title: "Acme Q2", createdBy: "ana ", advertiserName: "Acme" },
];

test("the list opens on the signed-in person's own plans, however they capitalised their name", () => {
  assert.deepEqual(filterSavedPlans(plans, "MINE", "ANA", "").map((p) => p.title), ["Acme Q1", "Acme Q2"]);
});

test("a plan stays with its creator even after someone else saves it", () => {
  const edited = [{ title: "Bolt launch", createdBy: "Ben", updatedBy: "Ana" }];
  assert.deepEqual(filterSavedPlans(edited, "MINE", "Ana", ""), []);
  assert.equal(filterSavedPlans(edited, { person: "Ben" }, "Ana", "").length, 1);
});

test("searching three or more characters looks across everyone's plans", () => {
  assert.deepEqual(filterSavedPlans(plans, "MINE", "Ana", "bolt").map((p) => p.title), ["Bolt launch"]);
  assert.deepEqual(filterSavedPlans(plans, "MINE", "Ana", "bo").map((p) => p.title), ["Acme Q1", "Acme Q2"], "two characters is not a search yet");
});

test("search matches the creator's name as well as the plan's own fields", () => {
  assert.deepEqual(filterSavedPlans(plans, "MINE", "Ana", "ben").map((p) => p.title), ["Bolt launch"]);
});

test("the person filter lists each creator once", () => {
  assert.deepEqual(planCreators(plans), ["Ana", "Ben"]);
});
