import test from "node:test";
import assert from "node:assert/strict";
import { extractFindingBlurb } from "./findingBlurb";

// Openings trimmed from real dossiers (the Jinx plan, 9/24/2026).
const demographics = `### Executive Summary & Brand Context

* **Advertiser:** Jinx ([thinkjinx.com](https://www.thinkjinx.com))
* **Business Model:** Hybrid omnichannel (Direct-to-Consumer e-commerce + national retail distribution via Walmart, Chewy, and Amazon).
* **Core Campaign Objective:** Full-funnel digital media plan driving brand discovery, qualified consideration, and profitable conversions (Target KPI: ROAS > 40%).

---

### 1. Age Distribution & Generational Cohorts

* **Millennials (Ages 28–43):** **30%–33%** (Represents the largest share of pet owners in the U.S. and indexes highest for purchasing humanized, premium, and functional foods).`;

const ctv = `# Audience Research Brief: Connected TV (CTV), Video Streaming & Hardware Usage Patterns

**Advertiser:** Jinx (Clean protein, superfood, and probiotic dog & cat nutrition)  
**Target Audience:** Health-conscious U.S. dog and cat owners seeking premium, nutrient-rich nutrition, meal toppers, and treats.  

\`\`\`
| UPPER FUNNEL (CTV / Streaming)     | MID-FUNNEL (Connected Commerce)  |
| • 15s/30s Non-Skip Storytelling    | • Click-to-Cart (Prime Video)    |
\`\`\`

* **Household Penetration:** According to the **Leichtman Research Group (LRG)**, **88% of U.S. TV households** own at least one internet-connected TV device (Smart TV, streaming device, connected console). Connected TV streaming reaches **96.4 million households** nationwide (**Comscore**).`;

const touchpoints = `### Executive Summary & Audience Profile Overview

* **Audience Definition & Core Demographics:** The primary audience for Jinx (\`thinkjinx.com\`) comprises health-conscious dog and cat owners, concentrated within the Millennial and Gen Z demographics (25–44 years old).
* **Psychographic "Pet Humanization":** In national tracking studies conducted by Packaged Facts and Talker Research, 82% to 93% of pet parents view their pets as family members or children. Over 70% of owners report a willingness to pay a premium.`;

test("the brief restated at the top of a dossier is skipped in favour of a real finding", () => {
  assert.equal(
    extractFindingBlurb(touchpoints, "Digital Touchpoints"),
    "In national tracking studies conducted by Packaged Facts and Talker Research, 82% to 93% of pet parents view their pets as family members or children.",
  );
});

test("a figure that opens a line keeps the label it describes", () => {
  assert.equal(
    extractFindingBlurb(demographics, "Demographics"),
    "Millennials (Ages 28–43): 30%–33% (Represents the largest share of pet owners in the U.S. and indexes highest for purchasing humanized, premium, and functional foods).",
  );
});

test("diagrams are ignored and a sentence is not cut at an abbreviation like U.S.", () => {
  assert.equal(
    extractFindingBlurb(ctv, "CTV & Devices"),
    "According to the Leichtman Research Group (LRG), 88% of U.S. TV households own at least one internet-connected TV device (Smart TV, streaming device, connected console).",
  );
});

test("no markdown reaches the console", () => {
  for (const text of [demographics, ctv, touchpoints]) assert.doesNotMatch(extractFindingBlurb(text, "x"), /\*\*|`|\]\(/);
});

test("a dossier with nothing usable falls back to a plain completion line", () => {
  assert.equal(extractFindingBlurb("", "Demographics"), "Completed deep-dive search for Demographics");
  assert.equal(extractFindingBlurb("**Advertiser:** Jinx", "Demographics"), "Completed deep-dive search for Demographics");
});
