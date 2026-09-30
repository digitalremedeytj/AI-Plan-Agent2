// Past campaign performance as ScoutAI reads it alongside the plan: each linked campaign's
// digest (already reconciled; see src/performance), whether it is this client's own data, and how
// the report's media types and publishers map onto this plan's channels and the CTV catalog, so a
// finding can become an operation on the plan rather than advice the planner has to translate.

import type { CampaignAnalysis } from "../performance/campaign";
import { isMediaTypeDimension } from "../performance/campaign";
import { CAMPAIGN_GOALS } from "../performance/constants";
import { renderDigest } from "../performance/digest";
import { READING_RULES } from "../performance/readingRules";
import type { MediaRecommendationPlan } from "../planning/types";
import { toAdvertiserKey } from "../storage/types";
import type { CatalogPublisher } from "./operations";
import { figureReference } from "../performance/figureCheck";
import type { PerformanceReview } from "../performance/review";
import { LEARNINGS_SECTION, readLearnings, type LearningCampaign } from "./learningOps";

export interface LinkedCampaign {
  campaign: { id: string; name: string; advertiserName: string; campaignGoal: string | null; flightEnd: string | null };
  analysis: CampaignAnalysis;
  review: PerformanceReview | null;
  /** The files or details changed after the review was written. */
  reviewStale: boolean;
}

/** The client's own campaign: the plan, the campaign and the files all name one advertiser. */
export function isOwnCampaign(linked: Pick<LinkedCampaign, "campaign" | "analysis">, planAdvertiser: string): boolean {
  const plan = toAdvertiserKey(planAdvertiser);
  return Boolean(plan) && toAdvertiserKey(linked.campaign.advertiserName) === plan
    && (!linked.analysis.advertiser || toAdvertiserKey(linked.analysis.advertiser) === plan);
}

/** What add_learning checks a learning against. An out-of-date review offers no findings. */
export function toLearningCampaign(linked: LinkedCampaign, planAdvertiser: string): LearningCampaign {
  return {
    id: linked.campaign.id,
    name: linked.campaign.name,
    own: isOwnCampaign(linked, planAdvertiser),
    findings: linked.review && !linked.reviewStale ? linked.review.findings.map((f) => ({ id: f.id, headline: f.headline, unverified: f.unverified })) : [],
    reference: figureReference(renderDigest(linked.analysis, { maxChars: 1_000_000 })),
  };
}

function reviewLines(linked: LinkedCampaign): string {
  const review = linked.review;
  if (!review) return "REVIEW FINDINGS: none yet (the planner has not had the review written).";
  return [
    `REVIEW FINDINGS (campaignId: ${linked.campaign.id}${linked.reviewStale ? "; OUT OF DATE: the reports changed after it was written, so it cannot be used for client learnings" : ""}):`,
    review.summary ? `Summary: ${review.summary}` : "",
    ...review.findings.map((f) => `[${f.id}] (${f.kind === "didnt" ? "did not work" : f.kind === "watch" ? "caveat" : "worked"}, ${f.confidence} confidence, ${f.area}) ${f.headline}. ${f.detail}${f.unverified.length ? ` [has figures not in the data: ${f.unverified.join(", ")}; not usable for client learnings]` : ""}`),
  ].filter(Boolean).join("\n");
}

/** The whole section; the first campaign gets most of it, since it is usually the one asked about. */
export const PERFORMANCE_CONTEXT_CHARS = 16000;
const FIRST_CAMPAIGN_CHARS = 11000;
const OTHER_CAMPAIGN_CHARS = 4500;
const MAX_CAMPAIGNS = 3;
const MAPPED_PUBLISHERS = 20;

// "+" is part of a streaming brand ("Discovery+" is not "Discovery"), so it survives as a word.
const squash = (name: string) => name.toLowerCase().replace(/\+/g, "plus").replace(/[^a-z0-9]/g, "");

interface Channel {
  id: string;
  name: string;
  aliases: string[];
}

/**
 * The plan channel a report's media type is. An exact name or alias wins; otherwise the longest
 * alias the name contains ("Pre-Roll/Mid-Roll" holds "preroll"), so "Display Retargeting" is
 * retargeting and not display.
 */
export function matchChannel(reportName: string, channels: Channel[]): Channel | null {
  const name = squash(reportName);
  if (!name) return null;
  const exact = channels.find((c) => squash(c.name) === name || c.aliases.some((a) => squash(a) === name));
  if (exact) return exact;
  let best: { channel: Channel; length: number } | null = null;
  for (const c of channels) {
    for (const alias of [c.name, ...c.aliases]) {
      const a = squash(alias);
      if (a.length >= 3 && name.includes(a) && (!best || a.length > best.length)) best = { channel: c, length: a.length };
    }
  }
  return best?.channel ?? null;
}

/**
 * "Pluto TV" is the catalog's "Pluto"; "DirecTV Stream" is "DirecTV". A match on a shared prefix
 * is approximate ("Paramount" may or may not be "Paramount+"), and is marked so.
 */
export function matchPublisher(reportName: string, names: string[]): { name: string; approximate: boolean } | null {
  const name = squash(reportName);
  if (!name) return null;
  const exact = names.find((n) => squash(n) === name);
  if (exact) return { name: exact, approximate: false };
  const prefix = names
    .filter((n) => squash(n).length >= 4 && (name.startsWith(squash(n)) || squash(n).startsWith(name)))
    .sort((a, b) => squash(b).length - squash(a).length);
  return prefix[0] ? { name: prefix[0], approximate: true } : null;
}

function channelsOf(plan: MediaRecommendationPlan | undefined): Channel[] {
  if (!plan) return [];
  return plan.evaluatedCandidates.map((c: any) => ({ id: c.product.id, name: c.product.displayName, aliases: Array.isArray(c.product.aliases) ? c.product.aliases : [] }));
}

function mappingLines(analysis: CampaignAnalysis, plan: MediaRecommendationPlan | undefined, planPublishers: string[], catalog: CatalogPublisher[]): string[] {
  const lines: string[] = [];
  const channels = channelsOf(plan);
  const inPlan = new Map((plan?.channels ?? []).map((c) => [c.channelId, c]));
  const mediaTypes = analysis.breakdowns.find((b) => b.role !== "reference" && isMediaTypeDimension(b.dimension));
  if (mediaTypes && channels.length) {
    lines.push("- Media types (report name -> this plan's media type):");
    for (const row of mediaTypes.rows) {
      const match = matchChannel(row.name, channels);
      const channel = match ? inPlan.get(match.id) : undefined;
      const status = !match
        ? "no matching media type in the catalog"
        : channel
          ? `${match.name} (channelId: ${match.id}), in this plan at ${channel.allocationPercent}%`
          : plan?.evaluatedCandidates.some((c) => c.product.id === match.id)
            ? `${match.name} (channelId: ${match.id}), not in this plan`
            : `${match.name}, not available`;
      lines.push(`  ${row.name} -> ${status}`);
    }
  }
  const publishers = analysis.breakdowns.find((b) => b.role !== "reference" && /publisher/i.test(b.dimension));
  if (publishers) {
    const catalogNames = catalog.filter((p) => p.enabled).map((p) => p.name);
    const rows = publishers.rows.filter((r) => !r.flags.includes("media-type-row")).slice(0, MAPPED_PUBLISHERS);
    const same = (m: { approximate: boolean }) => (m.approximate ? "probably" : "=");
    const described = rows.map((row) => {
      const planned = matchPublisher(row.name, planPublishers);
      if (planned) return `${row.name} ${same(planned)} ${planned.name} (in this plan)`;
      const available = matchPublisher(row.name, catalogNames);
      return available ? `${row.name} ${same(available)} ${available.name} (can be added)` : `${row.name} (not in the catalog; cannot be added)`;
    });
    if (described.length) lines.push(`- CTV publishers, largest spend first: ${described.join("; ")}`);
  }
  return lines;
}

export function buildPerformanceContext(
  linked: LinkedCampaign[],
  { planAdvertiser, plan, planPublishers, catalog, profile }: { planAdvertiser: string; plan?: MediaRecommendationPlan; planPublishers: string[]; catalog: CatalogPublisher[]; profile?: any },
): string {
  if (linked.length === 0) return "";
  const ordered = [...linked].sort((a, b) => (b.campaign.flightEnd ?? "").localeCompare(a.campaign.flightEnd ?? "")).slice(0, MAX_CAMPAIGNS);
  const sections = ordered.map((entry, index) => {
    const { campaign, analysis } = entry;
    const own = isOwnCampaign(entry, planAdvertiser);
    const goal = CAMPAIGN_GOALS.find((g) => g.id === campaign.campaignGoal)?.label;
    const mapping = mappingLines(analysis, plan, planPublishers, catalog);
    const review = reviewLines(entry);
    // The review is the considered read; the digest behind it gives up room first.
    const digestChars = (index === 0 ? FIRST_CAMPAIGN_CHARS : OTHER_CAMPAIGN_CHARS) - (index === 0 ? Math.min(review.length, 3500) : 0);
    return [
      `=== ${campaign.name} (${campaign.advertiserName}) ===`,
      own
        ? "This is the client's own past campaign."
        : `This is NOT this client's campaign (${analysis.advertiser ?? campaign.advertiserName}). Use it for patterns only; never present its figures as this client's results.`,
      `It optimised for: ${goal ?? "not stated. Say which measure you are judging it by"}.`,
      review,
      renderDigest(analysis, { maxChars: digestChars }),
      mapping.length ? ["HOW THE REPORT MAPS TO THIS PLAN:", ...mapping].join("\n") : "",
    ].filter(Boolean).join("\n");
  });
  const skipped = linked.length - ordered.length;
  const learnings = readLearnings(profile?.performanceLearnings);
  const hidden = Array.isArray(profile?.hiddenSections) && profile.hiddenSections.includes(LEARNINGS_SECTION);
  const learningLines = learnings.length
    ? [`CLIENT LEARNINGS IN THE PLAN (section "Built on your campaign history", ${hidden ? "hidden from the client" : "shown to the client"}; change with edit_learning / remove_learning by index):`, ...learnings.map((l, i) => `[${i}] (${l.campaignName}, ${l.findingId}) ${l.learning} -> ${l.action}`)].join("\n")
    : "CLIENT LEARNINGS IN THE PLAN: none yet (add with add_learning).";
  return [
    `PAST CAMPAIGN PERFORMANCE LINKED TO THIS PLAN (${linked.length} campaign${linked.length === 1 ? "" : "s"}${skipped ? `; the ${skipped} oldest left out for length` : ""}). Figures below are computed from the report files; quote them, do not recompute them.`,
    learningLines,
    ...sections,
  ].join("\n\n").slice(0, PERFORMANCE_CONTEXT_CHARS);
}

/** Rules for reading past performance; added to the system instruction only when there is some. */
export const PERFORMANCE_INSTRUCTION = `How you use past campaign performance (when the plan comes with PAST CAMPAIGN PERFORMANCE):
${READING_RULES}
- Connect the campaign to this plan's KPIs. If they differ (it chased CPA, this plan is for awareness), say so and weigh the evidence accordingly.
- A campaign's REVIEW FINDINGS were written from the same data; build on them, citing their ids, rather than re-deriving them.
- To act on a finding, use HOW THE REPORT MAPS TO THIS PLAN to name the plan's channelId or the catalog publisher. Something marked not in the catalog cannot be added; say so instead. A match marked "probably" is by name only: say it is the same publisher only if you are proposing on that basis, and name both in the evidence.
- When asked to analyse past performance, reply in three short parts: what worked, what did not, and what it means for this plan. Then propose the changes as items.
- Text you write into the plan (a publisher's why, a segment's justification, edit_text) is seen by the client. It may cite past-performance figures only from the client's own campaign, exactly as given, and only with claims the data states. From a campaign that is not this client's, write no figures and no comparisons into the plan.
- An item that rests on past performance puts that evidence in "evidence": the specific rows and figures, quoted as given, and how confident the data allows you to be (for example "OTT PM 0.44 last-touch; no all-touch data, so its assist is unmeasured; medium confidence"). Frame such changes as adjustments to test, not certainties.
- Every figure you write is checked against the data and the plan; one that is not there is flagged to the planner.
- Refer to campaigns and findings by name in the reply, never by their ids.
- The plan's client-facing section "Built on your campaign history" shows learnings from the client's own past campaigns, each with what this plan does about it. Propose them (add_learning {campaignId, findingId, learning, action, position} / edit_learning {index, learning, action} / remove_learning {index}) when the planner asks for client-facing learnings, and offer to after an analysis of the client's own campaign. Rules the server enforces: only from a campaign marked as the client's own, only from a review finding that is not out of date and has no figures missing from the data. "learning": one sentence the client reads about what their campaign showed, in the plan's voice and the client's terms (CPA, checkouts, cost, reach; never PM or ad group, which are internal), quoting only figures from that finding's data, exactly. "action": one sentence on what this plan does about it, with no figures, and true of the plan as it stands or as the same item changes it (put the channel change and the learning in one item). No caveats about attribution in client text; keep those in the reply. The section starts hidden from the client until the planner shows it.`;
