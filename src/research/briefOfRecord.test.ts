import test from "node:test";
import assert from "node:assert/strict";
import { alsoServedSegments, buildBriefOfRecordInput, formatBriefOfRecord, normalizeBriefOfRecord } from "./briefOfRecord";

const jinx = {
  advertiser: "Jinx",
  whatTheySell: "Premium dog and cat food sold direct to consumers.",
  productCategories: ["Dog food", "Cat food"],
  businessModel: "DTC e-commerce with subscription",
  priceTier: "premium",
  audienceType: "B2C",
  primaryAudience: "U.S. dog and cat owners who buy premium pet food online.",
  includedSegments: ["Dog owners", "Cat owners"],
  coreSegments: ["Dog owners", "Cat owners"],
  excludedSegments: [],
  campaignObjective: "Drive site visits and online sales.",
  funnelEmphasis: "full-funnel",
  geography: "United States",
  uncertainties: [],
};

test("every customer group in the brief of record reaches the prompt block, so no step can drop cat owners", () => {
  const brief = normalizeBriefOfRecord(jinx, "brief + website")!;
  const block = formatBriefOfRecord(brief);
  assert.match(block, /Core segments \(build the personas[^:]*: Dog owners; Cat owners/);
  assert.match(block, /do not narrow/);
  assert.doesNotMatch(block, /Out of scope/);
});

test("an unrecognised audience type defaults to consumer rather than unlocking B2B targeting", () => {
  const brief = normalizeBriefOfRecord({ ...jinx, audienceType: "households" }, "brief only")!;
  assert.equal(brief.audienceType, "B2C");
});

test("a brief with no audience at all is discarded instead of steering the plan", () => {
  assert.equal(normalizeBriefOfRecord({ ...jinx, primaryAudience: "", includedSegments: [] }, "brief only"), null);
  assert.equal(normalizeBriefOfRecord("not an object", "brief only"), null);
});

test("the planner's audience description is given to the model ahead of the crawl", () => {
  const input = buildBriefOfRecordInput({
    advertiserName: "PetSmart",
    url: "https://www.petsmart.com/",
    audienceDescription: "Cat owners in the Southwest",
    targetPersonas: [],
    kpis: ["Site visits"],
    campaignFocus: "Full-Funnel",
    geography: "National",
    additionalContext: "",
    crawlText: "Shop dog food, cat food, grooming",
    searchSummary: "",
  });
  assert.ok(input.indexOf("Cat owners in the Southwest") < input.indexOf("Shop dog food"));
});

test("nothing is formatted when there is no brief of record", () => {
  assert.equal(formatBriefOfRecord(null), "");
});

test("an over-long segment label is shortened at a word boundary, not mid-word", () => {
  const long = "Owners of small animals, reptiles, pet birds, and fish needing species-appropriate habitats, nutrition, accessories, lighting, heating, water conditioners, vitamins and a great deal more besides";
  const brief = normalizeBriefOfRecord({ ...jinx, includedSegments: [long] }, "brief only")!;
  assert.ok(brief.includedSegments[0].length <= 163);
  assert.match(brief.includedSegments[0], /[a-z]\.\.\.$/);
  assert.ok(long.startsWith(brief.includedSegments[0].replace(/\.\.\.$/, "")));
  const kept = brief.includedSegments[0].replace(/\.\.\.$/, "");
  assert.ok(!/[a-z]/i.test(long[kept.length]), "the kept text ends on a whole word");
});

test("niche groups the brand serves are on-target but not where the personas are built", () => {
  const brief = normalizeBriefOfRecord({
    ...jinx,
    includedSegments: ["Dog owners", "Cat owners", "Reptile owners", "Backyard bird enthusiasts"],
    coreSegments: ["dog owners", "Cat Owners"],
  }, "brief + website")!;
  assert.deepEqual(alsoServedSegments(brief), ["Reptile owners", "Backyard bird enthusiasts"]);
  const block = formatBriefOfRecord(brief);
  assert.match(block, /Also served \([^)]*\): Reptile owners; Backyard bird enthusiasts/);
});

test("a core segment the model left out of scope is added to it, and a brief with no core falls back to its first groups", () => {
  const added = normalizeBriefOfRecord({ ...jinx, includedSegments: ["Dog owners"], coreSegments: ["Cat owners"] }, "brief only")!;
  assert.deepEqual(added.includedSegments, ["Dog owners", "Cat owners"]);
  const fallback = normalizeBriefOfRecord({ ...jinx, includedSegments: ["A", "B", "C"], coreSegments: [] }, "brief only")!;
  assert.deepEqual(fallback.coreSegments, ["A", "B"]);
});

test("the website's advertiser facts reach every prompt as the only product and offer claims the plan may make", () => {
  const brief = normalizeBriefOfRecord({ ...jinx, advertiserFacts: ["Probiotic dry kibble for dogs", "Sold at Walmart and Chewy"] }, "brief + website")!;
  const block = formatBriefOfRecord(brief);
  assert.match(block, /Verified advertiser facts \(from the advertiser's website; the ONLY products/);
  assert.match(block, /Probiotic dry kibble for dogs; Sold at Walmart and Chewy/);
});

test("with no facts stated, the brief tells writers to describe the category instead of naming products", () => {
  const block = formatBriefOfRecord(normalizeBriefOfRecord({ ...jinx, advertiserFacts: [] }, "brief only")!);
  assert.match(block, /Verified advertiser facts: none stated by the brief\. Describe the category/);
});

test("a brief saved before advertiser facts existed says nothing about them, so older plans are audited as before", () => {
  const { advertiserFacts: _facts, ...legacy } = normalizeBriefOfRecord(jinx, "brief + website")!;
  assert.doesNotMatch(formatBriefOfRecord(legacy), /advertiser facts/i);
});
