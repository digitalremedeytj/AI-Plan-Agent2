import assert from "node:assert/strict";
import test from "node:test";
import { exportProfileToMarkdown } from "./markdownExporter";

// Every other section is hidden, so the test needs only what the learnings section reads.
const OTHERS = ["intro", "personas", "segments", "domainAffinity", "deviceShare", "demographics", "temporal", "channels", "executiveSummary", "sources"];
const profile = (overrides: Record<string, unknown> = {}): any => ({
  intro: "Intro.", personas: [], takeaways: ["A takeaway."], recommendations: [], sources: [], hiddenSections: OTHERS,
  performanceLearnings: [
    { campaignId: "c1", campaignName: "Feb 9, 2026 to Mar 10, 2026", findingId: "f1", learning: "Online video brought in checkouts at a $20.04 CPA.", action: "This plan keeps online video in the mix." },
  ],
  ...overrides,
});

test("the export carries the campaign-history learnings once the planner has shown them", () => {
  const md = exportProfileToMarkdown(profile(), false, false);
  assert.match(md, /## Built on Your Campaign History/);
  assert.match(md, /\*From Feb 9, 2026 to Mar 10, 2026\*/);
  assert.match(md, /1\. Online video brought in checkouts at a \$20\.04 CPA\.\n   - \*\*What this plan does\*\*: This plan keeps online video in the mix\./);
  assert.ok(md.indexOf("## Key Insights") < md.indexOf("## Built on Your Campaign History"));
});

test("learnings still hidden from the client stay out of the export", () => {
  assert.doesNotMatch(exportProfileToMarkdown(profile({ hiddenSections: [...OTHERS, "performanceLearnings"] }), false, false), /Campaign History/);
  assert.doesNotMatch(exportProfileToMarkdown(profile({ performanceLearnings: [] }), false, false), /Campaign History/);
});
