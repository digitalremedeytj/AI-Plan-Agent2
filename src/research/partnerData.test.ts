import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPartnerDossier,
  guessProvider,
  normalizeExtraction,
  partnerForSource,
  partnerSources,
  resolveProviders,
  scrubForAdvertiser,
  toDatasetSummary,
  PARTNER_DOSSIER_LABEL,
  PARTNER_GOVERNMENT_TIER,
  PARTNER_LICENSED_TIER,
  type ResearchDataset,
  type ResearchFact,
} from "./partnerData";

let n = 0;
const newId = () => `id-${++n}`;

function fact(overrides: Partial<ResearchFact> = {}): ResearchFact {
  return {
    id: newId(),
    statement: "34% of the Albany, NY DMA population is aged 65 or older.",
    figure: "34%",
    measure: "share",
    population: "Albany DMA adults",
    geography: "Albany, NY DMA",
    period: "2026",
    location: "p. 2",
    fileName: "Life stage.pdf",
    fromSummary: false,
    status: "approved",
    ...overrides,
  };
}

function dataset(overrides: Partial<ResearchDataset> = {}): ResearchDataset {
  return {
    id: newId(),
    revision: 1,
    title: "Bulldog Media x Gateway Fiber - Audience Insights",
    provider: "resonate",
    providerLabel: "",
    advertiserName: "Gateway Fiber",
    advertiserKey: "gateway fiber",
    category: "Home internet",
    markets: ["Albany, NY DMA"],
    period: "2026",
    description: "Life stage and household composition across four DMAs.",
    fileCount: 1,
    fileHashes: [],
    factCounts: { pending: 0, approved: 1, rejected: 0 },
    extraction: { status: "done", at: "2026-11-05T00:00:00Z" },
    createdAt: "2026-11-05T00:00:00Z",
    createdBy: "Planner",
    updatedAt: "2026-11-05T00:00:00Z",
    updatedBy: "Planner",
    archived: false,
    files: [],
    facts: [fact()],
    ...overrides,
  };
}

test("only approved facts reach a plan, so an unreviewed figure is never shown to a client", () => {
  const built = buildPartnerDossier(
    [dataset({ facts: [fact({ status: "pending", statement: "Pending figure is 12% of households." }), fact({ status: "rejected", statement: "Rejected figure is 88% of households." }), fact()] })],
    { advertiserName: "Gateway Fiber" },
  );
  assert.ok(built);
  assert.match(built.dossier.text, /34% of the Albany/);
  assert.doesNotMatch(built.dossier.text, /Pending figure|Rejected figure/);
  assert.equal(built.evidence.factCount, 1);
});

test("nothing chosen with an approved fact builds no dossier", () => {
  assert.equal(buildPartnerDossier([dataset({ facts: [fact({ status: "pending" })] })], { advertiserName: "Acme" }), null);
  assert.equal(buildPartnerDossier([dataset({ archived: true })], { advertiserName: "Acme" }), null);
});

test("another client's deliverable informs a plan without naming that client or its title", () => {
  const built = buildPartnerDossier(
    [dataset({ facts: [fact({ statement: "Gateway Fiber's Detroit market has 42% multi-child households." })], description: "What Gateway Fiber customers value in an ISP." })],
    { advertiserName: "Hyster" },
  )!;
  assert.doesNotMatch(built.dossier.text, /Gateway Fiber|Bulldog/);
  assert.match(built.dossier.text, /the brand Detroit market has 42%/);
  assert.doesNotMatch(JSON.stringify(built.evidence), /Gateway Fiber|Bulldog/);
});

test("the client's own deliverable keeps its name in its own plan", () => {
  const built = buildPartnerDossier([dataset({ facts: [fact({ statement: "Gateway Fiber is chosen by 20% of Fargo switchers." })] })], { advertiserName: "gateway fiber " })!;
  assert.match(built.dossier.text, /Gateway Fiber is chosen/);
});

test("every fact line keeps its measure, population, geography, credit and summary origin", () => {
  const built = buildPartnerDossier(
    [dataset({ provider: "gwi", facts: [fact({ statement: "Interior designers index 949.5 for reading Vice online.", figure: "949.5 index", measure: "index", population: "Interior designers/architects", fromSummary: true })] })],
    { advertiserName: "Trivantage" },
  )!;
  assert.match(built.dossier.text, /source: GWI; measure: index; population: Interior designers\/architects; geography: Albany, NY DMA; period: 2026; from a written summary/);
  assert.equal(built.dossier.label, PARTNER_DOSSIER_LABEL);
});

test("datasets share the dossier budget so one large export cannot crowd out the others", () => {
  const big = dataset({ provider: "census", facts: Array.from({ length: 200 }, (_, i) => fact({ statement: `ZIP ${10000 + i} has ${i}% of households without a computer.` })) });
  const small = dataset({ provider: "mediaradar", facts: [fact({ statement: "Spectrum spent $316,975.86 in Albany.", measure: "spend" })] });
  const built = buildPartnerDossier([big, small], { advertiserName: "Acme", maxChars: 4000 })!;
  assert.match(built.dossier.text, /Spectrum spent/);
  assert.ok(built.dossier.text.length < 4600);
  assert.deepEqual(built.evidence.providers.map((p) => p.id), ["census", "mediaradar"]);
});

test("a statement missing its figure gets it back, and duplicates and empty facts are dropped", () => {
  const out = normalizeExtraction(
    {
      provider: "Statista",
      facts: [
        { statement: "Nevada had the highest commercial gaming revenue in 2025", figure: "$15,798.3 million", fileName: "gaming.xlsx" },
        { statement: "Nevada had the highest commercial gaming revenue in 2025", figure: "$15,798.3 million" },
        { statement: "short" },
        { statement: "Pennsylvania commercial gaming revenue reached $7,712.66 million in 2025.", figure: "$7,712.66 million", measure: "nonsense" },
      ],
    },
    [{ fileName: "gaming.xlsx", role: "source" }],
    newId,
  );
  assert.equal(out.provider, "statista");
  assert.equal(out.facts.length, 2);
  assert.match(out.facts[0].statement, /\(\$15,798\.3 million\)\.$/);
  assert.equal(out.facts[1].measure, "spend");
  assert.ok(out.facts.every((f) => f.status === "pending"));
});

test("facts read from a Word write-up are marked as coming from a summary", () => {
  const out = normalizeExtraction(
    { facts: [{ statement: "Detroit has 42% multi-child households.", figure: "42%", fileName: "file-abc123-Audience_Insights.docx" }] },
    [{ fileName: "Audience Insights.docx", role: "summary" }, { fileName: "Life stage.pdf", role: "source" }],
    newId,
  );
  assert.equal(out.facts[0].fileName, "Audience Insights.docx");
  assert.equal(out.facts[0].fromSummary, true);
});

test("a malformed extractor reply yields an empty dataset rather than an error", () => {
  const out = normalizeExtraction("not json", [{ fileName: "x.pdf", role: "source" }], newId);
  assert.equal(out.facts.length, 0);
  assert.equal(out.title, "x");
});

test("the provider is guessed from file names", () => {
  assert.equal(guessProvider("Census Data - Types of Computers.xlsx"), "census");
  assert.equal(guessProvider("commercial gaming revenue - Statista.pdf"), "statista");
  assert.equal(guessProvider("MediaRadar export.csv"), "mediaradar");
  assert.equal(guessProvider("Trivantage - Social Media.pdf"), "other");
});

test("partner sources head the registry, government data credited as such", () => {
  const built = buildPartnerDossier([dataset({ provider: "census", providerLabel: "U.S. Census Bureau, ACS 2024" }), dataset({ provider: "gwi" })], { advertiserName: "Acme" })!;
  const sources = partnerSources(built.evidence);
  assert.deepEqual(sources.map((s) => [s.name, s.tier]), [["U.S. Census Bureau, ACS 2024", PARTNER_GOVERNMENT_TIER], ["GWI", PARTNER_LICENSED_TIER]]);
  assert.match(sources[1].supportedClaims, /1 verified data point used/);
});

test("a chart credited to a partner gets that partner's badge, an estimate never does", () => {
  const built = buildPartnerDossier([dataset({ provider: "gwi" }), dataset({ provider: "census" })], { advertiserName: "Acme" })!;
  assert.equal(partnerForSource("GWI (2026)", built.evidence)?.id, "gwi");
  assert.equal(partnerForSource("U.S. Census ACS 2024", built.evidence)?.id, "census");
  assert.equal(partnerForSource("ScoutAI estimate (informed by GWI)", built.evidence), null);
  assert.equal(partnerForSource("Nielsen 2025", built.evidence), null);
  assert.equal(partnerForSource("GWI (2026)", null), null);
});

test("an admin's logo and description override the preset; nothing else can be changed", () => {
  const providers = resolveProviders([{ id: "gwi", logoUrl: "/api/images/abc.png", description: "  Custom line " }, { id: "bogus" as any, logoUrl: "x" }]);
  const gwi = providers.find((p) => p.id === "gwi")!;
  assert.equal(gwi.logoUrl, "/api/images/abc.png");
  assert.equal(gwi.description, "Custom line");
  assert.equal(gwi.name, "GWI");
  assert.equal(providers.length, 6);
});

test("a dataset's summary counts its facts by status", () => {
  const summary = toDatasetSummary(dataset({ facts: [fact(), fact({ status: "pending" }), fact({ status: "pending" })], files: [{} as any] }));
  assert.deepEqual(summary.factCounts, { pending: 2, approved: 1, rejected: 0 });
  assert.equal(summary.fileCount, 1);
  assert.equal("facts" in summary, false);
});

test("scrubbing leaves text alone when the dataset names no client", () => {
  assert.equal(scrubForAdvertiser("Spectrum leads Albany.", "", "Acme"), "Spectrum leads Albany.");
});

test("a reviewer's approval is recorded under the session's name, and an edit is marked as one", async () => {
  const { applyDatasetEdit } = await import("./partnerData");
  const original = dataset({ facts: [fact({ id: "a", status: "pending" }), fact({ id: "b", status: "pending" })] });
  const out = applyDatasetEdit(
    original,
    { facts: [{ id: "a", status: "approved", reviewedBy: "Spoofed" }, { id: "b", figure: "35%", status: "pending" }, { id: "new", statement: "An added fact that should not appear." }] },
    "Ana",
    "2026-11-05T10:00:00Z",
  );
  assert.equal(out.facts.length, 2);
  assert.equal(out.facts[0].status, "approved");
  assert.equal(out.facts[0].reviewedBy, "Ana");
  assert.equal(out.facts[0].edited, undefined);
  assert.equal(out.facts[1].figure, "35%");
  assert.equal(out.facts[1].edited, true);
  assert.equal(out.facts[1].reviewedBy, "Ana");
});

test("an edit that empties a statement keeps the original wording", async () => {
  const { applyDatasetEdit } = await import("./partnerData");
  const original = dataset({ facts: [fact({ id: "a" })] });
  const out = applyDatasetEdit(original, { provider: "bogus", facts: [{ id: "a", statement: "  " }] }, "Ana", "now");
  assert.equal(out.facts[0].statement, original.facts[0].statement);
  assert.equal(out.provider, "resonate");
});

test("the extractor's caveats are kept as internal notes and never reach the client view", () => {
  const out = normalizeExtraction(
    { description: "Competitor ad spend by market.", notes: "Totals disagree between the Executive Summary and Channel sheets.", facts: [] },
    [{ fileName: "spend.xlsx", role: "source" }],
    newId,
  );
  assert.equal(out.notes, "Totals disagree between the Executive Summary and Channel sheets.");
  const built = buildPartnerDossier([dataset({ notes: out.notes, description: out.description })], { advertiserName: "Acme" })!;
  assert.doesNotMatch(JSON.stringify(built.evidence), /disagree/);
});

test("a reviewer's note in place of a period never reaches the client", async () => {
  const { clientPeriod } = await import("./partnerData");
  assert.equal(clientPeriod("Not stated (workbook generated Sept 2026)"), "");
  assert.equal(clientPeriod("Q3 2026"), "Q3 2026");
});
