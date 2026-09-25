import test from "node:test";
import assert from "node:assert/strict";
import { cleanDossierText, researchForPrompt } from "./planContext";

const dossier = `# Audience Research Brief: CTV

**Advertiser:** Jinx (dog & cat nutrition)
**Target Audience:** Health-conscious U.S. dog and cat owners.

---

## 1. Streaming Reach

* **Household Penetration:** 88% of U.S. TV households own a connected TV device.

\`\`\`
┌─────────────────┬───────────┐
│ Age Cohort      │ Share (%) │
├─────────────────┼───────────┤
│ 25–34           │ 22.5%     │
└─────────────────┴───────────┘
\`\`\``;

test("the brief restated at the top of a dossier is dropped, the research is kept", () => {
  const cleaned = cleanDossierText(dossier);
  assert.doesNotMatch(cleaned, /Advertiser|Target Audience/);
  assert.match(cleaned, /88% of U\.S\. TV households/);
});

test("table borders go but table rows and their figures stay", () => {
  const cleaned = cleanDossierText(dossier);
  assert.doesNotMatch(cleaned, /[─┌┐└┘├┤┬┴┼]/);
  assert.match(cleaned, /\| 25–34 \s*\| 22\.5%/);
});

test("a long dossier reaches the prompt whole, where the old 12k cut hid its end", () => {
  const long = `## 1. Findings\n${"Filler research sentence. ".repeat(600)}\nThe closing figure is 41%.`;
  assert.ok(long.length > 12000);
  assert.match(researchForPrompt([{ label: "Temporal & Purchase", text: long }]), /closing figure is 41%/);
});

test("a failed dossier says so instead of sending nothing", () => {
  assert.match(researchForPrompt([{ label: "Demographics", text: "", failed: true }]), /did not complete/);
});
