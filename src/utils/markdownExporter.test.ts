import assert from "node:assert/strict";
import test from "node:test";
import { exportProfileToMarkdown } from "./markdownExporter";
import { geoSnapshotFromBrief } from "../planning/geoFootprint";
import { rfpStrategy } from "../planning/testing/rfpPlans";
import { combinedPlan } from "../planning/planChannels";

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

test("a geo footprint hidden from the share link stays out of the export", () => {
  const geoTargeting = geoSnapshotFromBrief({ type: "DMA", targets: ["Boston (Manchester), MA"] });
  assert.match(exportProfileToMarkdown(profile(), false, false, geoTargeting), /Geo Targeting Footprint/);
  assert.doesNotMatch(exportProfileToMarkdown(profile({ hiddenSections: [...OTHERS, "geo"] }), false, false, geoTargeting), /Geo Targeting Footprint/);
});

test("a channel's Evidence panel hidden from the share link stays out of the export", () => {
  const strategy = rfpStrategy("incremental", 25_000);
  const shown = OTHERS.filter((section) => section !== "channels");
  const allocation = (md: string) => md.split("### Channel Allocation")[1].split("\n### ")[0];
  const visible = exportProfileToMarkdown(profile({ hiddenSections: shown, channelStrategy: strategy }), false, false);
  assert.match(allocation(visible), /Media Consumption Evidence/, "the fixture carries evidence to hide");
  // Kept-at-RFP rows and planned channels alike: every card on screen.
  const channelOverrides = Object.fromEntries(combinedPlan(strategy).channels.map((c) => [c.channelId, { hiddenPanels: ["evidence"] }]));
  const hidden = exportProfileToMarkdown(profile({ hiddenSections: shown, channelStrategy: { ...strategy, channelOverrides } }), false, false);
  assert.doesNotMatch(allocation(hidden), /Media Consumption Evidence/);
});
