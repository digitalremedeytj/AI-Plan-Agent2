import test from "node:test";
import assert from "node:assert/strict";
import { normalizePlanText, parsePlanText } from "./planText";

const RUN_TOGETHER = "This CTV lineup connects through three pillars: * **Family & Primetime Co-Viewing (Hulu, Peacock)**: Delivers living room scale. * **Lifestyle & Daily Context (HGTV)**: Aligns with routines. * **FAST Scale (Tubi, Pluto)**: Expands reach.";

test("bullets the model ran together on one line are split onto their own lines, without markdown", () => {
  assert.equal(
    normalizePlanText(RUN_TOGETHER),
    [
      "This CTV lineup connects through three pillars:",
      "- Family & Primetime Co-Viewing (Hulu, Peacock): Delivers living room scale.",
      "- Lifestyle & Daily Context (HGTV): Aligns with routines.",
      "- FAST Scale (Tubi, Pluto): Expands reach.",
    ].join("\n"),
  );
});

test("markdown bullets and emphasis on their own lines become plain '- ' bullets", () => {
  assert.equal(normalizePlanText("Lead in.\n* **Reach**: wide\n• _plain_ *soft* point\n1. First"), "Lead in.\n- Reach: wide\n- _plain_ soft point\n- First");
});

test("a dash inside prose is not mistaken for a bullet", () => {
  const prose = "Streaming - especially FAST - reaches cord-cutters at 5 * 2 scale.";
  assert.equal(normalizePlanText(prose), prose);
});

test("parsed text keeps the lead-in paragraph and labels each bullet", () => {
  const blocks = parsePlanText(RUN_TOGETHER);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0], { type: "paragraph", text: "This CTV lineup connects through three pillars:" });
  assert.equal(blocks[1].type, "list");
  if (blocks[1].type !== "list") return;
  assert.deepEqual(blocks[1].items[0], { label: "Family & Primetime Co-Viewing (Hulu, Peacock)", text: "Delivers living room scale." });
  assert.equal(blocks[1].items.length, 3);
});

test("a bullet that is a sentence with a colon is not given a label", () => {
  const [list] = parsePlanText("- Pet parents watch in the evening. Timing matters: target 7-10pm.");
  assert.deepEqual(list, { type: "list", items: [{ text: "Pet parents watch in the evening. Timing matters: target 7-10pm." }] });
});

test("plain prose stays a single paragraph", () => {
  assert.deepEqual(parsePlanText("One paragraph of prose."), [{ type: "paragraph", text: "One paragraph of prose." }]);
});
