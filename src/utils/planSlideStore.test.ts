import assert from "node:assert/strict";
import test from "node:test";
import { clearPlanSlides, movePlanSlides, readPlanSlides, UNSAVED_PLAN_SLIDE_KEY, writePlanSlides } from "./planSlideStore";

const none = () => [] as string[];

test("one plan's generated slides never show in another plan's studio", () => {
  writePlanSlides("plan-a", "studio.personas", none, ["a-slide"]);
  assert.deepEqual(readPlanSlides("plan-b", "studio.personas", none), []);
  assert.deepEqual(readPlanSlides("plan-a", "studio.personas", none), ["a-slide"]);
});

test("switching back to a plan brings back the slides made for it", () => {
  writePlanSlides("plan-c", "executiveBrief", none, ["c-1"]);
  writePlanSlides("plan-d", "executiveBrief", none, ["d-1"]);
  writePlanSlides("plan-c", "executiveBrief", none, (prev) => [...prev, "c-2"]);
  assert.deepEqual(readPlanSlides("plan-c", "executiveBrief", none), ["c-1", "c-2"]);
});

test("each section of a plan keeps its own slides", () => {
  writePlanSlides("plan-e", "studio.channels", none, ["channel"]);
  assert.deepEqual(readPlanSlides("plan-e", "studio.segments", none), []);
});

test("saving an unsaved plan keeps the slides made before it had an id", () => {
  writePlanSlides(UNSAVED_PLAN_SLIDE_KEY, "studio.segments", none, ["draft-slide"]);
  movePlanSlides(UNSAVED_PLAN_SLIDE_KEY, "plan-f");
  assert.deepEqual(readPlanSlides("plan-f", "studio.segments", none), ["draft-slide"]);
  assert.deepEqual(readPlanSlides(UNSAVED_PLAN_SLIDE_KEY, "studio.segments", none), []);
});

test("starting a new unsaved plan clears the previous unsaved plan's slides only", () => {
  writePlanSlides(UNSAVED_PLAN_SLIDE_KEY, "studio.personas", none, ["old-draft"]);
  writePlanSlides("plan-g", "studio.personas", none, ["kept"]);
  clearPlanSlides(UNSAVED_PLAN_SLIDE_KEY);
  assert.deepEqual(readPlanSlides(UNSAVED_PLAN_SLIDE_KEY, "studio.personas", none), []);
  assert.deepEqual(readPlanSlides("plan-g", "studio.personas", none), ["kept"]);
});
