import test from "node:test";
import assert from "node:assert/strict";
import { applyPortraits, buildPortraitInput, buildPortraitResponseSchema } from "./personaPortraits";

const brief = (index: number, extra: Record<string, unknown> = {}) => ({
  index, apparentAge: 34, gender: "woman", ethnicity: "Hispanic / Latina", ethnicityBasis: "market population",
  appearance: "shoulder-length dark curls, freckles", wardrobe: "zip fleece", setting: "a sunlit trailhead", expression: "easy laugh", ...extra,
});

test("each casting brief lands on the persona it was written for", () => {
  const personas: any[] = [{ name: "Outdoor Active Mom" }, { name: "Cord-Cutting Sports Fan" }];

  const attached = applyPortraits(personas, { portraits: [brief(1, { gender: "man", setting: "a sports bar" }), brief(0)] });

  assert.equal(attached, 2);
  assert.equal(personas[0].portrait.setting, "a sunlit trailhead");
  assert.equal(personas[1].portrait.gender, "man");
});

test("a brief missing what the headshot needs is dropped, leaving the standard prompt", () => {
  const personas: any[] = [{ name: "A" }, { name: "B" }, { name: "C" }];

  const attached = applyPortraits(personas, { portraits: [brief(0, { apparentAge: "unknown" }), brief(1, { appearance: " " }), brief(7)] });

  assert.equal(attached, 0);
  assert.ok(personas.every((p) => !p.portrait));
});

test("a failed casting call leaves every persona on the standard prompt", () => {
  const personas: any[] = [{ name: "A" }];

  assert.equal(applyPortraits(personas, null), 0);
  assert.equal(personas[0].portrait, undefined);
});

test("the casting call sees every persona and the demographics research, and must return one brief each", () => {
  const input = buildPortraitInput([{ name: "Outdoor Active Mom", age: "25 - 44" }, { name: "Retiree Traveler", age: "65+" }], "Hispanic adults are 31% of buyers.", "Colorado");
  const schema: any = buildPortraitResponseSchema(2);

  assert.match(input, /\[0\] Outdoor Active Mom\. Age 25 - 44/);
  assert.match(input, /\[1\] Retiree Traveler/);
  assert.match(input, /Hispanic adults are 31% of buyers\./);
  assert.match(input, /MARKET: Colorado/);
  assert.equal(schema.properties.portraits.minItems, 2);
  assert.equal(schema.properties.portraits.maxItems, 2);
});
