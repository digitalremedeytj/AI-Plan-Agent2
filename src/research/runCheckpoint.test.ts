import test from "node:test";
import assert from "node:assert/strict";
import { buildRunCheckpoint, parseRunCheckpoint } from "./runCheckpoint";

const LABELS = ["Demographics", "Digital Touchpoints", "CTV & Devices", "Temporal & Purchase"] as const;

const brief = {
  advertiser: "Syracuse University",
  whatTheySell: "Undergraduate and graduate degrees",
  productCategories: ["Higher education"],
  businessModel: "Private non-profit research university",
  priceTier: "premium",
  audienceType: "B2C",
  primaryAudience: "Prospective undergraduate students and their families",
  includedSegments: ["Prospective high school students", "Parents of prospective students"],
  excludedSegments: [],
  campaignObjective: "National brand awareness",
  funnelEmphasis: "awareness",
  geography: "National (United States)",
  uncertainties: [],
  basis: "brief + website",
} as const;

function checkpoint() {
  return buildRunCheckpoint({
    profile: { personas: [{ title: "Ambitious Scholar-Athlete" }], ctvPublishers: [{ name: "Hulu" }] },
    research: LABELS.map((label, i) => ({
      label,
      text: `${label} findings`,
      sources: [{ title: "Source", uri: `https://example.com/${i}` }],
      ...(i === 3 ? { failed: true, reason: "timed out after 150s" } : {}),
    })),
    groundingSources: [{ title: "Pew", uri: "https://pewresearch.org/a" }],
    briefOfRecord: { ...brief, productCategories: [...brief.productCategories], includedSegments: [...brief.includedSegments], excludedSegments: [], uncertainties: [] },
    crawl: { url: "https://syracuse.edu/", ok: true, chars: 9000 },
    alerts: [{ section: "research", severity: "flagged", message: "The Temporal & Purchase research did not complete." }],
    log: [{ at: "2026-10-28T12:08:58.000Z", type: "status", message: "Crawling website syracuse.edu" }],
  });
}

test("a checkpoint survives the round trip through the browser, so a retry gets back the research it was built from", () => {
  const sent = JSON.parse(JSON.stringify(checkpoint()));
  const parsed = parseRunCheckpoint(sent, LABELS);
  assert.ok(parsed);
  assert.deepEqual(parsed.research.map((d) => d.label), [...LABELS]);
  assert.equal(parsed.research[0].text, "Demographics findings");
  assert.equal(parsed.research[3].failed, true);
  assert.equal(parsed.briefOfRecord?.primaryAudience, brief.primaryAudience);
  assert.deepEqual(parsed.groundingSources, [{ title: "Pew", uri: "https://pewresearch.org/a" }]);
  assert.deepEqual(parsed.crawl, { url: "https://syracuse.edu/", ok: true, chars: 9000 });
  assert.equal(parsed.alerts.length, 1);
  assert.equal(parsed.log[0].message, "Crawling website syracuse.edu");
  assert.deepEqual(parsed.profile, { personas: [{ title: "Ambitious Scholar-Athlete" }], ctvPublishers: [{ name: "Hulu" }] });
});

test("the checkpoint is a copy, so the run going on to change the plan cannot change what a retry resumes from", () => {
  const profile: any = { personas: [] };
  const built = buildRunCheckpoint({ profile, research: [], groundingSources: [], briefOfRecord: null, alerts: [], log: [] });
  profile.channelStrategy = { partial: true };
  assert.equal("channelStrategy" in built.profile, false);
});

test("a checkpoint whose research does not line up with the run's dossiers is refused rather than half-used", () => {
  const sent: any = JSON.parse(JSON.stringify(checkpoint()));
  sent.research = [sent.research[1], sent.research[0], sent.research[2], sent.research[3]];
  assert.equal(parseRunCheckpoint(sent, LABELS), null);
  assert.equal(parseRunCheckpoint({ ...checkpoint(), research: checkpoint().research.slice(0, 3) }, LABELS), null);
});

test("a missing, malformed or all-failed checkpoint is not resumable", () => {
  assert.equal(parseRunCheckpoint(undefined, LABELS), null);
  assert.equal(parseRunCheckpoint({ version: 2 }, LABELS), null);
  assert.equal(parseRunCheckpoint({ ...checkpoint(), profile: "not a plan" }, LABELS), null);
  const allFailed = { ...checkpoint(), research: checkpoint().research.map((d) => ({ ...d, failed: true })) };
  assert.equal(parseRunCheckpoint(allFailed, LABELS), null);
});

test("unknown alert severities and log entry types from the browser are dropped", () => {
  const sent: any = JSON.parse(JSON.stringify(checkpoint()));
  sent.alerts.push({ section: "qa", severity: "critical", message: "x" });
  sent.log.push({ at: "2026-10-28T12:09:00.000Z", type: "complete", message: "x" });
  const parsed = parseRunCheckpoint(sent, LABELS);
  assert.equal(parsed?.alerts.length, 1);
  assert.equal(parsed?.log.length, 1);
});
