// Partner research after a plan exists, and what it adds on top of the prose: the competitive
// landscape built from partner spend data, budget moves the data argues for, and library datasets
// worth suggesting for a new brief.
//
// The model chooses; code supplies every number. The competitive landscape's values are parsed
// from the approved facts the model points at, never typed by it, and an allocation reason may
// only quote figures its cited facts contain. Pure: shared by the server and the browser.

import {
  clientPeriod,
  creditFor,
  isPartnerTier,
  partnerSources,
  PARTNER_DOSSIER_LABEL,
  scrubForAdvertiser,
  toAdvertiserKey,
  type PartnerEvidence,
  type PartnerProvider,
  type PartnerProviderId,
  type ResearchDataset,
  type ResearchDatasetSummary,
  type ResearchFact,
} from "./partnerData";

// ---- Figures ----

/** "$1,832,959" -> 1832959, "1.3M" -> 1300000, "58.7%" -> 58.7. Null when it is not one number. */
export function parseFigure(figure: string): number | null {
  const text = String(figure ?? "").trim();
  const m = text.match(/^[^\d-]{0,4}(-?\d[\d,]*(?:\.\d+)?)\s*([kmb]|thousand|million|billion)?\s*%?\s*$/i);
  if (!m) return null;
  const value = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  const unit = (m[2] || "").toLowerCase();
  const scale = unit.startsWith("k") || unit === "thousand" ? 1e3 : unit.startsWith("m") ? 1e6 : unit.startsWith("b") ? 1e9 : 1;
  return value * scale;
}

/** The numbers a sentence states, as written ("$4.2M", "61%", "2.3x"), normalised for comparison. */
function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of String(text).matchAll(/\$?\d[\d,]*(?:\.\d+)?\s*(?:[kmb]\b|thousand|million|billion)?/gi)) {
    const n = parseFigure(m[0].replace(/\s+/g, ""));
    if (n !== null) out.push(n);
  }
  return out;
}

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.051, Math.abs(b) * 0.005);

// ---- Fact references the model can cite ----

/** Approved facts under short refs (F1, F2, ...), so a prompt stays small and a citation is checkable. */
export interface FactRef {
  ref: string;
  fact: ResearchFact;
  dataset: ResearchDataset;
  credit: string;
}

export function factRefs(datasets: ResearchDataset[], providers?: PartnerProvider[], filter: (f: ResearchFact) => boolean = () => true, max = 160): FactRef[] {
  const refs: FactRef[] = [];
  for (const dataset of datasets) {
    if (dataset.archived) continue;
    const credit = creditFor(dataset, providers);
    for (const fact of dataset.facts) {
      if (fact.status !== "approved" || !filter(fact)) continue;
      if (refs.length >= max) return refs;
      refs.push({ ref: `F${refs.length + 1}`, fact, dataset, credit });
    }
  }
  return refs;
}

function refLines(refs: FactRef[], planAdvertiser: string): string {
  return refs.map(({ ref, fact, dataset, credit }) => {
    const scrub = (s: string) => scrubForAdvertiser(s, dataset.advertiserName, planAdvertiser);
    const q = [`figure: ${fact.figure}`, `measure: ${fact.measure}`, fact.population && `population: ${scrub(fact.population)}`, fact.geography && `geography: ${fact.geography}`, fact.period && `period: ${fact.period}`, `source: ${credit}`].filter(Boolean);
    return `[${ref}] ${scrub(fact.statement)} (${q.join("; ")})`;
  }).join("\n");
}

// ---- Competitive landscape ----

export interface CompetitiveRow {
  name: string;
  spend: number;
  /** The plan's own advertiser, shown as "You" rather than as a competitor. */
  isAdvertiser?: boolean;
}

export interface CompetitiveMarket {
  market: string;
  totalSpend?: number;
  leader?: string;
  leaderSpend?: number;
  leaderShare?: number;
}

export interface CompetitiveLandscape {
  datasetId: string;
  provider: PartnerProviderId;
  providerLabel: string;
  scope: string;
  period: string;
  totalSpend?: number;
  competitors: CompetitiveRow[];
  mediaTypes: CompetitiveRow[];
  markets: CompetitiveMarket[];
  /** Computed from the rows above, never written by the model. */
  highlights: string[];
}

/** A dataset with enough spend figures to draw a landscape from, the richest first. */
export function competitiveSource(datasets: ResearchDataset[]): ResearchDataset | null {
  const scored = datasets
    .filter((d) => !d.archived)
    .map((d) => ({ d, n: d.facts.filter((f) => f.status === "approved" && f.measure === "spend").length }))
    .filter((x) => x.n >= 4)
    .sort((a, b) => b.n - a.n);
  return scored[0]?.d ?? null;
}

export const COMPETITIVE_SYSTEM_INSTRUCTION = `You organise a data partner's advertising-spend figures into a competitive landscape for a client's media plan. You do not write numbers: you point at the numbered figures (F1, F2, ...) that hold them, and code reads the values from those figures.

Rules:
1. competitors: one entry per advertiser or brand, each citing the ONE figure that states that advertiser's total spend for the widest scope the data covers (e.g. across all markets). Use the advertiser's name exactly as the figure's sentence writes it. Never list the same advertiser twice, and never cite a share or a per-market figure here.
2. mediaTypes: one entry per media type or channel (e.g. AVOD, Mobile App, Browser Display), each citing the figure for its spend across the same widest scope. Leave it empty if the data has no media-type split.
3. markets: one entry per market the data reports separately, citing (when present) the figure for the market's total spend, its leading advertiser's spend, and that leader's share. Leave a field empty when no figure states it.
4. scope: a few words for what the competitor and media-type figures cover (e.g. "Seven-market portfolio"). totalFigure: the figure for total competitive spend across that scope, if one exists.
5. If the figures disagree (two totals for the same thing), prefer the summary or headline figure and use it consistently.
6. Use only figures listed below. Return empty lists rather than guess.`;

export const competitiveSchema = {
  type: "object",
  properties: {
    scope: { type: "string" },
    totalFigure: { type: "string", description: "A ref like F3, or empty." },
    competitors: { type: "array", items: { type: "object", properties: { name: { type: "string" }, figure: { type: "string" } }, required: ["name", "figure"] } },
    mediaTypes: { type: "array", items: { type: "object", properties: { name: { type: "string" }, figure: { type: "string" } }, required: ["name", "figure"] } },
    markets: {
      type: "array",
      items: {
        type: "object",
        properties: {
          market: { type: "string" },
          totalFigure: { type: "string" },
          leader: { type: "string" },
          leaderSpendFigure: { type: "string" },
          leaderShareFigure: { type: "string" },
        },
        required: ["market"],
      },
    },
  },
  required: ["scope", "competitors", "mediaTypes", "markets"],
};

export function competitiveInput(dataset: ResearchDataset, planAdvertiser: string, providers?: PartnerProvider[]): { input: string; refs: FactRef[] } {
  const refs = factRefs([dataset], providers, (f) => f.measure === "spend" || f.measure === "share", 120);
  return {
    refs,
    input: `ADVERTISER THIS PLAN IS FOR: ${planAdvertiser}\n\nFIGURES (${creditFor(dataset, providers)}${dataset.period ? `, ${dataset.period}` : ""}):\n${refLines(refs, planAdvertiser)}`,
  };
}

const sameName = (a: string, b: string) => toAdvertiserKey(a) === toAdvertiserKey(b);
const mentions = (text: string, name: string) => {
  const key = toAdvertiserKey(name);
  return key.length > 0 && toAdvertiserKey(text).includes(key);
};

/**
 * Turns the model's choices into the landscape. A row survives only if its figure is an approved
 * fact of the right measure whose sentence names it; the value is the fact's own figure. A row
 * about the client a dataset was first prepared for is dropped when the plan is someone else's.
 */
export function normalizeCompetitive(
  raw: unknown,
  dataset: ResearchDataset,
  refs: FactRef[],
  options: { planAdvertiser: string; providers?: PartnerProvider[] },
): CompetitiveLandscape | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, any>;
  const byRef = new Map(refs.map((x) => [x.ref, x.fact]));
  const madeFor = dataset.advertiserName.trim();
  const otherClient = (name: string) => Boolean(madeFor) && !sameName(madeFor, options.planAdvertiser) && (sameName(name, madeFor) || mentions(name, madeFor));
  const valueOf = (ref: unknown, measure: "spend" | "share", mustName?: string): number | undefined => {
    const fact = byRef.get(String(ref ?? "").trim().toUpperCase());
    if (!fact || fact.measure !== measure) return undefined;
    if (mustName && !mentions(`${fact.statement} ${fact.population} ${fact.geography}`, mustName)) return undefined;
    const n = parseFigure(fact.figure);
    if (n === null || n < 0 || (measure === "share" && n > 100)) return undefined;
    return n;
  };
  const rows = (list: unknown, cap: number): CompetitiveRow[] => {
    const seen = new Set<string>();
    const out: CompetitiveRow[] = [];
    for (const item of Array.isArray(list) ? list : []) {
      const name = String(item?.name ?? "").trim();
      if (!name || seen.has(toAdvertiserKey(name)) || otherClient(name)) continue;
      const spend = valueOf(item?.figure, "spend", name);
      if (spend === undefined) continue;
      seen.add(toAdvertiserKey(name));
      out.push({ name, spend, ...(sameName(name, options.planAdvertiser) ? { isAdvertiser: true } : {}) });
    }
    return out.sort((a, b) => b.spend - a.spend).slice(0, cap);
  };

  const competitors = rows(r.competitors, 10);
  const mediaTypes = rows(r.mediaTypes, 8);
  const markets: CompetitiveMarket[] = [];
  for (const m of Array.isArray(r.markets) ? r.markets : []) {
    const market = String(m?.market ?? "").trim();
    if (!market || markets.some((x) => sameName(x.market, market))) continue;
    const leaderName = String(m?.leader ?? "").trim();
    const leader = leaderName && !otherClient(leaderName) ? leaderName : "";
    const entry: CompetitiveMarket = { market };
    const total = valueOf(m?.totalFigure, "spend", market);
    if (total !== undefined) entry.totalSpend = total;
    if (leader) {
      const spend = valueOf(m?.leaderSpendFigure, "spend", leader);
      const share = valueOf(m?.leaderShareFigure, "share", market);
      if (spend !== undefined || share !== undefined) {
        entry.leader = leader;
        if (spend !== undefined) entry.leaderSpend = spend;
        if (share !== undefined) entry.leaderShare = share;
      }
    }
    if (entry.totalSpend !== undefined || entry.leader) markets.push(entry);
    if (markets.length >= 12) break;
  }
  if (competitors.length < 2 && mediaTypes.length < 2 && markets.length < 2) return null;

  const totalSpend = valueOf(r.totalFigure, "spend");
  const landscape: CompetitiveLandscape = {
    datasetId: dataset.id,
    provider: dataset.provider,
    providerLabel: creditFor(dataset, options.providers),
    scope: String(r.scope ?? "").trim().slice(0, 80) || "Markets in this plan",
    period: clientPeriod(dataset.period),
    ...(totalSpend !== undefined ? { totalSpend } : {}),
    competitors,
    mediaTypes,
    markets,
    highlights: [],
  };
  landscape.highlights = competitiveHighlights(landscape);
  return landscape;
}

/**
 * A landscape sent back to be saved, checked again: every value must still be an approved spend
 * (or share) figure of its dataset whose sentence names the row. Rows that fail are dropped, and
 * the highlights are recomputed from what is left.
 */
export function verifyCompetitive(raw: any, dataset: ResearchDataset | undefined, planAdvertiser: string, providers?: PartnerProvider[]): CompetitiveLandscape | null {
  if (!raw || typeof raw !== "object" || !dataset || raw.datasetId !== dataset.id) return null;
  const approved = dataset.facts.filter((f) => f.status === "approved");
  const backed = (value: unknown, measure: "spend" | "share", ...names: string[]) => {
    const n = Number(value);
    return Number.isFinite(n) && approved.some((f) => {
      const v = f.measure === measure ? parseFigure(f.figure) : null;
      return v !== null && close(n, v) && names.every((name) => mentions(`${f.statement} ${f.population} ${f.geography}`, name));
    });
  };
  const madeFor = dataset.advertiserName.trim();
  const otherClient = (name: string) => Boolean(madeFor) && !sameName(madeFor, planAdvertiser) && mentions(name, madeFor);
  const rows = (list: unknown): CompetitiveRow[] => (Array.isArray(list) ? list : [])
    .map((r: any) => ({ name: String(r?.name ?? "").trim(), spend: Number(r?.spend) }))
    .filter((r) => r.name && !otherClient(r.name) && backed(r.spend, "spend", r.name))
    .map((r) => ({ ...r, ...(sameName(r.name, planAdvertiser) ? { isAdvertiser: true } : {}) }))
    .slice(0, 10);
  const markets: CompetitiveMarket[] = [];
  for (const m of Array.isArray(raw.markets) ? raw.markets.slice(0, 12) : []) {
    const market = String(m?.market ?? "").trim();
    if (!market) continue;
    const entry: CompetitiveMarket = { market };
    if (m.totalSpend !== undefined && backed(m.totalSpend, "spend", market)) entry.totalSpend = Number(m.totalSpend);
    const leader = String(m?.leader ?? "").trim();
    if (leader && !otherClient(leader)) {
      const spendOk = m.leaderSpend !== undefined && backed(m.leaderSpend, "spend", leader);
      const shareOk = m.leaderShare !== undefined && backed(m.leaderShare, "share", market);
      if (spendOk || shareOk) {
        entry.leader = leader;
        if (spendOk) entry.leaderSpend = Number(m.leaderSpend);
        if (shareOk) entry.leaderShare = Number(m.leaderShare);
      }
    }
    if (entry.totalSpend !== undefined || entry.leader) markets.push(entry);
  }
  const competitors = rows(raw.competitors);
  const mediaTypes = rows(raw.mediaTypes);
  if (competitors.length < 2 && mediaTypes.length < 2 && markets.length < 2) return null;
  const totalSpend = raw.totalSpend !== undefined && backed(raw.totalSpend, "spend") ? Number(raw.totalSpend) : undefined;
  const landscape: CompetitiveLandscape = {
    datasetId: dataset.id,
    provider: dataset.provider,
    providerLabel: creditFor(dataset, providers),
    scope: String(raw.scope ?? "").trim().slice(0, 80) || "Markets in this plan",
    period: clientPeriod(dataset.period),
    ...(totalSpend !== undefined ? { totalSpend } : {}),
    competitors,
    mediaTypes,
    markets,
    highlights: [],
  };
  landscape.highlights = competitiveHighlights(landscape);
  return landscape;
}

export function formatSpend(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.?0+$/, "")}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

/** Plain-language lines computed from the rows, so the panel's one claim is arithmetic, not prose. */
export function competitiveHighlights(l: Pick<CompetitiveLandscape, "competitors" | "mediaTypes" | "markets" | "totalSpend">): string[] {
  const out: string[] = [];
  // Against the competitors listed, not the dataset's headline total: a total often counts other
  // spend too (property-level campaigns, say), which would understate how concentrated it is.
  const rivals = l.competitors.filter((c) => !c.isAdvertiser);
  const rivalTotal = rivals.reduce((s, c) => s + c.spend, 0);
  if (rivals.length >= 3 && rivalTotal > 0) {
    const top = rivals[0].spend + rivals[1].spend;
    out.push(`${rivals[0].name} and ${rivals[1].name} account for ${Math.round((top / rivalTotal) * 100)}% of spend among the ${rivals.length} competitors shown.`);
  }
  const mediaTotal = l.mediaTypes.reduce((s, c) => s + c.spend, 0);
  if (l.mediaTypes.length >= 2 && mediaTotal > 0) {
    out.push(`${l.mediaTypes[0].name} is the largest media type, at ${Math.round((l.mediaTypes[0].spend / mediaTotal) * 100)}% of competitor spend by media type.`);
  }
  const led = l.markets.filter((m) => m.leader);
  const leaders = [...new Set(led.map((m) => m.leader as string))];
  if (led.length >= 3 && leaders.length >= 1) {
    const counts = leaders.map((name) => ({ name, n: led.filter((m) => m.leader === name).length })).sort((a, b) => b.n - a.n);
    out.push(counts.length === 1 ? `${counts[0].name} leads competitive spend in every market reported.` : `${counts[0].name} leads competitive spend in ${counts[0].n} of ${led.length} markets.`);
  }
  return out;
}

// ---- Budget moves the partner data argues for ----

export interface AllocationChannel {
  channelId: string;
  channelName: string;
  allocationPercent: number;
  minPercent?: number;
  maxPercent?: number;
  locked?: boolean;
}

export interface AllocationProposal {
  id: string;
  title: string;
  /** Client-facing: why the data argues for it. Every figure it states is in a cited fact. */
  reason: string;
  /** The partners whose figures it rests on, as credited in the plan. */
  credits: string[];
  /** The cited facts' sentences, shown to the planner reviewing the proposal. */
  evidence: string[];
  /** The approved facts it cites, so the server can check it again when it is applied. */
  factIds: string[];
  moves: Array<{ channelId: string; percent: number }>;
}

export const ALLOCATION_SYSTEM_INSTRUCTION = `You are a senior media strategist at Digital Remedy. A media plan has already been built. Licensed partner research has now been added to it. Decide whether that research clearly argues for moving budget between the plan's media types.

The default answer is NO CHANGE: the research mostly reinforces the plan, and an empty list is the right answer most of the time. Propose a move only when specific partner figures directly support it, for example: competitors concentrate spend in a media type the plan underweights, or the audience indexes strongly on a channel the plan funds lightly.

Rules:
1. At most 2 proposals. Each sets new target percentages ("moves") for the media types it changes; the plan rebalances the rest automatically. Shift at most 10 percentage points per proposal. Never move a locked media type, and stay within each media type's min and max.
2. You may add a media type from ADDABLE only if the research names it directly.
3. title: at most 8 words, the action (e.g. "Shift budget toward AVOD/CTV").
4. reason: 1-2 sentences the client will read. Name the partner and quote the figure that drives the move, copied exactly as the figure states it (e.g. "MediaRadar shows competitors put $4,986,715 into AVOD, the largest media type."). Never state a number that is not in a cited figure. No hedging, no internal notes.
5. figures: the refs (F1, F2, ...) the reason rests on. At least one.`;

export const allocationSchema = {
  type: "object",
  properties: {
    proposals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          reason: { type: "string" },
          figures: { type: "array", items: { type: "string" } },
          moves: { type: "array", items: { type: "object", properties: { channelId: { type: "string" }, percent: { type: "number" } }, required: ["channelId", "percent"] } },
        },
        required: ["title", "reason", "figures", "moves"],
      },
    },
  },
  required: ["proposals"],
};

export function allocationInput(ctx: { campaign: string; channels: AllocationChannel[]; addable: Array<{ channelId: string; channelName: string }>; refs: FactRef[]; planAdvertiser: string }): string {
  const channels = ctx.channels.map((c) => `- ${c.channelId} (${c.channelName}): ${c.allocationPercent}%${c.locked ? " LOCKED" : ""}${c.minPercent !== undefined ? ` min ${c.minPercent}%` : ""}${c.maxPercent !== undefined ? ` max ${c.maxPercent}%` : ""}`).join("\n");
  const addable = ctx.addable.map((c) => `- ${c.channelId} (${c.channelName})`).join("\n") || "(none)";
  return `${ctx.campaign}\n\nCURRENT MEDIA MIX (share of working budget):\n${channels}\n\nADDABLE MEDIA TYPES:\n${addable}\n\nPARTNER FIGURES:\n${refLines(ctx.refs, ctx.planAdvertiser)}`;
}

/**
 * Keeps the proposals code can stand behind: each cites approved figures, quotes no number they do
 * not contain, and moves only media types the plan has (or may add) within its limits. Whether a
 * move actually applies is decided by the server's dry run of the plan's own operations.
 */
export function normalizeAllocationProposals(
  raw: unknown,
  ctx: { channels: AllocationChannel[]; addable: Array<{ channelId: string }>; refs: FactRef[]; planAdvertiser: string; newId: () => string },
): AllocationProposal[] {
  const list = Array.isArray((raw as any)?.proposals) ? (raw as any).proposals : [];
  const byRef = new Map(ctx.refs.map((x) => [x.ref, x]));
  const out: AllocationProposal[] = [];
  for (const p of list) {
    if (out.length >= 2) break;
    const cited = [...new Set((Array.isArray(p?.figures) ? p.figures : []).map((f: unknown) => String(f).trim().toUpperCase()))]
      .map((ref) => byRef.get(ref as string))
      .filter((x): x is FactRef => Boolean(x));
    if (cited.length === 0) continue;
    const scrub = (s: string) => cited.reduce((acc, c) => scrubForAdvertiser(acc, c.dataset.advertiserName, ctx.planAdvertiser), s);
    const reason = scrub(String(p?.reason ?? "").trim());
    const title = scrub(String(p?.title ?? "").trim()).slice(0, 80);
    if (!reason || !title) continue;
    const known = cited.flatMap((c) => [...numbersIn(c.fact.figure), ...numbersIn(c.fact.statement)]);
    if (!numbersIn(reason).every((n) => known.some((k) => close(n, k)))) continue;

    const moves: AllocationProposal["moves"] = [];
    let valid = true;
    for (const m of Array.isArray(p?.moves) ? p.moves : []) {
      const channelId = String(m?.channelId ?? "");
      const percent = Math.round(Number(m?.percent));
      const channel = ctx.channels.find((c) => c.channelId === channelId);
      const addable = !channel && ctx.addable.some((c) => c.channelId === channelId);
      if ((!channel && !addable) || !Number.isFinite(percent) || percent < 1 || percent > 90 || moves.some((x) => x.channelId === channelId)) { valid = false; break; }
      if (channel) {
        if (channel.locked || Math.abs(percent - channel.allocationPercent) > 10) { valid = false; break; }
        if (channel.minPercent !== undefined && percent < channel.minPercent) { valid = false; break; }
        if (channel.maxPercent !== undefined && percent > channel.maxPercent) { valid = false; break; }
        if (percent === channel.allocationPercent) continue;
      } else if (percent > 10) { valid = false; break; }
      moves.push({ channelId, percent });
    }
    if (!valid || moves.length === 0) continue;
    out.push({
      id: ctx.newId(),
      title,
      reason,
      credits: [...new Set(cited.map((c) => c.credit))],
      evidence: cited.map((c) => scrubForAdvertiser(c.fact.statement, c.dataset.advertiserName, ctx.planAdvertiser)),
      factIds: cited.map((c) => c.fact.id),
      moves,
    });
  }
  return out;
}

/**
 * A proposal sent back to be applied, checked again on the server: it was shown to the planner by
 * the browser, so its words are re-tested against the facts it cites as they stand now (a figure
 * may have been rejected since). Returns what the client will read, or null.
 */
export function verifyProposal(raw: any, datasets: ResearchDataset[], planAdvertiser: string, providers?: PartnerProvider[]): Pick<AllocationProposal, "title" | "reason" | "credits" | "moves"> | null {
  const ids = new Set((Array.isArray(raw?.factIds) ? raw.factIds : []).map(String));
  const cited = factRefs(datasets, providers, (f) => ids.has(f.id), 500);
  if (cited.length === 0) return null;
  const scrub = (s: string) => cited.reduce((acc, c) => scrubForAdvertiser(acc, c.dataset.advertiserName, planAdvertiser), s);
  const title = scrub(String(raw?.title ?? "").trim()).slice(0, 80);
  const reason = scrub(String(raw?.reason ?? "").trim()).slice(0, 600);
  if (!title || !reason) return null;
  const known = cited.flatMap((c) => [...numbersIn(c.fact.figure), ...numbersIn(c.fact.statement)]);
  if (!numbersIn(reason).every((n) => known.some((k) => close(n, k)))) return null;
  const moves = (Array.isArray(raw?.moves) ? raw.moves : [])
    .map((m: any) => ({ channelId: String(m?.channelId ?? ""), percent: Math.round(Number(m?.percent)) }))
    .filter((m: { channelId: string; percent: number }) => m.channelId && Number.isFinite(m.percent) && m.percent >= 1 && m.percent <= 90);
  if (moves.length === 0) return null;
  return { title, reason, credits: [...new Set(cited.map((c) => c.credit))], moves };
}

/** The plan operations that carry a proposal out: adds first, then the targets, solved together. */
export function proposalOps(proposal: Pick<AllocationProposal, "moves">, currentChannelIds: string[]) {
  return [
    ...proposal.moves.filter((m) => !currentChannelIds.includes(m.channelId)).map((m) => ({ type: "add_channel" as const, channelId: m.channelId })),
    ...proposal.moves.map((m) => ({ type: "set_allocation" as const, channelId: m.channelId, percent: m.percent })),
  ];
}

/** What the client reads about a budget move the partner data made. */
export interface PartnerAllocationChange {
  title: string;
  reason: string;
  credits: string[];
  appliedAt: string;
  by: string;
}

// ---- The narrative, rewritten with the partner data ----

/** The narrative fields the reinforcement pass may rewrite. Anything else is refused on apply. */
export const NARRATIVE_FIELDS: Record<string, string> = {
  intro: "Introduction",
  takeaways: "Key takeaways",
  recommendations: "Strategic recommendations",
  "demographics.overview": "Demographics overview",
  "demographics.geographyNotes": "Geography notes",
  "browserAndReach.overview": "Browser and reach overview",
  "deviceTypeIndex.overview": "Device overview",
  "temporalPatterns.overview": "Timing overview",
  "temporalPatterns.activationNotes": "Activation notes",
  publisherInsights: "CTV publisher insights",
  publisherHighlights: "CTV publisher highlights",
};

const getAt = (obj: any, path: string) => path.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);
function setAt(obj: any, path: string, value: unknown) {
  const keys = path.split(".");
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] && typeof o[k] === "object" ? o[k] : (o[k] = {});
  o[keys[keys.length - 1]] = value;
}

const kindOf = (v: unknown) => (typeof v === "string" ? "string" : Array.isArray(v) ? "array" : v && typeof v === "object" ? "object" : "other");

export interface NarrativeChange {
  path: string;
  label: string;
  before: unknown;
  after: unknown;
}

/** The fields the rewrite actually changed, in the order a reader meets them. */
export function narrativeChanges(before: any, after: any): NarrativeChange[] {
  return Object.entries(NARRATIVE_FIELDS)
    .map(([path, label]) => ({ path, label, before: getAt(before, path), after: getAt(after, path) }))
    .filter((c) => c.after !== undefined && JSON.stringify(c.before) !== JSON.stringify(c.after));
}

/**
 * Writes the changes a planner kept. A field is written only if it still reads what the planner saw
 * (an auto-save or a colleague may have edited it since), and only if it is a narrative field whose
 * new value has the old one's shape.
 */
export function applyNarrativeChanges(profile: any, accepted: unknown): { applied: string[]; stale: string[] } {
  const applied: string[] = [];
  const stale: string[] = [];
  for (const c of Array.isArray(accepted) ? accepted : []) {
    const path = String(c?.path ?? "");
    if (!(path in NARRATIVE_FIELDS) || applied.includes(path)) continue;
    const current = getAt(profile, path);
    const after = c?.after;
    // The new value must have the old one's shape: text, a list (takeaways), or an object (the
    // publisher highlights). A field that did not exist yet takes any non-empty value.
    const shapeOk = (kindOf(after) === "string" ? after.trim().length > 0 : kindOf(after) === "array" ? after.length > 0 : kindOf(after) === "object")
      && (current === undefined || kindOf(current) === kindOf(after));
    if (!shapeOk) continue;
    if (JSON.stringify(current ?? null) !== JSON.stringify(c?.before ?? null)) { stale.push(path); continue; }
    setAt(profile, path, typeof after === "string" ? after.trim() : after);
    applied.push(path);
  }
  return { applied, stale };
}

// ---- Writing the partner research onto a plan ----

/**
 * Puts a partner dossier on a profile: the evidence the client panel reads, the partners at the head
 * of the sources (replacing any earlier partner entries), and the dossier in the research snapshot
 * so a later QA audit traces partner figures. Budget moves the data already made stay recorded.
 */
export function attachPartnerResearch(
  profile: any,
  partner: { dossier: { label: string; text: string }; evidence: PartnerEvidence } | null,
  options: { competitive?: CompetitiveLandscape | null; snapshotMaxChars: number },
) {
  const previous: PartnerEvidence | undefined = profile.partnerEvidence;
  const sources: any[] = (Array.isArray(profile.sources) ? profile.sources : []).filter((s: any) => !isPartnerTier(s?.tier));
  if (!partner) {
    delete profile.partnerEvidence;
    profile.sources = sources;
  } else {
    const fromPartners = partnerSources(partner.evidence);
    const names = new Set(fromPartners.map((s) => s.name.toLowerCase()));
    profile.sources = [...fromPartners, ...sources.filter((s: any) => !names.has(String(s?.name || "").toLowerCase()))];
    profile.partnerEvidence = {
      ...partner.evidence,
      ...(options.competitive ? { competitive: options.competitive } : {}),
      ...(previous?.allocationChanges?.length ? { allocationChanges: previous.allocationChanges } : {}),
    };
  }
  const snapshot = profile.researchSnapshot && typeof profile.researchSnapshot === "object" ? profile.researchSnapshot : null;
  if (snapshot || partner) {
    const dossiers = (Array.isArray(snapshot?.dossiers) ? snapshot.dossiers : []).filter((d: any) => d?.label !== PARTNER_DOSSIER_LABEL);
    if (partner) dossiers.push({ label: partner.dossier.label, failed: false, text: partner.dossier.text.slice(0, options.snapshotMaxChars) });
    profile.researchSnapshot = { ...(snapshot || { capturedAt: new Date().toISOString() }), dossiers };
  }
}

// ---- Library suggestions for a new brief ----

const STOP = new Set("about after also among and audience based brand campaign data from have home into more most other over plan report research spend than that their there these this those through with your across market markets general total insights".split(" "));
const words = (text: string) => new Set(String(text).toLowerCase().match(/[a-z][a-z0-9]{3,}/g)?.filter((w) => !STOP.has(w)) ?? []);

export interface DatasetSuggestion {
  id: string;
  reason: string;
}

/**
 * Other advertisers' research that fits this brief: the same category, or the same markets. Never
 * ticked automatically (it was made for another client), only offered, best match first.
 */
export function suggestDatasets(
  datasets: ResearchDatasetSummary[],
  brief: { advertiserName: string; text: string; geography: string },
  max = 3,
): DatasetSuggestion[] {
  const own = toAdvertiserKey(brief.advertiserName);
  const briefWords = words(`${brief.advertiserName} ${brief.text}`);
  const geo = String(brief.geography || "").toLowerCase();
  const scored: Array<DatasetSuggestion & { score: number }> = [];
  for (const d of datasets) {
    if (d.archived || d.factCounts.approved === 0 || (own && d.advertiserKey === own)) continue;
    const categoryWords = [...words(d.category)];
    const categoryHits = categoryWords.filter((w) => briefWords.has(w));
    const topicHits = [...words(`${d.title} ${d.description}`)].filter((w) => briefWords.has(w) && !categoryHits.includes(w));
    const marketHits = geo ? d.markets.filter((m) => {
      const city = m.toLowerCase().split(/[,-]/)[0].replace(/\bdma\b/, "").trim();
      return city.length >= 4 && geo.includes(city);
    }) : [];
    const score = categoryHits.length * 3 + Math.min(topicHits.length, 3) + Math.min(marketHits.length, 3) * 2;
    if (score < 3) continue;
    const reason = categoryHits.length > 0
      ? `Same category: ${d.category}${marketHits.length ? `, covers ${marketHits.slice(0, 2).join(", ")}` : ""}`
      : marketHits.length > 0
        ? `Covers ${marketHits.slice(0, 3).join(", ")}`
        : `Related topic: ${topicHits.slice(0, 3).join(", ")}`;
    scored.push({ id: d.id, reason, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, max).map(({ id, reason }) => ({ id, reason }));
}
