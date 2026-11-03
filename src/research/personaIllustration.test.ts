import test from "node:test";
import assert from "node:assert/strict";
import { ILLUSTRATION_STYLE, buildIllustrationPrompt, isHeadshotStyle } from "./personaIllustration";

test("a redraw keeps the person in the reference and carries the full art direction", () => {
  const prompt = buildIllustrationPrompt({ name: "Outdoor Active Mom" }, { hasReference: true, instruction: "add a scarf" });
  assert.match(prompt, /same individual/);
  assert.match(prompt, /add a scarf/);
  assert.ok(prompt.includes(ILLUSTRATION_STYLE));
  assert.match(prompt, /#5856fd, #00B3AA, #b2cb3b, #006987/);
});

test("a fresh illustration is cast from the brief but never takes the photo setting", () => {
  const prompt = buildIllustrationPrompt(
    { name: "Mom", portrait: { apparentAge: 34, gender: "woman", ethnicity: "Hispanic / Latina", appearance: "dark curls", wardrobe: "zip fleece", setting: "a sunlit trailhead", expression: "easy laugh" } },
    { hasReference: false },
  );
  assert.match(prompt, /34 year old Hispanic \/ Latina woman/);
  assert.match(prompt, /zip fleece/);
  assert.doesNotMatch(prompt, /trailhead/);
});

test("an unknown style from the browser falls back rather than reaching the prompt", () => {
  assert.equal(isHeadshotStyle("illustration"), true);
  assert.equal(isHeadshotStyle("watercolor"), false);
});
