import test from "node:test";
import assert from "node:assert/strict";
import { PARTNER_DOSSIER_LABEL, PARTNER_LICENSED_TIER, toDatasetSummary, type ResearchDataset, type ResearchFact } from "./partnerData";
import {
  allocationInput,
  applyNarrativeChanges,
  attachPartnerResearch,
  competitiveInput,
  competitiveSource,
  factRefs,
  narrativeChanges,
  normalizeAllocationProposals,
  normalizeCompetitive,
  parseFigure,
  proposalOps,
  suggestDatasets,
  verifyCompetitive,
  verifyProposal,
} from "./partnerReinforcement";

let n = 0;
const newId = () => `id-${++n}`;

function fact(statement: string, figure: string, overrides: Partial<ResearchFact> = {}): ResearchFact {
  return {
    id: newId(), statement, figure, measure: "spend", population: "", geography: "", period: "2026",
    location: "", fileName: "spend.xlsx", fromSummary: false, status: "approved", ...overrides,
  };
}

function dataset(facts: ResearchFact[], overrides: Partial<ResearchDataset> = {}): ResearchDataset {
  return {
    id: newId(), revision: 1, title: "Bulldog x Gateway Fiber competitive spend", provider: "mediaradar", providerLabel: "",
    advertiserName: "Gateway Fiber", advertiserKey: "gateway fiber", category: "Home internet / fiber", markets: ["Boston, MA", "Detroit, MI"],
    period: "2026", description: "Competitor advertising spend.", fileCount: 1, fileHashes: [],
    factCounts: { pending: 0, approved: facts.filter((f) => f.status === "approved").length, rejected: 0 },
    extraction: { status: "done", at: "2026-11-05T00:00:00Z" }, createdAt: "", createdBy: "", updatedAt: "", updatedBy: "", archived: false,
    files: [], facts, ...overrides,
  };
}

const spendFacts = () => [
  fact("Xfinity's general competitive advertising spend across the portfolio was $6,886,967.", "$6,886,967"),
  fact("T-Mobile's general competitive advertising spend across the portfolio was $5,867,371.", "$5,867,371"),
  fact("Spectrum's general competitive advertising spend across the portfolio was $1,491,043.", "$1,491,043"),
  fact("General competitive advertising spend on AVOD across the portfolio was $4,986,715.", "$4,986,715"),
  fact("General competitive advertising spend on Mobile App across the portfolio was $2,107,838.", "$2,107,838"),
  fact("Xfinity accounted for 61.0% of reported competitive spend in Boston, MA.", "61.0%", { measure: "share", geography: "Boston, MA" }),
  fact("Xfinity led reported competitive spend in Boston, MA at $4,210,419.", "$4,210,419", { geography: "Boston, MA" }),
  fact("Total combined advertising spend in Boston, MA was $8,104,621.", "$8,104,621", { geography: "Boston, MA" }),
  fact("Gateway Fiber's spend across the portfolio was $90,000.", "$90,000"),
];

test("figures are read the way partners write them", () => {
  assert.equal(parseFigure("$1,832,959"), 1832959);
  assert.equal(parseFigure("1.3M"), 1300000);
  assert.equal(parseFigure("58.7%"), 58.7);
  assert.equal(parseFigure("$2.5 billion"), 2.5e9);
  assert.equal(parseFigure("between 3 and 4"), null);
});

test("the competitive landscape takes its values from the cited figures, not from the model", () => {
  const d = dataset(spendFacts());
  const { refs } = competitiveInput(d, "Gateway Fiber");
  const ref = (text: string) => refs.find((r) => r.fact.statement.includes(text))!.ref;
  const landscape = normalizeCompetitive({
    scope: "Seven-market portfolio",
    competitors: [
      { name: "Xfinity", figure: ref("Xfinity's general") },
      { name: "T-Mobile", figure: ref("T-Mobile's") },
      { name: "Spectrum", figure: ref("Spectrum's") },
      { name: "Verizon", figure: ref("Spectrum's") }, // the figure does not name Verizon
      { name: "Xfinity", figure: ref("Xfinity's general") }, // duplicate
    ],
    mediaTypes: [{ name: "AVOD", figure: ref("on AVOD") }, { name: "Mobile App", figure: ref("on Mobile App") }, { name: "CTV", figure: ref("61.0%") }],
    markets: [{ market: "Boston, MA", totalFigure: ref("Total combined"), leader: "Xfinity", leaderSpendFigure: ref("led reported"), leaderShareFigure: ref("61.0%") }],
  }, d, refs, { planAdvertiser: "Gateway Fiber" });
  assert.ok(landscape);
  assert.deepEqual(landscape.competitors.map((c) => [c.name, c.spend]), [["Xfinity", 6886967], ["T-Mobile", 5867371], ["Spectrum", 1491043]]);
  assert.deepEqual(landscape.mediaTypes.map((c) => c.name), ["AVOD", "Mobile App"], "a share cannot stand in for a spend figure");
  assert.deepEqual(landscape.markets[0], { market: "Boston, MA", totalSpend: 8104621, leader: "Xfinity", leaderSpend: 4210419, leaderShare: 61 });
  assert.match(landscape.highlights[0], /^Xfinity and T-Mobile account for 90% of spend among the 3 competitors shown/);
});

test("in another client's plan, the competitive landscape leaves out the client the data was made for", () => {
  const d = dataset(spendFacts());
  const { refs, input } = competitiveInput(d, "Metronet");
  assert.doesNotMatch(input, /Gateway Fiber/);
  const ref = (text: string) => refs.find((r) => r.fact.statement.includes(text))!.ref;
  const landscape = normalizeCompetitive({
    scope: "Portfolio",
    competitors: [{ name: "Xfinity", figure: ref("Xfinity's general") }, { name: "Gateway Fiber", figure: ref("Gateway Fiber's") }, { name: "Spectrum", figure: ref("Spectrum's") }],
    mediaTypes: [], markets: [],
  }, d, refs, { planAdvertiser: "Metronet" });
  assert.deepEqual(landscape?.competitors.map((c) => c.name), ["Xfinity", "Spectrum"]);
});

test("the plan's own advertiser is marked, not listed as a competitor", () => {
  const d = dataset(spendFacts());
  const { refs } = competitiveInput(d, "Gateway Fiber");
  const ref = (text: string) => refs.find((r) => r.fact.statement.includes(text))!.ref;
  const landscape = normalizeCompetitive({ scope: "x", competitors: [{ name: "Xfinity", figure: ref("Xfinity's general") }, { name: "Gateway Fiber", figure: ref("Gateway Fiber's") }], mediaTypes: [], markets: [] }, d, refs, { planAdvertiser: "Gateway Fiber" });
  assert.equal(landscape?.competitors.find((c) => c.name === "Gateway Fiber")?.isAdvertiser, true);
});

test("a dataset needs several approved spend figures before it can draw a landscape", () => {
  assert.equal(competitiveSource([dataset(spendFacts().slice(0, 3))]), null);
  const rich = dataset(spendFacts());
  assert.equal(competitiveSource([dataset(spendFacts().slice(0, 4)), rich])?.id, rich.id);
});

const channels = [
  { channelId: "ctv", channelName: "CTV", allocationPercent: 40, minPercent: 20, maxPercent: 70 },
  { channelId: "display", channelName: "Display", allocationPercent: 30 },
  { channelId: "social", channelName: "Social", allocationPercent: 30, locked: true },
];

test("a budget move survives only if every figure in its reason is in a figure it cites", () => {
  const d = dataset(spendFacts());
  const refs = factRefs([d]);
  const avod = refs.find((r) => r.fact.statement.includes("on AVOD"))!.ref;
  const base = { channels, addable: [{ channelId: "audio" }], refs, planAdvertiser: "Gateway Fiber", newId };
  const good = normalizeAllocationProposals({ proposals: [{ title: "Shift toward CTV", reason: "MediaRadar shows competitors put $4,986,715 into AVOD.", figures: [avod], moves: [{ channelId: "ctv", percent: 46 }] }] }, base);
  assert.equal(good.length, 1);
  assert.deepEqual(good[0].credits, ["MediaRadar"]);
  const invented = normalizeAllocationProposals({ proposals: [{ title: "Shift toward CTV", reason: "Competitors put $9 million into AVOD.", figures: [avod], moves: [{ channelId: "ctv", percent: 46 }] }] }, base);
  assert.equal(invented.length, 0);
  const uncited = normalizeAllocationProposals({ proposals: [{ title: "Shift", reason: "Competitors favour video.", figures: ["F999"], moves: [{ channelId: "ctv", percent: 46 }] }] }, base);
  assert.equal(uncited.length, 0);
});

test("a budget move may not touch a locked media type, leave its limits or move more than ten points", () => {
  const refs = factRefs([dataset(spendFacts())]);
  const base = { channels, addable: [{ channelId: "audio" }], refs, planAdvertiser: "Gateway Fiber", newId };
  const make = (moves: any[]) => normalizeAllocationProposals({ proposals: [{ title: "Move", reason: "MediaRadar data supports it.", figures: ["F1"], moves }] }, base);
  assert.equal(make([{ channelId: "social", percent: 25 }]).length, 0, "locked");
  assert.equal(make([{ channelId: "ctv", percent: 55 }]).length, 0, "more than ten points");
  assert.equal(make([{ channelId: "ctv", percent: 15 }]).length, 0, "below its minimum");
  assert.equal(make([{ channelId: "tiktok", percent: 5 }]).length, 0, "not in the plan or addable");
  const added = make([{ channelId: "audio", percent: 5 }]);
  assert.equal(added.length, 1);
  assert.deepEqual(proposalOps(added[0], ["ctv", "display", "social"]).map((o) => o.type), ["add_channel", "set_allocation"]);
});

test("the allocation prompt never names the client a dataset was made for in someone else's plan", () => {
  const refs = factRefs([dataset(spendFacts())]);
  const input = allocationInput({ campaign: "CAMPAIGN: Metronet", channels, addable: [], refs, planAdvertiser: "Metronet" });
  assert.doesNotMatch(input, /Gateway Fiber/);
  assert.match(input, /the brand spend across/);
});

test("a narrative change is written only where the field still reads what the planner reviewed", () => {
  const profile = { intro: "Old intro", takeaways: ["a", "b", "c", "d"], demographics: { overview: "Old demo" } };
  const after = { intro: "New intro citing GWI", takeaways: ["a", "b", "c", "d"], demographics: { overview: "New demo" } };
  const changes = narrativeChanges(profile, after);
  assert.deepEqual(changes.map((c) => c.path), ["intro", "demographics.overview"]);
  profile.demographics.overview = "Edited by a colleague meanwhile";
  const result = applyNarrativeChanges(profile, [...changes, { path: "auditResult", before: undefined, after: "nope" }]);
  assert.deepEqual(result, { applied: ["intro"], stale: ["demographics.overview"] });
  assert.equal(profile.intro, "New intro citing GWI");
  assert.equal((profile as any).auditResult, undefined, "only narrative fields can be written");

  const withHighlights: any = { publisherHighlights: { headline: "Old", groups: [] } };
  const kept = applyNarrativeChanges(withHighlights, [{ path: "publisherHighlights", before: { headline: "Old", groups: [] }, after: { headline: "New", groups: [] } }, { path: "intro", before: undefined, after: ["not", "text"] }]);
  assert.deepEqual(kept.applied, ["publisherHighlights", "intro"], "an object field is written like a text field");
  const wrongShape = applyNarrativeChanges({ intro: "Text" }, [{ path: "intro", before: "Text", after: { not: "text" } }]);
  assert.deepEqual(wrongShape.applied, []);
});

test("attaching partner research replaces earlier partner sources and dossier but keeps the budget moves it made", () => {
  const profile: any = {
    sources: [{ name: "GWI", tier: PARTNER_LICENSED_TIER }, { name: "Pew", tier: "Industry" }],
    researchSnapshot: { capturedAt: "x", dossiers: [{ label: "Audience", text: "a" }, { label: PARTNER_DOSSIER_LABEL, text: "old" }] },
    partnerEvidence: { capturedAt: "x", providers: [], datasets: [], factCount: 1, allocationChanges: [{ title: "Shift", reason: "r", credits: ["GWI"], appliedAt: "x", by: "P" }] },
  };
  const evidence = { capturedAt: "y", providers: [{ id: "mediaradar" as const, name: "MediaRadar", description: "", logoUrl: "", color: "", kind: "licensed" as const }], datasets: [{ id: "d", provider: "mediaradar" as const, providerLabel: "MediaRadar", description: "Spend", markets: [], period: "", factCount: 3 }], factCount: 3 };
  attachPartnerResearch(profile, { dossier: { label: PARTNER_DOSSIER_LABEL, text: "new" }, evidence }, { snapshotMaxChars: 100 });
  assert.deepEqual(profile.sources.map((s: any) => s.name), ["MediaRadar", "Pew"]);
  assert.deepEqual(profile.researchSnapshot.dossiers.map((d: any) => d.text), ["a", "new"]);
  assert.equal(profile.partnerEvidence.allocationChanges.length, 1);
  assert.equal(profile.partnerEvidence.factCount, 3);
});

test("a brief is offered other advertisers' research in its category or markets, never its own or unapproved", () => {
  const fiber = toDatasetSummary(dataset(spendFacts(), { advertiserName: "Gateway Fiber", advertiserKey: "gateway fiber" }));
  const gaming = toDatasetSummary(dataset(spendFacts(), { advertiserName: "", advertiserKey: "", category: "Commercial gaming", title: "Gaming revenue", description: "State gaming revenue.", markets: ["Nevada"] }));
  const pending = toDatasetSummary(dataset([fact("x", "$1", { status: "pending" })], { advertiserName: "Other", advertiserKey: "other" }));
  const forMetronet = suggestDatasets([fiber, gaming, pending], { advertiserName: "Metronet", text: "Fiber internet provider, home internet switchers", geography: "Boston, MA; Detroit, MI" });
  assert.deepEqual(forMetronet.map((s) => s.id), [fiber.id]);
  assert.match(forMetronet[0].reason, /Same category/);
  assert.deepEqual(suggestDatasets([fiber], { advertiserName: "Gateway Fiber", text: "fiber internet", geography: "" }), [], "its own research is already ticked");
});

test("a budget move or landscape sent back to be saved is checked again against the facts as they stand", () => {
  const facts = spendFacts();
  const d = dataset(facts);
  const avod = facts.find((f) => f.statement.includes("on AVOD"))!;
  const proposal = { title: "Shift toward CTV", reason: "MediaRadar shows competitors put $4,986,715 into AVOD.", factIds: [avod.id], moves: [{ channelId: "ctv", percent: 46 }] };
  assert.ok(verifyProposal(proposal, [d], "Gateway Fiber"));
  assert.equal(verifyProposal({ ...proposal, reason: "Competitors put $7,000,000 into AVOD." }, [d], "Gateway Fiber"), null, "an edited figure");
  avod.status = "rejected";
  assert.equal(verifyProposal(proposal, [d], "Gateway Fiber"), null, "the fact was rejected since");

  const forged = { datasetId: d.id, scope: "x", competitors: [{ name: "Xfinity", spend: 6886967 }, { name: "T-Mobile", spend: 9999999 }, { name: "Spectrum", spend: 1491043 }], mediaTypes: [], markets: [] };
  assert.deepEqual(verifyCompetitive(forged, d, "Gateway Fiber")?.competitors.map((c) => c.name), ["Xfinity", "Spectrum"]);
  assert.equal(verifyCompetitive({ ...forged, datasetId: "other" }, d, "Gateway Fiber"), null);
});
