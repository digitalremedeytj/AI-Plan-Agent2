// Partner research: licensed third-party data (GWI, Resonate, MediaRadar, Statista, U.S. Census)
// uploaded to a shared library and used to build and support a plan. The point is that a client
// can see the plan is not all AI: its figures come from named data partners.
//
// The rules this module enforces, and why:
// - Figures are extracted once, at upload, into fact cards a person approves. Only approved facts
//   reach a plan, so a misread chart or an index read as a share is caught before a client sees it.
//   Extraction never runs inside a generation run, which has no time to spare (RUN_BUDGET_MS).
// - The library is shared across advertisers: a deliverable made for one client may inform
//   another's plan. What reaches the other plan is the provider's figures, credited to the
//   provider. The deliverable's title and the client it was made for never do (scrubForAdvertiser).
// - Word write-ups are used as they are, but each of their facts is marked fromSummary: they are
//   someone's reading of the data, not the export itself.
//
// Everything here is pure, shared by the server (extraction, generation) and the browser (review,
// client view), and tested in partnerData.test.ts.

import type { CompetitiveLandscape, PartnerAllocationChange } from "./partnerReinforcement";

export type PartnerProviderId = "gwi" | "resonate" | "mediaradar" | "statista" | "census" | "other";

export interface PartnerProvider {
  id: PartnerProviderId;
  name: string;
  /** One line for the client view: what this partner's data is. */
  description: string;
  /** For the extractor and the plan writers: what this provider's figures usually measure. */
  readingNote: string;
  /** Wordmark colour when no logo has been uploaded. */
  color: string;
  /** Government data is credited as such in the source registry. */
  kind: "licensed" | "government";
  /** An uploaded logo (/api/images/<id>). Empty shows the wordmark. */
  logoUrl: string;
}

export const PARTNER_PROVIDERS: PartnerProvider[] = [
  {
    id: "gwi",
    name: "GWI",
    description: "Global consumer survey: audience attitudes, media habits and brand discovery.",
    readingNote: "Survey crosstabs. A figure is usually the share of the audience (reach / column %) and an index against a base where 100 is average. They are different measures: a 949 index is not a share of anyone.",
    color: "#ff4f00",
    kind: "licensed",
    logoUrl: "",
  },
  {
    id: "resonate",
    name: "Resonate",
    description: "Consumer values, motivations and life-stage intelligence.",
    readingNote: "Values, motivations and life-stage data: usually a composition % of the audience and an index against the U.S. online population. Keep the market each figure was measured in.",
    color: "#6d28d9",
    kind: "licensed",
    logoUrl: "",
  },
  {
    id: "mediaradar",
    name: "MediaRadar",
    description: "Advertising intelligence: competitor spend by channel, market and month.",
    readingNote: "Competitor ad spend in dollars by advertiser, channel, market and month. It describes what competitors spent, never how the audience behaves.",
    color: "#0e7490",
    kind: "licensed",
    logoUrl: "",
  },
  {
    id: "statista",
    name: "Statista",
    description: "Market and industry statistics.",
    readingNote: "Secondary statistics. Each chart names an original source (e.g. the American Gaming Association); credit it as '<original> via Statista' and keep its year and unit.",
    color: "#0666e3",
    kind: "licensed",
    logoUrl: "",
  },
  {
    id: "census",
    name: "U.S. Census Bureau",
    description: "American Community Survey: households, income, devices and internet access.",
    readingNote: "American Community Survey estimates for a stated geography (ZIP/ZCTA, county, DMA, state) and vintage (e.g. ACS 5-year 2024). Keep the geography and vintage with every figure.",
    color: "#1e3a8a",
    kind: "government",
    logoUrl: "",
  },
  {
    id: "other",
    name: "Other partner",
    description: "Third-party research.",
    readingNote: "Third-party research. Keep the population, geography, period and measure of every figure.",
    color: "#475569",
    kind: "licensed",
    logoUrl: "",
  },
];

const PROVIDER_IDS = new Set<string>(PARTNER_PROVIDERS.map((p) => p.id));
export const isPartnerProviderId = (value: unknown): value is PartnerProviderId => typeof value === "string" && PROVIDER_IDS.has(value);

/** What an admin may change about a provider: its logo and the line the client reads. */
export interface PartnerProviderOverride {
  id: PartnerProviderId;
  logoUrl?: string;
  description?: string;
}

/** The built-in presets with the admin's overrides applied. */
export function resolveProviders(overrides: PartnerProviderOverride[] = []): PartnerProvider[] {
  const byId = new Map(overrides.filter((o) => isPartnerProviderId(o?.id)).map((o) => [o.id, o]));
  return PARTNER_PROVIDERS.map((preset) => {
    const o = byId.get(preset.id);
    return {
      ...preset,
      logoUrl: typeof o?.logoUrl === "string" ? o.logoUrl : preset.logoUrl,
      description: typeof o?.description === "string" && o.description.trim() ? o.description.trim() : preset.description,
    };
  });
}

export function providerById(id: string, providers: PartnerProvider[] = PARTNER_PROVIDERS): PartnerProvider {
  return providers.find((p) => p.id === id) ?? providers.find((p) => p.id === "other") ?? PARTNER_PROVIDERS[PARTNER_PROVIDERS.length - 1];
}

/** A first guess from the file names and the extractor's reading; the uploader can change it. */
export function guessProvider(...texts: string[]): PartnerProviderId {
  const text = texts.join(" ").toLowerCase();
  if (/\bstatista\b/.test(text)) return "statista";
  if (/\bmedia\s?radar\b/.test(text)) return "mediaradar";
  if (/\bresonate\b/.test(text)) return "resonate";
  if (/\bgwi\b|globalwebindex/.test(text)) return "gwi";
  if (/\bcensus\b|\bacs\b|american community survey|\bzcta\d?\b/.test(text)) return "census";
  return "other";
}

// --- the library's records ------------------------------------------------------------

export type FactMeasure = "share" | "index" | "spend" | "count" | "rate" | "rank" | "other";
export const FACT_MEASURES: FactMeasure[] = ["share", "index", "spend", "count", "rate", "rank", "other"];
export const FACT_MEASURE_LABELS: Record<FactMeasure, string> = {
  share: "Share of audience",
  index: "Index",
  spend: "Ad spend",
  count: "Count",
  rate: "Rate",
  rank: "Ranking",
  other: "Other",
};

export type FactStatus = "pending" | "approved" | "rejected";

/** One figure as the partner reported it. Nothing reaches a plan until someone approves it. */
export interface ResearchFact {
  id: string;
  /** One sentence with the figure as reported and the group it describes. */
  statement: string;
  /** The figure alone, e.g. "42%", "$316,976", "949.5 index". */
  figure: string;
  measure: FactMeasure;
  /** Who was measured, e.g. "Detroit DMA households", "Interior designers and architects". */
  population: string;
  geography: string;
  period: string;
  /** Where in the file: "p. 3", "Sheet: Executive Summary". */
  location: string;
  fileName: string;
  /** Taken from a write-up of the data rather than the provider's own export. */
  fromSummary: boolean;
  status: FactStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  /** Someone changed the extracted wording or figure. */
  edited?: boolean;
}

/** An uploaded file. The original is kept in the research file store (researchFileStore.ts). */
export interface ResearchFileRef {
  id: string;
  fileName: string;
  sizeBytes: number;
  contentType: string;
  sha256: string;
  storedId: string;
  /** "summary": a write-up of the data (a Word document), "source": the export itself. */
  role: "source" | "summary";
  uploadedAt: string;
  uploadedBy: string;
}

export interface ResearchDatasetSummary {
  id: string;
  revision: number;
  /** Internal only: may name the client it was made for. Never reaches another advertiser's plan. */
  title: string;
  provider: PartnerProviderId;
  /** How the plan credits it, e.g. "American Gaming Association via Statista". Defaults to the provider. */
  providerLabel: string;
  /** The advertiser it was made for. Empty for general research. */
  advertiserName: string;
  advertiserKey: string;
  category: string;
  markets: string[];
  period: string;
  /** Client-safe: what the data measures, without naming whom it was made for. */
  description: string;
  /** Internal only: caveats for reviewers (unreadable pages, worksheets that disagree). Never shown to clients. */
  notes?: string;
  fileCount: number;
  /** The files' SHA-256s, so a second upload of the same file is caught from the list alone. */
  fileHashes: string[];
  factCounts: Record<FactStatus, number>;
  extraction: { status: "done" | "failed"; at: string; error?: string };
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  archived: boolean;
}

export interface ResearchDataset extends ResearchDatasetSummary {
  files: ResearchFileRef[];
  facts: ResearchFact[];
}

export const toAdvertiserKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

export function countFacts(facts: ResearchFact[]): Record<FactStatus, number> {
  const counts: Record<FactStatus, number> = { pending: 0, approved: 0, rejected: 0 };
  for (const fact of facts) counts[fact.status] = (counts[fact.status] ?? 0) + 1;
  return counts;
}

export function toDatasetSummary(dataset: ResearchDataset): ResearchDatasetSummary {
  const { files, facts, ...summary } = dataset;
  return { ...summary, fileCount: files.length, fileHashes: files.map((f) => f.sha256), factCounts: countFacts(facts) };
}

// --- reading what the extractor returned ------------------------------------------

export const MAX_RESEARCH_FILES = 5;
export const MAX_FACTS_PER_DATASET = 120;
export const RESEARCH_ACCEPT = ".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.png,.jpg,.jpeg,.webp";
const SUMMARY_EXTENSIONS = new Set(["doc", "docx", "rtf", "txt"]);
const ACCEPTED_EXTENSIONS = new Set(RESEARCH_ACCEPT.split(",").map((ext) => ext.slice(1)));

export const fileExtension = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";
export const isResearchFileType = (name: string) => ACCEPTED_EXTENSIONS.has(fileExtension(name));
/** Word documents are write-ups of the data; everything else is treated as the export itself. */
export const fileRoleOf = (name: string): ResearchFileRef["role"] => (SUMMARY_EXTENSIONS.has(fileExtension(name)) ? "summary" : "source");

const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

// A figure must be in its own statement. The extractor sometimes writes "Most households own a
// tablet" with the figure only in the figure field; the plan writers read the statement.
function statementWithFigure(statement: string, figure: string): string {
  if (!figure) return statement;
  const digits = figure.match(/[\d.,]+/)?.[0]?.replace(/,/g, "");
  if (!digits || statement.replace(/,/g, "").includes(digits)) return statement;
  return `${statement.replace(/[.\s]+$/, "")} (${figure}).`;
}

function measureOf(value: unknown, figure: string): FactMeasure {
  if (typeof value === "string" && (FACT_MEASURES as string[]).includes(value)) return value as FactMeasure;
  if (/index/i.test(figure)) return "index";
  if (/\$/.test(figure)) return "spend";
  if (/%/.test(figure)) return "share";
  return "other";
}

export interface ExtractedDataset {
  title: string;
  provider: PartnerProviderId;
  providerLabel: string;
  category: string;
  markets: string[];
  period: string;
  description: string;
  notes: string;
  /** The client the material was prepared for, if it names one. */
  preparedFor: string;
  facts: ResearchFact[];
}

/**
 * Cleans the extractor's JSON into a dataset: every fact pending, figures kept in their
 * statements, duplicates and empty facts dropped, a capped count. Never throws on a malformed
 * reply; a reply with nothing usable yields no facts, which the uploader is told about.
 */
export function normalizeExtraction(
  raw: any,
  files: Array<Pick<ResearchFileRef, "fileName" | "role">>,
  newId: () => string,
): ExtractedDataset {
  const fileNames = files.map((f) => f.fileName);
  const roleByName = new Map(files.map((f) => [nameKey(f.fileName), f.role]));
  const matchFile = (name: string) => {
    const key = nameKey(name);
    return fileNames.find((n) => nameKey(n) === key) ?? fileNames.find((n) => key && (nameKey(n).includes(key) || key.includes(nameKey(n)))) ?? (fileNames.length === 1 ? fileNames[0] : name);
  };

  const seen = new Set<string>();
  const facts: ResearchFact[] = [];
  for (const item of Array.isArray(raw?.facts) ? raw.facts : []) {
    const figure = text(item?.figure, 60);
    const statement = statementWithFigure(text(item?.statement, 400), figure);
    if (statement.length < 12) continue;
    const key = statement.toLowerCase().replace(/[^a-z0-9%$.]/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    const fileName = matchFile(text(item?.fileName, 200));
    facts.push({
      id: newId(),
      statement,
      figure,
      measure: measureOf(item?.measure, figure),
      population: text(item?.population, 160),
      geography: text(item?.geography, 160),
      period: text(item?.period, 60),
      location: text(item?.location, 80),
      fileName,
      fromSummary: (roleByName.get(nameKey(fileName)) ?? fileRoleOf(fileName)) === "summary",
      status: "pending",
    });
    if (facts.length >= MAX_FACTS_PER_DATASET) break;
  }

  const providerText = text(raw?.provider, 80);
  const provider = isPartnerProviderId(providerText.toLowerCase()) ? (providerText.toLowerCase() as PartnerProviderId) : guessProvider(providerText, ...fileNames);
  return {
    title: text(raw?.title, 160) || fileNames[0]?.replace(/\.[^.]+$/, "") || "Untitled research",
    provider,
    providerLabel: text(raw?.providerLabel, 120),
    category: text(raw?.category, 80),
    markets: (Array.isArray(raw?.markets) ? raw.markets : []).map((m: unknown) => text(m, 60)).filter(Boolean).slice(0, 30),
    period: text(raw?.period, 60),
    description: text(raw?.description, 300),
    notes: text(raw?.notes, 600),
    preparedFor: text(raw?.preparedFor, 120),
    facts,
  };
}

function nameKey(name: string): string {
  return name.replace(/^.*[\\/]/, "").replace(/^file-[A-Za-z0-9]+-/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The extractor's instructions. Provider reading notes are included so an index is read as one. */
export function extractionInstructions(files: Array<Pick<ResearchFileRef, "fileName" | "role">>, providerHint: PartnerProviderId | null): string {
  const notes = PARTNER_PROVIDERS.filter((p) => p.id !== "other").map((p) => `- ${p.name} (id "${p.id}"): ${p.readingNote}`).join("\n");
  const list = files.map((f) => `- "${f.fileName.replace(/["\n\r]/g, "")}"${f.role === "summary" ? " (a written summary of the data, not the export itself)" : ""}`).join("\n");
  return `You read third-party audience and market research for a media agency and extract its figures as fact cards. A person reviews every card before it is used in a client's media plan, and the plan will credit the data partner by name, so accuracy matters more than volume.

FILES:
${list}
${providerHint ? `\nThe uploader says the provider is "${providerHint}".\n` : ""}
DATA PARTNERS AND HOW THEIR FIGURES READ:
${notes}

Read every file (use Python for spreadsheets and Word documents; read PDF pages and images visually, including charts). Then return ONE JSON object, nothing else:
{
  "title": "a short internal title for this research",
  "provider": "gwi" | "resonate" | "mediaradar" | "statista" | "census" | "other",
  "providerLabel": "how to credit it, e.g. 'GWI', 'American Gaming Association via Statista', 'U.S. Census Bureau, ACS 5-Year 2024'",
  "preparedFor": "the client the material was prepared for, if it names one, else ''",
  "category": "the category it is about, e.g. 'Home internet / fiber', 'Commercial gaming'",
  "markets": ["each market or geography covered, e.g. 'Albany, NY DMA', 'United States'"],
  "period": "when the data was collected or covers, e.g. '2026', 'Sep 2025 - Jul 2026', 'ACS 2020-2024'; '' if the files do not say",
  "description": "one sentence, shown to the client, on what the data measures. No caveats or data-quality remarks, and never the client or agency it was prepared for",
  "notes": "caveats for the internal reviewer only: unreadable pages, totals that disagree between sheets, missing sources or periods. '' if none",
  "facts": [
    {
      "statement": "one self-contained sentence with the figure exactly as reported and the group it describes",
      "figure": "the figure alone, e.g. '34%', '$316,976', '949.5 index'",
      "measure": "share" | "index" | "spend" | "count" | "rate" | "rank" | "other",
      "population": "who or what was measured",
      "geography": "where",
      "period": "when",
      "location": "where in the file, e.g. 'p. 3' or 'Sheet: Executive Summary'",
      "fileName": "the file it came from"
    }
  ]
}

RULES:
1. Copy figures exactly as reported. Never round, combine, average or compute a new figure, and never estimate one.
2. KEEP THE MEASURE: an index is not a share ("20.8% reach, 949.5 index" is two facts, or one statement that names both). "More likely" is relative. Spend is what advertisers spent, not audience behaviour.
3. KEEP THE POPULATION AND GEOGRAPHY: a figure for one segment, one market or one ZIP code says so in its statement. Never present a sub-group's figure as the whole audience's.
4. Statements describe the audience, the market or the competitive landscape. Never name the client or agency the material was prepared for, and leave out recommendations and opinions (\"the brand should...\"): only measured facts.
5. Prefer the figures most useful to a media plan: audience composition and indexes, media and device habits, values and motivations, market size, household and internet data, competitor spend by channel and month. Up to ${MAX_FACTS_PER_DATASET} facts; skip trivia and repeated figures.
6. If a file is unreadable or holds no figures, return the facts you could read from the others and say so in "notes".`;
}

// --- generation: the Partner Data dossier ------------------------------------------------

export const PARTNER_DOSSIER_LABEL = "Partner Data";
const DOSSIER_CHARS = 24000;

/** What a plan shows a client about the partner data it was built with. Client-safe by construction. */
export interface PartnerEvidence {
  capturedAt: string;
  providers: Array<Pick<PartnerProvider, "id" | "name" | "description" | "logoUrl" | "color" | "kind">>;
  datasets: Array<{
    id: string;
    provider: PartnerProviderId;
    providerLabel: string;
    description: string;
    markets: string[];
    period: string;
    factCount: number;
  }>;
  factCount: number;
  /** Competitor spend from the partner data, every value read from an approved figure. */
  competitive?: CompetitiveLandscape;
  /** Budget moves the partner data argued for and a planner applied, as the client reads them. */
  allocationChanges?: PartnerAllocationChange[];
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A deliverable made for one client, used in another client's plan, carries the provider's figures
 * and nothing that names the first client. The extractor is told the same; this is the backstop.
 */
export function scrubForAdvertiser(value: string, madeFor: string, planAdvertiser: string): string {
  const name = madeFor.trim();
  if (!name || toAdvertiserKey(name) === toAdvertiserKey(planAdvertiser)) return value;
  return value.replace(new RegExp(`\\b${escapeRegExp(name)}(?:'s)?\\b`, "gi"), "the brand");
}

/** How the plan credits a dataset: its own label (e.g. "AGA via Statista") or the provider's name. */
export function creditFor(dataset: Pick<ResearchDatasetSummary, "provider" | "providerLabel">, providers: PartnerProvider[] = PARTNER_PROVIDERS): string {
  return dataset.providerLabel.trim() || providerById(dataset.provider, providers).name;
}

function factLine(fact: ResearchFact, credit: string, scrub: (s: string) => string): string {
  const qualifiers = [
    `source: ${credit}`,
    `measure: ${FACT_MEASURE_LABELS[fact.measure].toLowerCase()}`,
    fact.population && `population: ${scrub(fact.population)}`,
    fact.geography && `geography: ${fact.geography}`,
    fact.period && `period: ${fact.period}`,
    fact.fromSummary && "from a written summary of the data",
  ].filter(Boolean);
  return `- ${scrub(fact.statement)} (${qualifiers.join("; ")})`;
}

/**
 * The approved facts of the chosen datasets as one research dossier, plus what the client view
 * shows about them. Null when nothing chosen has an approved fact. Datasets share the character
 * budget evenly, so one large export cannot crowd out the rest.
 */
export function buildPartnerDossier(
  datasets: ResearchDataset[],
  options: { advertiserName: string; providers?: PartnerProvider[]; now?: string; maxChars?: number },
): { dossier: { label: string; text: string }; evidence: PartnerEvidence } | null {
  const providers = options.providers ?? PARTNER_PROVIDERS;
  const usable = datasets
    .filter((d) => !d.archived)
    .map((d) => ({ dataset: d, facts: d.facts.filter((f) => f.status === "approved") }))
    .filter((d) => d.facts.length > 0);
  if (usable.length === 0) return null;

  const budget = Math.floor((options.maxChars ?? DOSSIER_CHARS) / usable.length);
  const sections: string[] = [];
  const used: PartnerEvidence["datasets"] = [];
  for (const { dataset, facts } of usable) {
    const scrub = (s: string) => scrubForAdvertiser(s, dataset.advertiserName, options.advertiserName);
    const credit = creditFor(dataset, providers);
    const header = `=== ${credit}: ${scrub(dataset.description) || providerById(dataset.provider, providers).description}${dataset.markets.length ? ` | markets: ${dataset.markets.join(", ")}` : ""}${clientPeriod(dataset.period) ? ` | period: ${clientPeriod(dataset.period)}` : ""} ===`;
    let section = header;
    let count = 0;
    for (const fact of facts) {
      const line = factLine(fact, credit, scrub);
      if (section.length + line.length + 1 > budget) break;
      section += `\n${line}`;
      count++;
    }
    if (count === 0) continue;
    sections.push(section);
    used.push({
      id: dataset.id,
      provider: dataset.provider,
      providerLabel: credit,
      description: scrub(dataset.description) || providerById(dataset.provider, providers).description,
      markets: dataset.markets,
      period: clientPeriod(dataset.period),
      factCount: count,
    });
  }
  if (used.length === 0) return null;

  const providerIds = [...new Set(used.map((d) => d.provider))];
  const text = `LICENSED PARTNER RESEARCH. Every line below is a figure a person checked against the partner's own data. It is the strongest evidence this plan has: prefer it to web research, and where the two disagree, use the partner figure.\n\n${sections.join("\n\n")}`;
  return {
    dossier: { label: PARTNER_DOSSIER_LABEL, text },
    evidence: {
      capturedAt: options.now ?? new Date().toISOString(),
      providers: providerIds.map((id) => {
        const p = providerById(id, providers);
        return { id: p.id, name: p.name, description: p.description, logoUrl: p.logoUrl, color: p.color, kind: p.kind };
      }),
      datasets: used,
      factCount: used.reduce((sum, d) => sum + d.factCount, 0),
    },
  };
}

/**
 * A period as a client may read it. Extractors sometimes fill a missing period with a note
 * ("Not stated (workbook generated Sept 2026)"); that is for the reviewer, not the plan.
 */
export function clientPeriod(period: string | undefined): string {
  const p = String(period ?? "").trim();
  return /^(not stated|unknown|n\/?a\b|unspecified|none)/i.test(p) ? "" : p;
}

/** The synthesis and narrative writers' rules for partner figures. */
export const PARTNER_DATA_RULES = `PARTNER DATA RULES (the plan is shown to the client as backed by these named data partners):
1. Use the PARTNER DATA dossier wherever it covers a point. Where it and the web research disagree, use the partner figure.
2. Credit the partner by name in the prose, e.g. "According to GWI, ..." or "MediaRadar spend data shows ...". Credit each figure to the source named on its line, never to a different one.
3. A chart value taken from it: copy the figure exactly, set isModeled false, and make the point's source the partner's credit and period, e.g. "GWI (2026)" or "U.S. Census Bureau, ACS 2024".
4. Every evidence rule applies: keep each figure's measure (index vs share vs spend), population, geography and period exactly as its line states.`;

/** The source-registry entries for the partners a plan used, listed ahead of web sources. */
export function partnerSources(evidence: PartnerEvidence | null | undefined): Array<{ name: string; url: string; supportedClaims: string; tier: string; usageType: string }> {
  if (!evidence) return [];
  const byCredit = new Map<string, { kind: PartnerProvider["kind"]; descriptions: string[]; facts: number }>();
  for (const d of evidence.datasets) {
    const kind = evidence.providers.find((p) => p.id === d.provider)?.kind ?? "licensed";
    const entry = byCredit.get(d.providerLabel) ?? { kind, descriptions: [], facts: 0 };
    entry.descriptions.push(`${d.description}${d.markets.length ? ` (${d.markets.slice(0, 6).join(", ")}${d.markets.length > 6 ? ", ..." : ""})` : ""}`);
    entry.facts += d.factCount;
    byCredit.set(d.providerLabel, entry);
  }
  return [...byCredit.entries()].map(([name, entry]) => ({
    name,
    url: "",
    supportedClaims: `${entry.descriptions.join(" ")} ${entry.facts} verified data point${entry.facts === 1 ? "" : "s"} used in this plan.`.trim(),
    tier: entry.kind === "government" ? PARTNER_GOVERNMENT_TIER : PARTNER_LICENSED_TIER,
    usageType: "Primary Source",
  }));
}

export const PARTNER_LICENSED_TIER = "Data Partner: Licensed Research";
export const PARTNER_GOVERNMENT_TIER = "Data Partner: Government Data";
export const isPartnerTier = (tier: unknown) => tier === PARTNER_LICENSED_TIER || tier === PARTNER_GOVERNMENT_TIER;

/**
 * The partner a chart's source line credits, for its badge. Matches the dataset credits and the
 * provider names the plan used; null for a chart from web research or an estimate.
 */
export function partnerForSource(source: unknown, evidence: PartnerEvidence | null | undefined): PartnerEvidence["providers"][number] | null {
  if (!evidence || typeof source !== "string" || !source.trim()) return null;
  const lower = source.toLowerCase();
  if (/estimate|modeled|modelled|proxy/.test(lower)) return null;
  for (const d of evidence.datasets) {
    const provider = evidence.providers.find((p) => p.id === d.provider);
    if (!provider) continue;
    if (lower.includes(d.providerLabel.toLowerCase()) || new RegExp(`\\b${escapeRegExp(provider.name.toLowerCase())}\\b`).test(lower)) return provider;
  }
  // "Census" alone is how chart sources usually credit the Census Bureau.
  const census = evidence.providers.find((p) => p.id === "census");
  if (census && /\bcensus\b|\bacs\b/.test(lower)) return census;
  return null;
}

// --- review edits ------------------------------------------------------------------------

export type DatasetMetadata = Pick<ResearchDataset, "title" | "provider" | "providerLabel" | "advertiserName" | "category" | "markets" | "period" | "description" | "notes">;

const FACT_TEXT_FIELDS = ["statement", "figure", "population", "geography", "period"] as const;

/**
 * A reviewer's changes applied to a stored dataset. The browser sends what it shows; the server
 * decides who reviewed what and when (the actor comes from the session, never the body). Facts are
 * matched by id: a fact the edit does not mention is unchanged, and an edit cannot add one.
 */
export function applyDatasetEdit(
  existing: ResearchDataset,
  edit: any,
  actor: string,
  now: string,
): DatasetMetadata & { facts: ResearchFact[] } {
  const str = (value: unknown, fallback: string, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : fallback);
  const edits = new Map<string, any>((Array.isArray(edit?.facts) ? edit.facts : []).filter((f: any) => typeof f?.id === "string").map((f: any) => [f.id, f]));
  const facts = existing.facts.map((fact) => {
    const change = edits.get(fact.id);
    if (!change) return fact;
    const next: ResearchFact = { ...fact };
    for (const field of FACT_TEXT_FIELDS) next[field] = str(change[field], fact[field], field === "statement" ? 400 : 160);
    if (next.statement.length < 12) next.statement = fact.statement;
    if (typeof change.measure === "string" && (FACT_MEASURES as string[]).includes(change.measure)) next.measure = change.measure;
    if (FACT_TEXT_FIELDS.some((field) => next[field] !== fact[field]) || next.measure !== fact.measure) next.edited = true;
    const status = ["pending", "approved", "rejected"].includes(change.status) ? (change.status as FactStatus) : fact.status;
    if (status !== fact.status || next.edited !== fact.edited) {
      next.status = status;
      next.reviewedBy = actor;
      next.reviewedAt = now;
    }
    return next;
  });
  return {
    title: str(edit?.title, existing.title, 160) || existing.title,
    provider: isPartnerProviderId(edit?.provider) ? edit.provider : existing.provider,
    providerLabel: str(edit?.providerLabel, existing.providerLabel, 120),
    advertiserName: str(edit?.advertiserName, existing.advertiserName, 120),
    category: str(edit?.category, existing.category, 80),
    markets: Array.isArray(edit?.markets) ? edit.markets.map((m: unknown) => str(m, "", 60)).filter(Boolean).slice(0, 30) : existing.markets,
    period: str(edit?.period, existing.period, 60),
    description: str(edit?.description, existing.description, 300),
    notes: str(edit?.notes, existing.notes ?? "", 600),
    facts,
  };
}
