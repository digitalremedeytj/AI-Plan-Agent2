import assert from "node:assert/strict";
import test from "node:test";
import { DIGITAL_REMEDY_PRODUCT_REGISTRY } from "../planning/knowledge/registry";
import { DEFAULT_CTV_PUBLISHERS } from "../planning/knowledge/ctvPublishers";
import { platformReports } from "../performance/__fixtures__/load";
import { analyzeReportFiles } from "../performance/index";
import type { LinkedCampaign } from "../assistant/performanceContext";
import { buildGenerationHistory } from "./pastPerformance";

const channels = DIGITAL_REMEDY_PRODUCT_REGISTRY.map((p) => ({ id: p.id, name: p.displayName, aliases: p.aliases }));
const publisherPool = DEFAULT_CTV_PUBLISHERS.map((p) => p.name);

const campaign = (overrides: Partial<LinkedCampaign["campaign"]> = {}, reviewStale = false): LinkedCampaign => ({
  campaign: { id: "c1", name: "Feb 9, 2026 to Mar 10, 2026", advertiserName: "Acme Auto Accessories", campaignGoal: "cpa", flightEnd: "2026-03-10", ...overrides },
  analysis: analyzeReportFiles(platformReports()),
  review: {
    generatedAt: "t", generatedBy: "tj", fingerprint: "x", summary: "Video beat display on CPA.",
    findings: [{ id: "f1", kind: "worked", headline: "Pre-roll beat the campaign CPA", detail: "d", evidence: "e", confidence: "high", area: "media type", unverified: [], causalClaim: null, confidenceNote: null }],
  },
  reviewStale,
});

const build = (linked: LinkedCampaign[], advertiser = "Acme Auto Accessories") => buildGenerationHistory(linked, { advertiser, channels, publisherPool })!;

test("the channel reasoning gets each media type's results mapped to a catalog channel, with the reading rules", () => {
  const brief = build([campaign()]).channelBrief;
  assert.match(brief, /OTT -> channel\.ctv: \$174,138 \(74\.6% of spend\), CPA \$53\.85, PM 0\.44; last-touch credit/);
  assert.match(brief, /Display Retargeting -> channel\.display_retargeting: .*\[retargeting: converts audiences built by other media\]/);
  assert.match(brief, /historical_performance/);
  assert.match(brief, /Never treat last-touch CPA or PM alone as a reason to move budget out of CTV/);
  assert.match(brief, /Pre-roll beat the campaign CPA/, "the saved review's findings come with it");
  assert.match(brief, /never PM or "performance multiplier"/, "client-visible rationale stays in the client's terms");
  assert.match(brief, /Retargeting is the exception/);
});

test("the publisher pick gets CTV publishers ranked and matched to the enabled pool, never media types", () => {
  const brief = build([campaign()]).publisherBrief;
  assert.match(brief, /CBS \(pool: 'CBS'\): CPA \$32\.19, PM 0\.74, ranked 1 of 16/);
  assert.match(brief, /NCAA Basketball \(not in the pool\): CPA \$401, PM 0\.06, ranked 16 of 16/);
  assert.match(brief, /Pluto TV \(pool: 'Pluto', matched by name\)/, "an approximate name match is marked");
  assert.doesNotMatch(brief, /Display Retargeting \(|Pre-Roll\/Mid-Roll \(/);
  assert.match(brief, /never mention PM/);
});

test("only the client's own campaign becomes a citable source; another advertiser's is patterns only", () => {
  const own = build([campaign()]);
  assert.ok(own.dossier);
  assert.match(own.dossier!.label, /the client's own report data/);
  assert.match(own.dossier!.text, /BY MEDIATYPE/);
  const other = build([campaign()], "Other Brand");
  assert.equal(other.dossier, null);
  assert.match(other.channelBrief, /NOT this client's campaign .*patterns only, never cite its figures/);
  assert.deepEqual(other.used, [{ id: "c1", name: "Feb 9, 2026 to Mar 10, 2026", own: false }]);
});

test("an out-of-date review is left out rather than presented as current", () => {
  assert.doesNotMatch(build([campaign({}, true)]).channelBrief, /Pre-roll beat the campaign CPA/);
});

test("at most three campaigns are used, newest first", () => {
  const many = [1, 2, 3, 4].map((n) => campaign({ id: `c${n}`, name: `Flight ${n}`, flightEnd: `2026-0${n}-01` }));
  assert.deepEqual(build(many).used.map((c) => c.name), ["Flight 4", "Flight 3", "Flight 2"]);
});

test("no campaigns means no history at all", () => {
  assert.equal(buildGenerationHistory([], { advertiser: "Acme", channels, publisherPool }), null);
});
