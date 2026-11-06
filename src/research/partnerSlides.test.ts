import test from "node:test";
import assert from "node:assert/strict";
import type { PartnerEvidence } from "./partnerData";
import { clip, partnerSlideFileName, partnerSlides } from "./partnerSlides";

const evidence = (overrides: Partial<PartnerEvidence> = {}): PartnerEvidence => ({
  capturedAt: "2026-11-05T00:00:00Z",
  providers: [{ id: "mediaradar", name: "MediaRadar", description: "", logoUrl: "", color: "#000", kind: "licensed" }],
  datasets: [{ id: "d1", provider: "mediaradar", providerLabel: "MediaRadar", description: "Spend", markets: [], period: "2026", factCount: 40 }],
  factCount: 40,
  competitive: {
    datasetId: "d1", provider: "mediaradar", providerLabel: "MediaRadar", scope: "Portfolio", period: "2026",
    competitors: [{ name: "Xfinity", spend: 6886967 }], mediaTypes: [],
    markets: [{ market: "Boston", leader: "Xfinity" }, { market: "Detroit", leader: "Xfinity" }, { market: "Albany", leader: "Spectrum" }],
    highlights: [],
  },
  ...overrides,
});

test("every section the plan shows gets a slide, in deck order", () => {
  assert.deepEqual(partnerSlides(evidence(), { dataPartners: false, competitive: false }).map((s) => s.kind), ["partners", "competitors", "markets"]);
});

test("a section hidden from the client is never exported", () => {
  assert.deepEqual(partnerSlides(evidence(), { dataPartners: true, competitive: false }).map((s) => s.kind), ["competitors", "markets"]);
  assert.deepEqual(partnerSlides(evidence(), { dataPartners: false, competitive: true }).map((s) => s.kind), ["partners"]);
});

test("a market table of one or two rows does not get a slide of its own", () => {
  const e = evidence();
  e.competitive!.markets = e.competitive!.markets.slice(0, 2);
  assert.deepEqual(partnerSlides(e, { dataPartners: false, competitive: false }).map((s) => s.kind), ["partners", "competitors"]);
  assert.deepEqual(partnerSlides(null, { dataPartners: false, competitive: false }), []);
});

test("slide files are named for the advertiser, the slide and the ratio", () => {
  assert.equal(partnerSlideFileName("Gateway Fiber", "competitors", "16:9", "png"), "gateway_fiber_data_partners_competitive_spend_16x9.png");
  assert.equal(partnerSlideFileName("", "all", "4:3", "pdf"), "plan_data_partners_4x3.pdf");
});

test("long text is shortened at a word for a slide card", () => {
  assert.equal(clip("Resonate measures the composition of online adults across four DMAs", 30), "Resonate measures the…");
  assert.equal(clip("short", 30), "short");
});
