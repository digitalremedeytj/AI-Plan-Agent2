// Past campaigns at plan generation: what the planner's chosen campaigns from the advertiser's
// library tell the steps that build a new plan. Each step gets only what it can act on:
// - the channel reasoning gets each media type's results, mapped to the catalog, and the review's
//   findings, as historical_performance evidence for its scores (the engine allocates by score);
// - the publisher pick gets each CTV publisher's results, mapped to the enabled pool;
// - the QA audit gets the client's own data as a source, so a figure quoted from it is traced
//   rather than flagged as unsupported.
// It is never mixed into the research dossiers: chart points are labelled "from research" when
// the research text holds their value, and report figures would match by accident.

import { isOwnCampaign, type LinkedCampaign } from "../assistant/performanceContext";
import { matchChannel, matchPublisher } from "../performance/matching";
import { isMediaTypeDimension, money, pct } from "../performance/campaign";
import { CAMPAIGN_GOALS } from "../performance/constants";
import { renderDigest } from "../performance/digest";
import { READING_RULES } from "../performance/readingRules";

const MAX_CAMPAIGNS = 3;
const PUBLISHERS_EACH = 8;
const DOSSIER_CHARS = 20000;

export interface CatalogChannel {
  id: string;
  name: string;
  aliases: string[];
}

export interface GenerationHistory {
  /** For the channel reasoning prompt. */
  channelBrief: string;
  /** For the CTV publisher section of the synthesis prompt. */
  publisherBrief: string;
  /** The client's own data as a citable source (audit, saved research snapshot). Null when none is the client's. */
  dossier: { label: string; text: string } | null;
  used: Array<{ id: string; name: string; own: boolean }>;
}

const dollars = (v: number | null) => (v === null ? "n/a" : money(v, v < 100 ? 2 : 0));

function campaignHeader(entry: LinkedCampaign, own: boolean): string {
  const goal = CAMPAIGN_GOALS.find((g) => g.id === entry.campaign.campaignGoal)?.label ?? "not stated";
  return own
    ? `=== ${entry.campaign.name}: ${entry.campaign.advertiserName}'s own past campaign; optimised for ${goal} ===`
    : `=== ${entry.campaign.name}: NOT this client's campaign (${entry.analysis.advertiser ?? entry.campaign.advertiserName}); patterns only, never cite its figures; optimised for ${goal} ===`;
}

function findingLines(entry: LinkedCampaign): string[] {
  if (!entry.review || entry.reviewStale) return [];
  return [
    `Review summary: ${entry.review.summary}`,
    ...entry.review.findings.map((f) => `- (${f.kind === "didnt" ? "did not work" : f.kind === "watch" ? "caveat" : "worked"}, ${f.confidence} confidence) ${f.headline}. ${f.detail}`),
  ];
}

function mediaTypeLines(entry: LinkedCampaign, channels: CatalogChannel[]): string[] {
  const report = entry.analysis.breakdowns.find((b) => b.role !== "reference" && isMediaTypeDimension(b.dimension));
  if (!report) return [];
  const credit = new Map((entry.analysis.attribution?.rows ?? []).map((r) => [r.mediaType, r]));
  return [
    "Media types (report name -> catalog channelId):",
    ...report.rows.map((row) => {
      const channel = matchChannel(row.name, channels);
      const shared = credit.get(row.name);
      return `- ${row.name} -> ${channel ? channel.id : "no catalog match"}: ${money(row.metrics.spend)} (${pct(row.spendShare, 1)} of spend), CPA ${dollars(row.cpa)}, PM ${row.pm?.toFixed(2) ?? "n/a"}${shared?.pmLinear != null ? `; with credit shared across the path, PM ${shared.pmLinear.toFixed(2)}` : "; last-touch credit"}${row.flags.includes("retargeting") ? " [retargeting: converts audiences built by other media]" : ""}`;
    }),
  ];
}

function publisherLines(entry: LinkedCampaign, pool: string[]): string[] {
  const report = entry.analysis.breakdowns.find((b) => b.role !== "reference" && /publisher/i.test(b.dimension));
  if (!report) return [];
  const rows = report.rows.filter((r) => !r.flags.includes("media-type-row") && r.pm !== null && !r.flags.includes("low-sample"));
  if (rows.length === 0) return [];
  const ranked = [...rows].sort((a, z) => (z.pm ?? 0) - (a.pm ?? 0));
  const describe = (r: typeof rows[number], rank: number) => {
    const inPool = matchPublisher(r.name, pool);
    const name = inPool ? `${r.name} (pool: '${inPool.name}'${inPool.approximate ? ", matched by name" : ""})` : `${r.name} (not in the pool)`;
    return `- ${name}: CPA ${dollars(r.cpa)}, PM ${r.pm!.toFixed(2)}, ranked ${rank} of ${ranked.length}${r.flags.includes("event") ? " [event or one-off buy]" : ""}`;
  };
  const best = ranked.slice(0, Math.ceil(PUBLISHERS_EACH / 2)).map((r, i) => describe(r, i + 1));
  const worst = ranked.slice(-Math.floor(PUBLISHERS_EACH / 2)).map((r) => describe(r, ranked.indexOf(r) + 1));
  return [`CTV publishers with 30+ conversions, ranked by PM (${ranked.length} of ${report.rows.length}):`, "Strongest:", ...best, "Weakest:", ...worst.filter((w) => !best.includes(w))];
}

export function buildGenerationHistory(
  linked: LinkedCampaign[],
  { advertiser, channels, publisherPool }: { advertiser: string; channels: CatalogChannel[]; publisherPool: string[] },
): GenerationHistory | null {
  if (linked.length === 0) return null;
  const chosen = [...linked].sort((a, b) => (b.campaign.flightEnd ?? "").localeCompare(a.campaign.flightEnd ?? "")).slice(0, MAX_CAMPAIGNS);
  const own = new Map(chosen.map((entry) => [entry, isOwnCampaign(entry, advertiser)]));

  const channelSections = chosen.map((entry) => [campaignHeader(entry, own.get(entry)!), ...findingLines(entry), ...mediaTypeLines(entry, channels)].join("\n"));
  const channelBrief = `PAST CAMPAIGN PERFORMANCE (chosen by the planner from the advertiser's library):
Use it as historical_performance evidence: a media type that converted efficiently for this client earns kpiAndFunnelFit and measurementFit credit, one that did not loses some, and say so in its rationale. Retargeting is the exception: its last-touch efficiency shows it closes demand other media built, not that it creates any, so it earns no extra credit for it and its rationale never calls it the most effective driver. Cite figures exactly as given, with sourceType "historical_performance", and only from the client's own campaigns. Rationale and evidence are shown to the client: write CPA, conversions and spend, never PM or "performance multiplier", which are internal. Rules for reading it:
${READING_RULES}

${channelSections.join("\n\n")}`;

  const publisherSections = chosen.map((entry) => {
    const lines = publisherLines(entry, publisherPool);
    return lines.length ? [campaignHeader(entry, own.get(entry)!), ...lines].join("\n") : "";
  }).filter(Boolean);
  const publisherBrief = publisherSections.length
    ? `   PAST PUBLISHER PERFORMANCE (from campaigns the planner chose; PM is conversions per dollar against that campaign's average, 1 = average):
   Audience fit still comes first. Among publishers that fit, prefer ones that performed for this client, and do not repeat a clear underperformer without a reason in its 'why'. An event or one-off buy (a tournament, a PMP) says little about the publisher's regular inventory. In a 'why', a figure may be quoted only from the client's own campaign, exactly as given; never mention PM, which is internal.
${publisherSections.map((s) => s.split("\n").map((l) => `   ${l}`).join("\n")).join("\n\n")}`
    : "";

  const ownEntries = chosen.filter((entry) => own.get(entry));
  const dossier = ownEntries.length
    ? {
      label: `Past campaign performance (${ownEntries.map((e) => e.campaign.name).join("; ")}): the client's own report data`,
      text: ownEntries.map((entry) => [`${entry.campaign.name}`, ...findingLines(entry), renderDigest(entry.analysis, { maxChars: Math.floor(DOSSIER_CHARS / ownEntries.length) })].join("\n")).join("\n\n"),
    }
    : null;

  return {
    channelBrief,
    publisherBrief,
    dossier,
    used: chosen.map((entry) => ({ id: entry.campaign.id, name: entry.campaign.name, own: own.get(entry)! })),
  };
}
