// Past campaign performance as ScoutAI reads it alongside the plan: each linked campaign's
// digest (already reconciled; see src/performance), whether it is this client's own data, and how
// the report's media types and publishers map onto this plan's channels and the CTV catalog, so a
// finding can become an operation on the plan rather than advice the planner has to translate.

import type { CampaignAnalysis } from "../performance/campaign";
import { isMediaTypeDimension } from "../performance/campaign";
import { CAMPAIGN_GOALS } from "../performance/constants";
import { renderDigest } from "../performance/digest";
import type { MediaRecommendationPlan } from "../planning/types";
import { toAdvertiserKey } from "../storage/types";
import type { CatalogPublisher } from "./operations";

export interface LinkedCampaign {
  campaign: { name: string; advertiserName: string; campaignGoal: string | null; flightEnd: string | null };
  analysis: CampaignAnalysis;
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
  { planAdvertiser, plan, planPublishers, catalog }: { planAdvertiser: string; plan?: MediaRecommendationPlan; planPublishers: string[]; catalog: CatalogPublisher[] },
): string {
  if (linked.length === 0) return "";
  const ordered = [...linked].sort((a, b) => (b.campaign.flightEnd ?? "").localeCompare(a.campaign.flightEnd ?? "")).slice(0, MAX_CAMPAIGNS);
  const sections = ordered.map(({ campaign, analysis }, index) => {
    const own = Boolean(planAdvertiser.trim()) && toAdvertiserKey(campaign.advertiserName) === toAdvertiserKey(planAdvertiser)
      && (!analysis.advertiser || toAdvertiserKey(analysis.advertiser) === toAdvertiserKey(planAdvertiser));
    const goal = CAMPAIGN_GOALS.find((g) => g.id === campaign.campaignGoal)?.label;
    const mapping = mappingLines(analysis, plan, planPublishers, catalog);
    return [
      `=== ${campaign.name} (${campaign.advertiserName}) ===`,
      own
        ? "This is the client's own past campaign."
        : `This is NOT this client's campaign (${analysis.advertiser ?? campaign.advertiserName}). Use it for patterns only; never present its figures as this client's results.`,
      `It optimised for: ${goal ?? "not stated. Say which measure you are judging it by"}.`,
      renderDigest(analysis, { maxChars: index === 0 ? FIRST_CAMPAIGN_CHARS : OTHER_CAMPAIGN_CHARS }),
      mapping.length ? ["HOW THE REPORT MAPS TO THIS PLAN:", ...mapping].join("\n") : "",
    ].filter(Boolean).join("\n");
  });
  const skipped = linked.length - ordered.length;
  return [
    `PAST CAMPAIGN PERFORMANCE LINKED TO THIS PLAN (${linked.length} campaign${linked.length === 1 ? "" : "s"}${skipped ? `; the ${skipped} oldest left out for length` : ""}). Figures below are computed from the report files; quote them, do not recompute them.`,
    ...sections,
  ].join("\n\n").slice(0, PERFORMANCE_CONTEXT_CHARS);
}

/** Rules for reading past performance; added to the system instruction only when there is some. */
export const PERFORMANCE_INSTRUCTION = `How you use past campaign performance (when the plan comes with PAST CAMPAIGN PERFORMANCE):
- Read its DATA NOTES first and respect every CAUTION. Quote figures exactly as given; never compute new ones (no new CPAs, shares, lifts or projections) and never promise a result.
- Judge the campaign by what it optimised for, and connect it to this plan's KPIs. If those differ (it chased CPA, this plan is for awareness), say so and weigh the evidence accordingly.
- Attribution is the platform's IP-matched pixel with last-touch credit. It favours whatever ran closest to the conversion: retargeting and display look cheap because CTV and video built the audience they convert. Never move budget out of CTV/OTT into retargeting or display on last-touch CPA or PM alone. When "SAME SPEND, DIFFERENT CREDIT" is given, use it; when only last-touch data exists, say that the evidence is last-touch.
- PM (Performance Multiplier) is conversions per dollar against that report's own average: 1 is average. A PM below 1 is below average even when it is the best in its group (the best CTV publisher can still be below the campaign average). It is relative to its own campaign, so never compare PM across campaigns.
- Rows marked under 30 conversions are directional only; do not base a change on them alone. Rows marked as events or one-off buys (a PMP, March Madness, the Super Bowl) and a late-flight change in weekly CPA may be seasonal; say so rather than generalising.
- Reference files, and campaigns marked as not this client's, show patterns only.
- Say a row is the best, top or most efficient only when the "Ranked by PM" line for its report says so, and say what it was ranked among.
- Report what happened, not why, unless the data notes give the reason: two things in the same weeks are not cause and effect.
- To act on a finding, use HOW THE REPORT MAPS TO THIS PLAN to name the plan's channelId or the catalog publisher. Something marked not in the catalog cannot be added; say so instead. A match marked "probably" is by name only: say it is the same publisher only if you are proposing on that basis, and name both in the evidence.
- When asked to analyse past performance, reply in three short parts: what worked, what did not, and what it means for this plan. Then propose the changes as items.
- Text you write into the plan (a publisher's why, a segment's justification, edit_text) is seen by the client. It may cite past-performance figures only from the client's own campaign, exactly as given, and only with claims the data states. From a campaign that is not this client's, write no figures and no comparisons into the plan.
- An item that rests on past performance puts that evidence in "evidence": the specific rows and figures, quoted as given, and how confident the data allows you to be (for example "OTT PM 0.44 last-touch; no all-touch data, so its assist is unmeasured; medium confidence"). Frame such changes as adjustments to test, not certainties.`;
