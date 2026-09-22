import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SegmentRecommendations } from "./SegmentRecommendations";
import type { SegmentRecommendation } from "../types";

const segments: SegmentRecommendation[] = [
  { id: "a", name: "Recent Movers", dimension: "Demographics", justification: "Why", personaIndices: [0], source: "ScoutAI" },
  { id: "b", name: "In-Market SUVs", dimension: "In-Market / Intent", justification: "Why", personaIndices: [0], source: "ScoutAI" },
];

test("editable segments show a remove control for every tag, plus the planner actions", () => {
  const markup = renderToStaticMarkup(
    <SegmentRecommendations segments={segments} personas={[]} status="idle" onRemove={() => {}} />,
  );
  assert.match(markup, /Remove Recent Movers/);
  assert.match(markup, /Remove In-Market SUVs/);
  assert.match(markup, /Suggest more/);
  assert.match(markup, /Add segment/);
  assert.match(markup, /Download segments as CSV/);
});

test("shared links render the tags and key read-only, with no remove, add, suggest or download", () => {
  const markup = renderToStaticMarkup(
    <SegmentRecommendations segments={segments} personas={[]} status="idle" readOnly onRemove={() => {}} />,
  );
  assert.match(markup, /Recent Movers/);
  assert.doesNotMatch(markup, /Remove /);
  assert.doesNotMatch(markup, /Suggest more/);
  assert.doesNotMatch(markup, /Add segment/);
  assert.doesNotMatch(markup, /CSV/);
  assert.match(markup, /Interest &amp; Affinity/);
});

test("a shared plan without segments renders nothing rather than an empty section", () => {
  const markup = renderToStaticMarkup(<SegmentRecommendations segments={[]} personas={[]} status="idle" readOnly />);
  assert.equal(markup, "");
});

test("a saved plan from before segments existed offers to generate them", () => {
  const markup = renderToStaticMarkup(<SegmentRecommendations segments={undefined} personas={[]} status="idle" />);
  assert.match(markup, /Generate segment recommendations/);
});

test("the key lists all four dimensions", () => {
  const markup = renderToStaticMarkup(<SegmentRecommendations segments={segments} personas={[]} status="idle" />);
  for (const label of ["Demographics", "In-Market / Intent", "Interest &amp; Affinity", "Behavioral"]) {
    assert.match(markup, new RegExp(label.replace(/[/]/g, "\\/")));
  }
});
