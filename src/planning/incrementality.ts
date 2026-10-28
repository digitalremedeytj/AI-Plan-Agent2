/**
 * Incrementality Measurement: whether a plan qualifies for it at no cost, and what the plan's
 * measurement section says. Everything here is computed from the plan, so nothing about the
 * offer is model-written and the section cannot promise a result.
 *
 * Not yet released: the section is off the share link until a planner turns it on, and the
 * share link says nothing about it otherwise (see AudienceProfile.shareIncrementality).
 */
import type { ChannelStrategyData, CtvPublisherRecommendation } from "../types";
import { measurementCovers } from "./engine";
import { combinedPlan } from "./planChannels";
import { incrementalityMinMonthlySpendOf, normalizeCampaignBudget } from "./settings";

/** The workbook record whose channel list decides which media types the measurement reads. */
export const INCREMENTALITY_MEASUREMENT_ID = "measurement.incrementality";

/**
 * KPIs that end in an outcome the measurement can count. Brand KPIs (awareness, reach, VCR) are
 * read by brand lift studies instead, so a plan built only on those gets no section.
 */
const PERFORMANCE_KPI = /\b(roas|roi|return on ad|revenue|sales?|cpa|cac|cost per|acquisitions?|conversions?|convert|purchases?|orders?|leads?|sign[- ]?ups?|subscri|installs?|bookings?|transactions?|site visits?|store visits?|foot traffic)\b/i;

export type IncrementalMetric = "Incremental ROAS" | "Incremental CPA" | "Incremental conversion rate" | "Incremental contribution %";

const METRIC_MEANING: Record<IncrementalMetric, string> = {
  "Incremental ROAS": "Revenue the ads caused, per dollar spent.",
  "Incremental CPA": "What each conversion the ads caused cost.",
  "Incremental conversion rate": "Conversions the ads caused, beyond those that would have happened anyway.",
  "Incremental contribution %": "Each media type's share of the lift.",
};

export function isPerformanceKpi(kpi: string): boolean {
  return PERFORMANCE_KPI.test(kpi);
}

function metricFor(kpi: string): IncrementalMetric {
  if (/\b(roas|roi|return on ad|revenue|sales?)\b/i.test(kpi)) return "Incremental ROAS";
  if (/\b(cpa|cac|cost per)\b/i.test(kpi)) return "Incremental CPA";
  return "Incremental conversion rate";
}

export interface MeasuredLine {
  name: string;
  /** Share of the plan's total spend, whole percent. */
  sharePct: number;
}

export interface IncrementalityView {
  eligible: boolean;
  monthlySpend: number;
  threshold: number;
  /** What the plan would need to add per month to qualify; 0 once it does. */
  shortfall: number;
  /** The first performance KPI, which the section reads; null when the plan has none. */
  kpi: string | null;
  metric: IncrementalMetric | null;
  metricMeaning: string;
  otherMetrics: IncrementalMetric[];
  questions: Array<{ kind: "combination" | "sequence" | "frequency" | "timing"; text: string }>;
  measured: MeasuredLine[];
  notMeasured: MeasuredLine[];
  measuredPct: number;
  /** Up to four of the plan's CTV publishers, for the readout preview. */
  publishers: string[];
}

interface IncrementalityInput {
  strategy: ChannelStrategyData | null | undefined;
  kpis: string[];
  ctvPublishers?: CtvPublisherRecommendation[];
  /** The plan's pinned settings value; the default when the revision predates it. */
  threshold: unknown;
}

const outcomeNoun = (metric: IncrementalMetric) => (metric === "Incremental ROAS" ? "revenue" : "conversions");

/** Null when the plan has no channel plan to measure. */
export function incrementalityView({ strategy, kpis, ctvPublishers = [], threshold: rawThreshold }: IncrementalityInput): IncrementalityView | null {
  const plan = strategy?.mediaPlan;
  if (!plan || !Array.isArray(plan.channels) || plan.channels.length === 0) return null;
  const combined = combinedPlan(strategy);
  // The whole plan's spend, RFP media kept at its own budget included: that is what the client pays.
  const monthlySpend = Math.round(normalizeCampaignBudget(combined.total, plan.flightDays).normalized30DayBudget);
  const threshold = incrementalityMinMonthlySpendOf(rawThreshold);
  const kpi = kpis.map((value) => value.trim()).find((value) => value && isPerformanceKpi(value)) ?? null;
  const metric = kpi ? metricFor(kpi) : null;

  const share = (dollars: number) => (combined.total > 0 ? Math.round((dollars / combined.total) * 100) : 0);
  const measuredChannels = combined.channels.filter((channel) => measurementCovers(INCREMENTALITY_MEASUREMENT_ID, channel.channelId) && channel.allocationDollars > 0);
  const measuredIds = new Set(measuredChannels.map((channel) => channel.channelId));
  const measured = measuredChannels.map((channel) => ({ name: channel.channelName, sharePct: share(channel.allocationDollars) }));
  const notMeasured = [
    ...combined.channels.filter((channel) => !measuredIds.has(channel.channelId) && channel.allocationDollars > 0)
      .map((channel) => ({ name: channel.channelName, sharePct: share(channel.allocationDollars) })),
    ...combined.outsideCatalog.filter((line) => line.dollars > 0).map((line) => ({ name: line.name, sharePct: share(line.dollars) })),
  ];
  const measuredDollars = measuredChannels.reduce((sum, channel) => sum + channel.allocationDollars, 0);

  const publishers = ctvPublishers.map((publisher) => String(publisher?.publisher ?? "").trim()).filter(Boolean).slice(0, 4);
  const questions: IncrementalityView["questions"] = [];
  if (metric && measuredChannels.length > 0) {
    const ctv = measuredChannels.find((channel) => channel.channelId === "channel.ctv");
    const partner = measuredChannels.find((channel) => channel !== ctv);
    if (ctv && partner) {
      questions.push({ kind: "combination", text: `Does ${ctv.channelName} plus ${partner.channelName} drive more incremental ${outcomeNoun(metric)} than ${ctv.channelName} alone?` });
    } else if (measuredChannels.length >= 2) {
      questions.push({ kind: "combination", text: `Which combination of ${measuredChannels[0].channelName} and ${measuredChannels[1].channelName} drives the most incremental ${outcomeNoun(metric)}?` });
    }
    if (ctv && publishers.length >= 2) {
      questions.push({ kind: "sequence", text: `Which publisher order converts best: ${publishers[0]} then ${publishers[1]}, or ${publishers[1]} alone?` });
    }
    questions.push({ kind: "frequency", text: "At what frequency does incremental return flatten? That sets the frequency cap mid-flight." });
    questions.push({ kind: "timing", text: "Which days and dayparts start the paths that end in a conversion?" });
  }

  const eligible = Boolean(metric) && measuredChannels.length > 0 && monthlySpend >= threshold;
  return {
    eligible,
    monthlySpend,
    threshold,
    shortfall: Math.max(0, threshold - monthlySpend),
    kpi,
    metric,
    metricMeaning: metric ? METRIC_MEANING[metric] : "",
    otherMetrics: metric
      ? (["Incremental ROAS", "Incremental CPA", "Incremental conversion rate", "Incremental contribution %"] as IncrementalMetric[]).filter((m) => m !== metric)
      : [],
    questions,
    measured,
    notMeasured,
    measuredPct: share(measuredDollars),
    publishers,
  };
}

/** The geo section's one line on measurement, for a plan whose measurement section is shown. */
export function footprintMeasurementNote(places: string): string {
  return `Lift is measured against matched households inside ${places}, so no market is held dark.`;
}
