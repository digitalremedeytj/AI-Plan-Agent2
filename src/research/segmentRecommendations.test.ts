import assert from "node:assert/strict";
import test from "node:test";
import type { SegmentRecommendation } from "../types";
import {
  buildSegmentPrompt,
  buildSegmentResponseSchema,
  classifyCampaignObjective,
  createUserSegment,
  csvCell,
  extractPlanAudiences,
  MAX_PER_DIMENSION,
  MAX_TOTAL_SEGMENTS,
  normalizeSegments,
  orderSegmentsForDisplay,
  profileBaselineFingerprint,
  sanitizeSegmentRequest,
  segmentsToCsv,
  topUpCount,
} from "./segmentRecommendations";

const baseOptions = {
  usablePersonaIndices: [0, 1, 2, 3],
  reservedNames: [],
  existingDimensions: [],
  planAudiences: [],
  maxCount: 14,
};

function raw(name: string, dimension = "Behavioral", extra: Record<string, unknown> = {}) {
  return {
    name,
    dimension,
    justification: "Fits the persona.",
    taxonomyPath: "Interest > Automotive",
    dataSignal: "Transaction & Purchase Data",
    tier: "Core",
    personaIndices: [0],
    fromPlanAudience: null,
    ...extra,
  };
}

function segment(name: string, dimension: SegmentRecommendation["dimension"], extra: Partial<SegmentRecommendation> = {}): SegmentRecommendation {
  return { id: name, name, dimension, justification: "", personaIndices: [], source: "ScoutAI", ...extra };
}

test("duplicate segment names collapse regardless of case and punctuation", () => {
  const out = normalizeSegments({ segments: [raw("In-Market SUVs"), raw("in market suvs"), raw("IN MARKET SUVs!")] }, baseOptions);
  assert.equal(out.length, 1);
});

test("names already on the plan or removed this session are never re-suggested", () => {
  const out = normalizeSegments(
    { segments: [raw("Recent Movers", "Demographics"), raw("Pet Food Buyers")] },
    { ...baseOptions, reservedNames: ["recent movers"] },
  );
  assert.deepEqual(out.map((s) => s.name), ["Pet Food Buyers"]);
});

test("segments built on sensitive attributes are dropped before they reach a client plan", () => {
  const out = normalizeSegments(
    {
      segments: [
        raw("Diabetes Patients"),
        raw("Registered Republican Voters"),
        raw("Hispanic Households", "Demographics"),
        raw("Churchgoers", "Interest & Affinity"),
        raw("Healthy Lifestyle Enthusiasts", "Interest & Affinity"),
      ],
    },
    baseOptions,
  );
  assert.deepEqual(out.map((s) => s.name), ["Healthy Lifestyle Enthusiasts"]);
});

test("hyper-stacked sentence-style segment names are rejected", () => {
  const out = normalizeSegments(
    { segments: [raw("Millennial dog owners who drink kombucha"), raw("Premium Pet Food Buyers")] },
    baseOptions,
  );
  assert.deepEqual(out.map((s) => s.name), ["Premium Pet Food Buyers"]);
});

test("a dimension never exceeds its ceiling, and the ceiling drops Experimental before Core", () => {
  const items = [
    raw("Experimental One", "Behavioral", { tier: "Experimental" }),
    ...Array.from({ length: MAX_PER_DIMENSION }, (_, i) => raw(`Core Buyer ${i}`, "Behavioral")),
  ];
  const out = normalizeSegments({ segments: items }, baseOptions);
  assert.equal(out.length, MAX_PER_DIMENSION);
  assert.ok(out.every((s) => s.tier === "Core"));
});

test("existing segments count toward the ceiling during a top-up", () => {
  const out = normalizeSegments(
    { segments: [raw("New Behavioral"), raw("New Demo", "Demographics")] },
    { ...baseOptions, existingDimensions: Array(MAX_PER_DIMENSION).fill("Behavioral") },
  );
  assert.deepEqual(out.map((s) => s.name), ["New Demo"]);
});

test("persona links to placeholder or out-of-range personas are removed", () => {
  const out = normalizeSegments(
    { segments: [raw("Pet Food Buyers", "Behavioral", { personaIndices: [0, 2, 3, 9, -1, 0] })] },
    { ...baseOptions, usablePersonaIndices: [0, 2] },
  );
  assert.deepEqual(out[0].personaIndices, [0, 2]);
});

test("a segment translated from an uploaded plan audience is marked as coming from the plan", () => {
  const out = normalizeSegments(
    {
      segments: [
        raw("In-Market Pickup Trucks", "In-Market / Intent", { fromPlanAudience: "Truck Intenders" }),
        raw("Outdoor Enthusiasts", "Interest & Affinity", { fromPlanAudience: "Something the plan never listed" }),
      ],
    },
    { ...baseOptions, planAudiences: ["Truck Intenders"] },
  );
  assert.equal(out[0].source, "RFP");
  assert.equal(out[1].source, "ScoutAI");
});

test("legacy dimension labels from the model are mapped onto the four display dimensions", () => {
  const out = normalizeSegments(
    { segments: [raw("New Parents", "Demographic / Life Stage"), raw("Sports Fans", "Interest / Affinity")] },
    baseOptions,
  );
  assert.deepEqual(out.map((s) => s.dimension), ["Demographics", "Interest & Affinity"]);
});

test("display order groups by dimension in legend order, then Core before Expansion", () => {
  const ordered = orderSegmentsForDisplay([
    segment("B-exp", "Behavioral", { tier: "Expansion" }),
    segment("D", "Demographics"),
    segment("B-core", "Behavioral", { tier: "Core" }),
    segment("I", "In-Market / Intent"),
  ]);
  assert.deepEqual(ordered.map((s) => s.name), ["D", "I", "B-core", "B-exp"]);
});

test("an explicit full-funnel focus wins over individual KPIs, and competitors signal conquesting", () => {
  assert.equal(classifyCampaignObjective(["ROAS of $4"], "Full-funnel digital media plan"), "full-funnel");
  assert.equal(classifyCampaignObjective(["ROAS of $4", "Online sales"], "CTV-first digital media plan"), "performance");
  assert.equal(classifyCampaignObjective(["Brand awareness", "Incremental reach"], "CTV-first digital media plan"), "awareness");
  assert.equal(classifyCampaignObjective(["Win share from competitors"], "Full-funnel digital media plan"), "conquesting");
});

test("placeholder personas are withheld from the model but keep their index slot", () => {
  const request = sanitizeSegmentRequest({
    personas: [{ name: "Road Trip Families", age: "30-44" }, { name: "Persona Archetype 2" }, { name: "Weekend Anglers" }],
  });
  assert.equal(request.personas.length, 3);
  assert.equal(request.personas[1], null);
  const { input } = buildSegmentPrompt(request);
  assert.match(input, /\[0\] Road Trip Families/);
  assert.match(input, /\[2\] Weekend Anglers/);
  assert.doesNotMatch(input, /Persona Archetype/);
});

test("request bodies are capped so a crafted payload cannot flood the prompt", () => {
  const request = sanitizeSegmentRequest({
    count: 999,
    advertiserName: "x".repeat(5000),
    personas: Array(10).fill({ name: "P" }),
    removedNames: Array(500).fill("gone"),
  });
  assert.equal(request.count, 14);
  assert.equal(request.advertiserName.length, 200);
  assert.equal(request.personas.length, 4);
  assert.ok(request.removedNames.length <= 40);
});

test("uploaded plan audiences reach the prompt with an instruction to map each one", () => {
  const request = sanitizeSegmentRequest({ planAudiences: ["Truck Intenders"] });
  assert.match(buildSegmentPrompt(request).input, /Truck Intenders[\s\S]*must be represented by at least one segment/);
});

test("the response schema bounds the count and persona indices", () => {
  const schema: any = buildSegmentResponseSchema(8, 14, 4);
  assert.equal(schema.properties.segments.minItems, 8);
  assert.equal(schema.properties.segments.maxItems, 14);
  assert.equal(schema.properties.segments.items.properties.personaIndices.items.maximum, 3);
});

test("plan audiences ignore blank and placeholder values", () => {
  const audiences = extractPlanAudiences([
    { placements: [{ audience: " Truck Intenders " }, { audience: "N/A" }, { audience: "" }, { audience: "Truck Intenders" }] },
  ]);
  assert.deepEqual(audiences, ["Truck Intenders"]);
});

test("suggest-more refills to the AI target, then adds a few, and stops at the cap", () => {
  assert.equal(topUpCount(9), 5);
  assert.equal(topUpCount(14), 3);
  assert.equal(topUpCount(19), 1);
  assert.equal(topUpCount(MAX_TOTAL_SEGMENTS), 0);
});

test("a planner-added segment needs a name and dimension and cannot duplicate or exceed the cap", () => {
  const existing = [segment("Recent Movers", "Demographics")];
  assert.ok(createUserSegment({ name: " ", dimension: "Behavioral" }, existing).error);
  assert.ok(createUserSegment({ name: "Boat Owners", dimension: "" }, existing).error);
  assert.ok(createUserSegment({ name: "recent movers", dimension: "Demographics" }, existing).error);
  const full = Array.from({ length: MAX_TOTAL_SEGMENTS }, (_, i) => segment(`S${i}`, "Behavioral"));
  assert.ok(createUserSegment({ name: "Boat Owners", dimension: "Behavioral" }, full).error);

  const added = createUserSegment({ name: "Boat Owners", dimension: "Interest & Affinity" }, existing);
  assert.equal(added.segment?.source, "User");
  assert.equal(added.segment?.dimension, "Interest & Affinity");
});

test("CSV cells neutralise spreadsheet formulas and quote embedded commas and quotes", () => {
  assert.equal(csvCell("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"");
  assert.equal(csvCell("-5 index"), "'-5 index");
  assert.equal(csvCell("Parents, Young Kids"), "\"Parents, Young Kids\"");
  assert.equal(csvCell("Plain"), "Plain");
});

test("the CSV lists personas served by name and labels where each segment came from", () => {
  const csv = segmentsToCsv(
    [segment("Boat Owners", "Behavioral", { personaIndices: [1], source: "User" })],
    [{ name: "Road Trip Families" }, { name: "Weekend Anglers" }],
  );
  const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
  assert.equal(lines[0], "Segment,Dimension,Justification,IAB Taxonomy Path,Data Signal,Tier,Personas Served,Source");
  assert.equal(lines[1], "Boat Owners,Behavioral,,,,,Weekend Anglers,Planner");
});

test("the auto-save baseline ignores segment and headshot changes but not other profile edits", () => {
  const saved = { intro: "A", personas: [{ name: "P", avatarUrl: "data:old" }], segmentRecommendations: [] };
  const live = { intro: "A", personas: [{ name: "P", avatarUrl: "data:new" }], segmentRecommendations: [segment("X", "Behavioral")] };
  assert.equal(profileBaselineFingerprint(saved), profileBaselineFingerprint(live));
  assert.notEqual(profileBaselineFingerprint(saved), profileBaselineFingerprint({ ...live, intro: "B" }));
});
