import { test } from "node:test";
import assert from "node:assert/strict";
import { generateClonedPlanTitle } from "./planNaming";

test("generates '(Copy)' for first clone", () => {
  const result = generateClonedPlanTitle("Spring Campaign", ["Spring Campaign", "Summer Blast"]);
  assert.equal(result, "Spring Campaign (Copy)");
});

test("generates '(Copy 2)' when '(Copy)' already exists", () => {
  const result = generateClonedPlanTitle("Spring Campaign", [
    "Spring Campaign",
    "Spring Campaign (Copy)",
  ]);
  assert.equal(result, "Spring Campaign (Copy 2)");
});

test("generates '(Copy 3)' when cloning a copy", () => {
  const result = generateClonedPlanTitle("Spring Campaign (Copy 2)", [
    "Spring Campaign",
    "Spring Campaign (Copy)",
    "Spring Campaign (Copy 2)",
  ]);
  assert.equal(result, "Spring Campaign (Copy 3)");
});

test("picks up next sequence number even with gaps or reordered list", () => {
  const result = generateClonedPlanTitle("Holiday Plan", [
    "Holiday Plan",
    "Holiday Plan (Copy 4)",
  ]);
  assert.equal(result, "Holiday Plan (Copy 5)");
});

test("handles case-insensitivity cleanly", () => {
  const result = generateClonedPlanTitle("Holiday Plan", [
    "holiday plan",
    "HOLIDAY PLAN (COPY)",
  ]);
  assert.equal(result, "Holiday Plan (Copy 2)");
});

test("handles empty or untitled strings safely", () => {
  const result = generateClonedPlanTitle("", []);
  assert.equal(result, "Untitled Plan (Copy)");
});
