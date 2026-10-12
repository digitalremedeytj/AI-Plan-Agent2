import React from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import {
  TrendingUp,
  Percent,
  Layers,
  Eye,
  Send,
  Users,
  Target,
  Info,
  Sparkles,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  ChevronDown,
  EyeOff
} from "lucide-react";
import {
  ExtractedPlacement,
  ParsedPlanOption,
  RfpAnalysis,
  AudienceProfile,
  AudienceNarrowing,
  GeographyTargetConfig
} from "../types";
import { DEFAULT_OVERVIEW_METRICS, OverviewMetricSetting } from "../planning/settings";
import { DEFAULT_REACH_SETTINGS, UNMAPPED_MEDIA_TYPE_ID, type AudienceShareFilter, type ReachMediaTypeId, type ReachSettings } from "../planning/reach/reachSettings";
import { MIN_OVERRIDE_PERCENT, describeAudienceShare, resolveAudienceShare } from "../planning/reach/audienceShare";
import { estimateReach, type ReachChannelInput, type ReachEstimate } from "../planning/reach/reachModel";
import { resolveHouseholdUniverse } from "../planning/reach/universe";
import { geoTargetingFromBrief } from "../planning/reach/briefGeography";
import { normalizeRawChannel } from "../utils/mediaTaxonomy";

interface OverviewMetricsTabProps {
  extractedPlacements: ExtractedPlacement[];
  planOptions: ParsedPlanOption[];
  rfpAnalysis: RfpAnalysis | null;
  profileData: AudienceProfile | null;
  metricSettings?: OverviewMetricSetting[];
  /** The plan's geography as the brief's picker holds it; reach is sized to it. */
  geography?: GeographyTargetConfig | null;
  /** Assumptions behind Estimated Reach, from the settings revision the plan was built with. */
  reachSettings?: ReachSettings;
  /** Internal-only breakdown of how reach was calculated. */
  showReachDetails?: boolean;
  /** Present when the planner may change the target audience; omitted in read-only views. */
  onAudienceNarrowingChange?: (next: AudienceNarrowing | null) => void;
  /** Whether the reach panel appears on the share link. Off unless a planner turns it on. */
  shareReachDetails?: boolean;
  /** Present for planners only: the panel's share-link eye. */
  onShareReachDetailsChange?: (shared: boolean) => void;
  hideHeader?: boolean;
}

/** A taxonomy guess at confidence 0.5 is its catch-all fallback, so it is really unmapped. */
const FALLBACK_TAXONOMY_CONFIDENCE = 0.5;

function placementMediaTypeId(placement: ExtractedPlacement): ReachMediaTypeId {
  const raw = placement.mediaType || placement.productType || placement.placementName || "";
  if (!raw.trim()) return UNMAPPED_MEDIA_TYPE_ID;
  const mapping = normalizeRawChannel(raw);
  return mapping.confidence <= FALLBACK_TAXONOMY_CONFIDENCE ? UNMAPPED_MEDIA_TYPE_ID : mapping.canonicalId;
}

/**
 * Spreads a total across media types in proportion to their weights. The impressions card
 * and the reach model must agree on the total, so the mix only decides the split.
 */
function scaleMix(mix: ReachChannelInput[], total: number): ReachChannelInput[] {
  const weight = mix.reduce((sum, entry) => sum + entry.impressions, 0);
  if (total <= 0) return [];
  if (weight <= 0) return [{ mediaTypeId: UNMAPPED_MEDIA_TYPE_ID, impressions: total }];
  return mix.map((entry) => ({ mediaTypeId: entry.mediaTypeId, impressions: (entry.impressions / weight) * total }));
}

function daysBetween(start?: string, end?: string): number | null {
  if (!start || !end) return null;
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
  return Number.isFinite(days) && days >= 1 ? days : null;
}

const ALLOCATION_COLORS = ["#4f46e5", "#0f9f94", "#84a720", "#036987", "#db2777", "#d97706", "#7c3aed", "#0284c7", "#e11d48", "#64748b"];

export const OverviewMetricsTab: React.FC<OverviewMetricsTabProps> = ({
  extractedPlacements = [],
  planOptions = [],
  rfpAnalysis,
  profileData,
  metricSettings = DEFAULT_OVERVIEW_METRICS,
  geography = null,
  reachSettings = DEFAULT_REACH_SETTINGS,
  showReachDetails = false,
  onAudienceNarrowingChange,
  shareReachDetails = false,
  onShareReachDetailsChange,
  hideHeader = false,
}) => {
  const [reachDetailsOpen, setReachDetailsOpen] = React.useState(false);
  // Determine active placements (selected plan options if any, else extracted placements)
  const safePlanOptions = Array.isArray(planOptions) ? planOptions : [];
  const safeExtractedPlacements = Array.isArray(extractedPlacements) ? extractedPlacements : [];
  const selectedOptions = safePlanOptions.filter((p) => p.selected);
  const activePlacements =
    selectedOptions.length > 0
      ? selectedOptions.flatMap((o) => o.placements || [])
      : safeExtractedPlacements;

  // 1. Calculate Base Planned Budget
  let plannedBudget = 0;
  if (selectedOptions.length > 0) {
    plannedBudget = selectedOptions.reduce((acc, o) => acc + (o.budget || 0), 0);
  } else if (activePlacements.length > 0) {
    plannedBudget = activePlacements.reduce((acc, p) => acc + (p.budget || 0), 0);
  } else if (profileData?.channelStrategy?.totalRfpBudget) {
    plannedBudget = profileData.channelStrategy.totalRfpBudget;
  } else if (profileData?.channelStrategy?.mediaPlan?.workingMediaBudget) {
    plannedBudget = profileData.channelStrategy.mediaPlan.workingMediaBudget;
  } else if (rfpAnalysis?.extractedMetadata?.budget) {
    plannedBudget = rfpAnalysis.extractedMetadata.budget;
  } else if (profileData?.channelStrategy?.mediaPlan?.channels?.length) {
    plannedBudget = profileData.channelStrategy.mediaPlan.channels.reduce((sum, ch) => sum + (ch.allocationDollars || 0), 0);
  }

  // 2. Base Planned Impressions & ECPM
  let rawImpressionsSum = 0;
  let explicitImpressionsFound = false;

  activePlacements.forEach((p) => {
    const imp = p.impressions || 0;
    const b = p.budget || 0;

    if (imp > 0) {
      rawImpressionsSum += imp;
      explicitImpressionsFound = true;
    } else if (b > 0) {
      const details = (p.pricingStructureDetails || p.notes || "").toLowerCase();
      const cpmMatch = details.match(/\$?(\d+(?:\.\d+)?)\s*(?:cpm|cost per thousand)/i);
      if (cpmMatch) {
        const cpmVal = parseFloat(cpmMatch[1]);
        if (cpmVal > 0) {
          rawImpressionsSum += (b / cpmVal) * 1000;
          explicitImpressionsFound = true;
        }
      }
    }
  });

  // Calculate typical CPM blended from recommended media plan channels if available
  const recommendedChannels = profileData?.channelStrategy?.mediaPlan?.channels || [];
  let weightedCpmSum = 0;
  let weightedDollars = 0;
  recommendedChannels.forEach((ch) => {
    const avgCpm =
      ch.typicalCpmLow && ch.typicalCpmHigh
        ? (ch.typicalCpmLow + ch.typicalCpmHigh) / 2
        : (ch.typicalCpmLow || ch.typicalCpmHigh || 0);
    if (avgCpm > 0 && ch.allocationDollars > 0) {
      weightedCpmSum += avgCpm * ch.allocationDollars;
      weightedDollars += ch.allocationDollars;
    }
  });
  const blendedChannelCpm = weightedDollars > 0 ? weightedCpmSum / weightedDollars : 0;

  let plannedEcpm = 18.33; // Standard baseline CTV/video rate
  if (plannedBudget > 0 && rawImpressionsSum > 0) {
    plannedEcpm = (plannedBudget / rawImpressionsSum) * 1000;
  } else if (blendedChannelCpm > 0) {
    plannedEcpm = blendedChannelCpm;
  }

  let plannedImpressions = rawImpressionsSum;
  if (plannedBudget > 0 && (!explicitImpressionsFound || rawImpressionsSum === 0)) {
    plannedImpressions = (plannedBudget / plannedEcpm) * 1000;
  }

  // 3. Planned Video Metrics
  const plannedVcr = 0.92; // Baseline raw plan completion rate
  const plannedCompletedViews = Math.round(plannedImpressions * plannedVcr);
  const plannedCpv = plannedCompletedViews > 0 ? plannedBudget / plannedCompletedViews : 0;

  // Determine whether this plan is comparing against an uploaded client file or presenting ScoutAI campaign estimates
  const hasUploadedContent = selectedOptions.length > 0 || safeExtractedPlacements.length > 0 || Boolean(rfpAnalysis);

  // --- AI SCOUT RECOMMENDED METRICS (SPO, Frequency Capping & Inventory Optimization) ---
  const aiBudget = plannedBudget;
  const aiEcpm = hasUploadedContent
    ? plannedEcpm * 0.83 // 17% SPO efficiency gain against unoptimized uploaded plan
    : (blendedChannelCpm > 0 ? blendedChannelCpm : plannedEcpm * 0.83);
  const aiImpressions = Math.round((aiBudget / aiEcpm) * 1000);
  const aiVcr = 0.98; // Non-skippable premium CTV targeting
  const aiCompletedViews = Math.round(aiImpressions * aiVcr);
  const aiCpv = aiCompletedViews > 0 ? aiBudget / aiCompletedViews : 0;

  // --- REACH & FREQUENCY (monthly; see src/planning/reach) ---
  // Both sides run through the same model, so any difference comes from impressions and
  // media mix, never from a constant.
  const universe = resolveHouseholdUniverse(profileData?.geoTargeting ?? geoTargetingFromBrief(geography));
  const flightDays = profileData?.channelStrategy?.mediaPlan?.flightDays
    ?? selectedOptions.map((option) => daysBetween(option.flightDates?.start, option.flightDates?.end)).find((days) => days !== null)
    ?? null;
  const fallbackCpm = blendedChannelCpm > 0 ? blendedChannelCpm : plannedEcpm;

  // Each media type weighted by what its own CPM buys, not the blended rate.
  const scoutMix: ReachChannelInput[] = recommendedChannels
    .filter((channel) => (channel.allocationDollars || 0) > 0)
    .map((channel) => {
      const low = channel.typicalCpmLow || 0;
      const high = channel.typicalCpmHigh || 0;
      const cpm = low && high ? (low + high) / 2 : (low || high || fallbackCpm);
      const mediaTypeId: ReachMediaTypeId = channel.canonicalId || placementMediaTypeId({ mediaType: channel.channelName } as ExtractedPlacement);
      return { mediaTypeId, impressions: cpm > 0 ? (channel.allocationDollars / cpm) * 1000 : 0 };
    });
  const uploadedMix: ReachChannelInput[] = activePlacements.map((placement) => {
    const budget = placement.budget || 0;
    const impressions = placement.impressions && placement.impressions > 0
      ? placement.impressions
      : (plannedEcpm > 0 ? (budget / plannedEcpm) * 1000 : 0);
    return { mediaTypeId: placementMediaTypeId(placement), impressions };
  });

  const audience = resolveAudienceShare(profileData?.audienceNarrowing, reachSettings);
  const reachFor = (mix: ReachChannelInput[], impressions: number): ReachEstimate =>
    estimateReach({ channels: scaleMix(mix, impressions), universe, flightDays, settings: reachSettings, audience });
  const plannedReach = reachFor(uploadedMix, plannedImpressions);
  const aiReach = reachFor(scoutMix.length > 0 ? scoutMix : uploadedMix, aiImpressions);
  // The card leads with unique reach over the flight, matching the flight-total budget and
  // impressions beside it; the monthly view is its sub-line.
  const plannedReachHH = Math.round(plannedReach.flight?.reach ?? plannedReach.monthlyReach);
  const aiReachHH = Math.round(aiReach.flight?.reach ?? aiReach.monthlyReach);
  const plannedFreq = plannedReach.monthlyFrequency;
  const aiFreq = aiReach.monthlyFrequency;

  // Formatting helpers
  const formatCurrency = (val: number) => "$" + Math.round(val).toLocaleString("en-US");
  const formatDecimals = (val: number, decimals = 2) => "$" + val.toFixed(decimals);
  const formatNumber = (val: number) => Math.round(val).toLocaleString("en-US");

  const formatPercent = (val: number) => (val > 0 && val < 1 ? "<1%" : `${Math.round(val)}%`);

  const formatReach = (val: number) => {
    if (val >= 1000000) {
      return (val / 1000000).toFixed(1) + "M HH";
    }
    if (val >= 1000) {
      return (val / 1000).toFixed(1) + "K HH";
    }
    return Math.round(val).toLocaleString("en-US") + " HH";
  };

  const getDeltaMeta = (plannedVal: number, aiVal: number, lowerIsBetter = false) => {
    if (plannedVal === 0 || aiVal === 0) {
      return { pctText: "0.0%", isPositive: true, isNeutral: true };
    }
    const diff = ((aiVal - plannedVal) / plannedVal) * 100;
    const absPct = Math.abs(diff).toFixed(1) + "%";
    const sign = diff > 0 ? "+" : diff < 0 ? "-" : "";

    const isNeutral = Math.abs(diff) < 0.1;
    const isPositive = lowerIsBetter ? diff < 0 : diff > 0;

    return {
      pctText: `${sign}${absPct}`,
      rawDiff: diff,
      isPositive,
      isNeutral
    };
  };

  // Build metrics array comparison
  const metricsList = [
    {
      id: "budget",
      label: "Planned Budget",
      icon: TrendingUp,
      iconBg: "bg-blue-50 text-blue-600",
      plannedVal: plannedBudget,
      aiVal: aiBudget,
      plannedFormatted: plannedBudget > 0 ? formatCurrency(plannedBudget) : null,
      aiFormatted: aiBudget > 0 ? formatCurrency(aiBudget) : null,
      delta: getDeltaMeta(plannedBudget, aiBudget)
    },
    {
      id: "ecpm",
      label: "Estimated ECPM",
      icon: Percent,
      iconBg: "bg-purple-50 text-purple-600",
      plannedVal: plannedEcpm,
      aiVal: aiEcpm,
      plannedFormatted: plannedEcpm > 0 ? formatDecimals(plannedEcpm) : null,
      aiFormatted: aiEcpm > 0 ? formatDecimals(aiEcpm) : null,
      delta: getDeltaMeta(plannedEcpm, aiEcpm, true)
    },
    {
      id: "impressions",
      label: "Estimated Impressions",
      icon: Layers,
      iconBg: "bg-indigo-50 text-indigo-600",
      plannedVal: plannedImpressions,
      aiVal: aiImpressions,
      plannedFormatted: plannedImpressions > 0 ? formatNumber(plannedImpressions) : null,
      aiFormatted: aiImpressions > 0 ? formatNumber(aiImpressions) : null,
      delta: getDeltaMeta(plannedImpressions, aiImpressions, false)
    },
    {
      id: "completedViews",
      label: "Completed Views",
      icon: Eye,
      iconBg: "bg-emerald-50 text-emerald-600",
      plannedVal: plannedCompletedViews,
      aiVal: aiCompletedViews,
      plannedFormatted: plannedCompletedViews > 0 ? formatNumber(plannedCompletedViews) : null,
      aiFormatted: aiCompletedViews > 0 ? formatNumber(aiCompletedViews) : null,
      delta: getDeltaMeta(plannedCompletedViews, aiCompletedViews, false)
    },
    {
      id: "costPerView",
      label: "Cost Per View",
      icon: Send,
      iconBg: "bg-orange-50 text-orange-600",
      plannedVal: plannedCpv,
      aiVal: aiCpv,
      plannedFormatted: plannedCpv > 0 ? formatDecimals(plannedCpv, 3) : null,
      aiFormatted: aiCpv > 0 ? formatDecimals(aiCpv, 3) : null,
      delta: getDeltaMeta(plannedCpv, aiCpv, true)
    },
    {
      id: "estimatedReach",
      label: "Estimated Reach",
      icon: Users,
      iconBg: "bg-rose-50 text-rose-500",
      plannedVal: plannedReachHH,
      aiVal: aiReachHH,
      plannedFormatted: plannedReachHH > 0 ? formatReach(plannedReachHH) : null,
      aiFormatted: aiReachHH > 0 ? formatReach(aiReachHH) : null,
      delta: getDeltaMeta(plannedReachHH, aiReachHH, false)
    },
    {
      id: "avgFrequency",
      label: "Avg Monthly Frequency",
      icon: Target,
      iconBg: "bg-slate-100 text-slate-600",
      plannedVal: plannedFreq,
      aiVal: aiFreq,
      plannedFormatted: plannedFreq > 0 ? `${plannedFreq.toFixed(1)}x` : null,
      aiFormatted: aiFreq > 0 ? `${aiFreq.toFixed(1)}x` : null,
      // Lower is not automatically better: the badge reads against the planner's target band.
      delta: getDeltaMeta(plannedFreq, aiFreq, false)
    }
  ];

  const metricVisibility = new Map(metricSettings.map((metric) => [metric.id, metric.show]));

  // Filter out hidden metrics and values unavailable due to limited information.
  // When no uploaded plan is present, ScoutAI campaign estimates are presented for any metric turned on in settings.
  const availableMetrics = metricsList.filter((m) => {
    const isVisible = metricVisibility.get(m.id as OverviewMetricSetting["id"]) ?? true;
    if (!isVisible) return false;
    if (m.id === "budget") return plannedBudget > 0;
    if (hasUploadedContent) {
      return m.plannedFormatted !== null && m.aiFormatted !== null;
    }
    return m.aiFormatted !== null;
  });

  const scoutAllocation = profileData?.channelStrategy?.mediaPlan?.channels || [];
  const uploadedAllocationGroups = new Map<string, number>();
  activePlacements.forEach((placement: ExtractedPlacement) => {
    const name = placement.mediaType || placement.productType || placement.placementName || placement.publisher || "Other";
    uploadedAllocationGroups.set(name, (uploadedAllocationGroups.get(name) || 0) + (placement.budget || 0));
  });
  const uploadedAllocationTotal = Array.from(uploadedAllocationGroups.values()).reduce<number>((total, dollars) => total + dollars, 0);
  const allocationData = scoutAllocation.length > 0
    ? scoutAllocation
        .filter((channel) => channel.allocationPercent > 0)
        .map((channel) => ({
          name: channel.channelName,
          value: channel.allocationPercent,
          dollars: channel.allocationDollars,
        }))
    : Array.from(uploadedAllocationGroups.entries())
        .filter(([, dollars]) => dollars > 0 && uploadedAllocationTotal > 0)
        .map(([name, dollars]) => ({ name, dollars, value: (dollars / uploadedAllocationTotal) * 100 }))
        .sort((a, b) => b.value - a.value);
  const allocationSource = scoutAllocation.length > 0 ? "ScoutAI recommended allocation" : "Uploaded plan allocation";

  if (availableMetrics.length === 0 && allocationData.length === 0) {
    return (
      <div className="py-8 px-4 text-center space-y-3 bg-slate-50/60 rounded-xl border border-slate-200/80">
        <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
          <Info className="w-5 h-5" />
        </div>
        <div className="space-y-1">
          <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            No Overview Metrics Available
          </h4>
          <p className="text-xs text-slate-500 leading-relaxed max-w-[240px] mx-auto">
            Upload a Media Plan or RFP document with line items or budget figures to view campaign overview metrics.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 font-sans">
      {availableMetrics.length > 0 && (
        <>
          {/* Header Badge */}
          {!hideHeader && (
            <div className="flex items-center justify-between mb-1 px-0.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 uppercase tracking-wider">
                <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                <span>{hasUploadedContent ? "Plan vs. AI Scout" : "Campaign Overview"}</span>
              </div>
              {hasUploadedContent ? (
                <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <CheckCircle2 className="w-2.5 h-2.5" />
                  Optimized
                </span>
              ) : (
                <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200/60 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Sparkles className="w-2.5 h-2.5" />
                  ScoutAI
                </span>
              )}
            </div>
          )}

          {/* Metrics List */}
          <div className="space-y-1.5">
            {availableMetrics.map((metric) => {
              const IconComponent = metric.icon;
              const { pctText, isPositive, isNeutral } = metric.delta;

              // Badge styling
              let badgeClass = "bg-slate-100 text-slate-600 border-slate-200/60";
              let ArrowIcon = null;

              if (metric.id === "avgFrequency") {
                // Frequency is judged against the planner's band, not by direction.
                badgeClass = aiReach.frequencyBand.withinBand
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200/60 font-bold"
                  : "bg-amber-50 text-amber-700 border-amber-200/60 font-bold";
                ArrowIcon = isNeutral ? null : metric.delta.rawDiff > 0 ? ArrowUpRight : ArrowDownRight;
              } else if (!isNeutral) {
                if (isPositive) {
                  badgeClass = "bg-emerald-50 text-emerald-700 border-emerald-200/60 font-bold";
                  ArrowIcon = metric.delta.rawDiff > 0 ? ArrowUpRight : ArrowDownRight;
                } else {
                  badgeClass = "bg-amber-50 text-amber-700 border-amber-200/60 font-bold";
                  ArrowIcon = metric.delta.rawDiff > 0 ? ArrowUpRight : ArrowDownRight;
                }
              }

              const displayLabel = !hasUploadedContent && metric.id === "budget" ? "Working Media Budget" : metric.label;
              const displayValue = !hasUploadedContent && metric.id === "budget"
                ? formatCurrency(plannedBudget)
                : (metric.aiFormatted ?? metric.plannedFormatted);

              return (
                <div
                  key={metric.id}
                  className="p-2 rounded-xl bg-slate-50/50 hover:bg-slate-50 transition-colors border border-slate-100/80 flex items-center gap-2.5"
                >
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${metric.iconBg}`}
                  >
                    <IconComponent className="w-4 h-4 stroke-[2.25]" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="text-xs font-bold text-slate-800 truncate">
                        {displayLabel}
                      </span>
                      <span className="text-xs font-extrabold text-slate-900 font-sans tracking-tight shrink-0">
                        {displayValue}
                      </span>
                    </div>

                    {metric.id === "estimatedReach" && (
                      <div className="mt-0.5 space-y-0.5 text-[10.5px] leading-tight text-slate-500" title={`${formatNumber(universe.households)} TV households · ${universe.sourceLabel}`}>
                        <div className="truncate">{reachShareLine(aiReach)}</div>
                        {aiReach.flight && (
                          <div className="truncate">≈{compact(aiReach.monthlyReach)} HH per month · {aiReach.monthlyFrequency.toFixed(1)}x / mo</div>
                        )}
                      </div>
                    )}
                    {metric.id === "avgFrequency" && !hasUploadedContent && (
                      <div className="mt-0.5 text-[10.5px] leading-tight text-slate-500">
                        Target {formatBand(aiReach)} / month{aiReach.frequencyBand.withinBand ? "" : " · outside target"}
                      </div>
                    )}

                    {hasUploadedContent && (
                      <div className="flex items-center justify-between gap-1.5 mt-0.5 text-[11px] leading-none">
                        <span className="text-slate-400 font-medium truncate">
                          Planned:{" "}
                          <span className="text-slate-600 font-semibold">
                            {metric.plannedFormatted}
                          </span>
                        </span>
                        <span
                          className={`inline-flex items-center gap-0.5 px-[5px] py-[2px] rounded-full text-[9.5px] leading-none border ${badgeClass} shrink-0`}
                        >
                          {ArrowIcon && <ArrowIcon className="w-2.5 h-2.5 stroke-[2.5]" />}
                          <span>{pctText}</span>
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {showReachDetails && availableMetrics.some((metric) => metric.id === "estimatedReach") && (
            <ReachDetails
              estimate={aiReach}
              open={reachDetailsOpen}
              onToggle={() => setReachDetailsOpen((open) => !open)}
              comparedWithPlan={hasUploadedContent}
              reference={reachSettings.audienceShareReference}
              narrowing={profileData?.audienceNarrowing ?? null}
              onNarrowingChange={onAudienceNarrowingChange}
              sharedInLink={shareReachDetails}
              onSharedInLinkChange={onShareReachDetailsChange}
            />
          )}
        </>
      )}

      {allocationData.length > 0 && (
        <section className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white" aria-labelledby="media-allocation-title">
          <div className="border-b border-slate-100 bg-slate-50/70 px-3 py-2.5">
            <div id="media-allocation-title" className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-800">
              <Layers className="h-3.5 w-3.5 text-indigo-600" /> Media Type Allocation
            </div>
            <p className="mt-0.5 text-[10px] text-slate-500">{allocationSource}</p>
          </div>
          <div className="h-44 px-2 pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={allocationData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="48%"
                  innerRadius={38}
                  outerRadius={66}
                  paddingAngle={allocationData.length > 1 ? 2 : 0}
                  stroke="#ffffff"
                  strokeWidth={2}
                >
                  {allocationData.map((entry, index) => <Cell key={entry.name} fill={ALLOCATION_COLORS[index % ALLOCATION_COLORS.length]} />)}
                </Pie>
                <Tooltip
                  formatter={(value: number | string | undefined, _name, item) => {
                    const percent = Number(value) || 0;
                    const dollars = Number(item.payload?.dollars) || 0;
                    return [`${percent.toFixed(1)}%${dollars > 0 ? ` · ${formatCurrency(dollars)}` : ""}`, item.payload?.name || "Allocation"];
                  }}
                  contentStyle={{ backgroundColor: "#0f172a", borderColor: "#1e293b", borderRadius: "8px", fontSize: "11px" }}
                  itemStyle={{ color: "#e2e8f0" }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1.5 border-t border-slate-100 px-3 py-3">
            {allocationData.map((entry, index) => (
              <div key={entry.name} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="flex min-w-0 items-center gap-2 font-semibold text-slate-700">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: ALLOCATION_COLORS[index % ALLOCATION_COLORS.length] }} />
                  <span className="truncate" title={entry.name}>{entry.name}</span>
                </span>
                <span className="shrink-0 font-extrabold text-slate-900">{entry.value.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

function formatBand(estimate: ReachEstimate): string {
  const { min, max } = estimate.frequencyBand;
  return `${min}–${max}x`;
}

const compact = (val: number) =>
  val >= 1_000_000 ? `${(val / 1_000_000).toFixed(1)}M` : val >= 1_000 ? `${(val / 1_000).toFixed(0)}K` : Math.round(val).toLocaleString("en-US");

/**
 * The working behind Estimated Reach, for planners: what the plan is measured against and
 * what each media type contributed. Internal-only, since it exposes planning assumptions.
 */
const ReachDetails: React.FC<{
  estimate: ReachEstimate;
  open: boolean;
  onToggle: () => void;
  comparedWithPlan: boolean;
  reference: AudienceShareFilter[];
  narrowing: AudienceNarrowing | null;
  onNarrowingChange?: (next: AudienceNarrowing | null) => void;
  sharedInLink: boolean;
  /** Absent on the share link itself, where there is nothing to toggle. */
  onSharedInLinkChange?: (shared: boolean) => void;
}> = ({
  estimate,
  open,
  onToggle,
  comparedWithPlan,
  reference,
  narrowing,
  onNarrowingChange,
  sharedInLink,
  onSharedInLinkChange,
}) => {
  const { universe } = estimate;
  const isPlannerView = Boolean(onSharedInLinkChange);
  const hiddenFromLink = isPlannerView && !sharedInLink;
  const audience = estimate.audience;
  const included = estimate.channels.filter((channel) => channel.included);
  const excluded = estimate.channels.filter((channel) => !channel.included);
  return (
    <section
      className={`group rounded-xl border text-[11px] ${hiddenFromLink ? "border-dashed border-slate-300 bg-slate-50/70" : "border-slate-200 bg-white"}`}
      aria-label="How reach is calculated"
    >
      <div className="flex items-center gap-1 pr-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2 text-left font-bold text-slate-700 hover:bg-slate-50 rounded-xl"
        >
          <span className="flex items-center gap-1.5">
            <Info className="h-3.5 w-3.5 text-indigo-600" /> How reach is calculated
          </span>
          <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {onSharedInLinkChange && (
          <button
            type="button"
            onClick={() => onSharedInLinkChange(!sharedInLink)}
            className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-all ${
              sharedInLink
                ? "text-slate-400 opacity-0 hover:bg-slate-200/60 hover:text-slate-700 group-hover:opacity-100 focus:opacity-100"
                : "bg-amber-100/80 text-amber-700 hover:bg-amber-200"
            }`}
            title={sharedInLink ? "Shown on the share link - click to hide" : "Hidden from the share link (default) - click to show"}
            aria-label={sharedInLink ? "Hide from share view" : "Show in share view"}
            aria-pressed={!sharedInLink}
          >
            {sharedInLink ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
      {open && (
        <div className="space-y-2.5 border-t border-slate-100 px-3 py-2.5 text-slate-600">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="font-semibold text-slate-500">Universe</dt>
            <dd className="text-right font-semibold text-slate-800">{universe.label} · {Math.round(universe.households).toLocaleString("en-US")} TV HH</dd>
            <dt className="font-semibold text-slate-500">Audience</dt>
            <dd className="text-right text-slate-800">
              {audience && audience.method !== "none"
                ? `${describeAudienceShare(audience)} · ${audience.sharePercent.toFixed(1)}% = ${compact(estimate.targetHouseholds)} HH`
                : "Whole geography (not narrowed)"}
            </dd>
            <dt className="font-semibold text-slate-500">Flight</dt>
            <dd className="text-right text-slate-800">{estimate.flightDays === null
                ? "Unknown, treated as 1 month"
                : estimate.flightDays <= 30
                  ? `${estimate.flightDays} days (one month)`
                  : `${estimate.flightDays} days, shown per month`}</dd>
            <dt className="font-semibold text-slate-500">Monthly</dt>
            <dd className="text-right text-slate-800">
              {compact(estimate.monthlyImpressions)} imps → {compact(estimate.monthlyReach)} HH at {estimate.monthlyFrequency.toFixed(1)}x
            </dd>
            {estimate.flight && (
              <>
                <dt className="font-semibold text-slate-500">Whole flight</dt>
                <dd className="text-right font-semibold text-slate-800">
                  {compact(estimate.flight.impressions)} imps → {compact(estimate.flight.reach)} unique HH at {estimate.flight.frequency.toFixed(1)}x
                </dd>
              </>
            )}
          </dl>

          {included.length > 0 && (
            <table className="w-full border-collapse">
              <thead className="text-[9.5px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="py-1 text-left font-bold">Media type</th>
                  <th className="py-1 text-right font-bold">Imps/mo</th>
                  <th className="py-1 text-right font-bold" title="Max reachable % of HH · duplication factor (s) · audience concentration (k)">Max · s · k</th>
                  <th className="py-1 text-right font-bold">Reach/mo</th>
                  {estimate.flight && <th className="py-1 text-right font-bold" title="Unique households over the whole flight">Flight</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {included.map((channel) => (
                  <tr key={channel.mediaTypeId}>
                    <td className="py-1 pr-2 font-semibold text-slate-700">
                      {channel.label}
                      {audience && audience.method !== "none" && !channel.audienceTargeted && (
                        <span className="ml-1 font-normal text-slate-400" title="Cannot target an audience; measured against the whole geography">(whole geo)</span>
                      )}
                    </td>
                    <td className="py-1 text-right">{compact(channel.monthlyImpressions)}</td>
                    <td className="py-1 text-right">{channel.maxReachPercent}% · {channel.duplicationFactor} · {channel.concentrationK}</td>
                    <td className="py-1 text-right font-semibold text-slate-800">{compact(channel.monthlyReach)}</td>
                    {estimate.flight && <td className="py-1 text-right font-semibold text-slate-800">{compact(channel.flightReach)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {excluded.length > 0 && (
            <ul className="space-y-0.5 text-slate-500">
              {excluded.map((channel) => (
                <li key={channel.mediaTypeId}>
                  <span className="font-semibold text-slate-600">{channel.label}</span> not counted: {channel.excludedReason}
                </li>
              ))}
            </ul>
          )}

          {onNarrowingChange && (
            <AudienceEditor reference={reference} narrowing={narrowing} onChange={onNarrowingChange} />
          )}

          <p className="leading-snug text-slate-500">
            Each media type's reach flattens toward its ceiling (universe × max %) on an NBD curve: s sets how fast it starts,
            k how long light viewers keep trickling in. Media types are combined assuming random overlap. Flight reach counts each
            household once over the whole campaign, so it is not monthly reach × months. Frequency = impressions ÷ reach. Target band {formatBand(estimate)} / month.
            {isPlannerView ? " Assumptions are in Settings > Reach & Frequency." : ""}
            {comparedWithPlan ? " The planned figures use the same method on the uploaded plan's mix." : ""}
          </p>
          {estimate.assumptions.map((assumption) => (
            <p key={assumption} className="text-amber-700">{assumption}</p>
          ))}
          <p className="text-[10px] text-slate-400">Households: {universe.sourceLabel}</p>
        </div>
      )}
    </section>
  );
};

/**
 * Lets a planner say who reach is measured against. Shares come from the reference table in
 * Settings or the planner's own figure, never from the AI.
 */
const AudienceEditor: React.FC<{
  reference: AudienceShareFilter[];
  narrowing: AudienceNarrowing | null;
  onChange: (next: AudienceNarrowing | null) => void;
}> = ({ reference, narrowing, onChange }) => {
  const selected = new Set(narrowing?.filterIds ?? []);
  const override = narrowing?.overridePercent ?? null;
  const [overrideText, setOverrideText] = React.useState(override === null ? "" : String(override));
  React.useEffect(() => setOverrideText(override === null ? "" : String(override)), [override]);

  const categories = Array.from(new Set(reference.map((filter) => filter.category)));
  const emit = (filterIds: string[], overridePercent: number | null) =>
    onChange(filterIds.length === 0 && overridePercent === null ? null : { filterIds, overridePercent });

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    emit(Array.from(next), override);
  };

  const commitOverride = () => {
    const value = Number(overrideText);
    const next = overrideText.trim() === "" || !Number.isFinite(value) ? null : Math.min(100, Math.max(MIN_OVERRIDE_PERCENT, value));
    setOverrideText(next === null ? "" : String(next));
    if (next !== override) emit(Array.from(selected), next);
  };

  return (
    <div className="space-y-2 rounded-lg border border-indigo-100 bg-indigo-50/40 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-slate-700">Target audience</span>
        {(selected.size > 0 || override !== null) && (
          <button type="button" onClick={() => onChange(null)} className="text-[10.5px] font-semibold text-indigo-600 hover:underline">
            Clear
          </button>
        )}
      </div>
      <label className="flex items-center justify-between gap-2 text-slate-600">
        <span>Share of HH (overrides filters)</span>
        <span className="flex items-center gap-1">
          <input
            type="number"
            min={MIN_OVERRIDE_PERCENT}
            max={100}
            step="0.5"
            value={overrideText}
            placeholder="—"
            onChange={(e) => setOverrideText(e.target.value)}
            onBlur={commitOverride}
            onKeyDown={(e) => { if (e.key === "Enter") commitOverride(); }}
            aria-label="Target audience share of households, percent"
            className="w-16 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-right text-[11px] focus:border-indigo-500 focus:outline-none"
          />
          %
        </span>
      </label>
      {categories.map((category) => (
        <fieldset key={category} className={override !== null ? "opacity-50" : undefined}>
          <legend className="mb-0.5 text-[9.5px] font-bold uppercase tracking-wide text-slate-400">{category}</legend>
          <div className="flex flex-wrap gap-1">
            {reference.filter((filter) => filter.category === category).map((filter) => {
              const on = selected.has(filter.id);
              return (
                <button
                  key={filter.id}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${filter.category}: ${filter.label} (${filter.sharePercent}% of households)`}
                  onClick={() => toggle(filter.id)}
                  title={`${filter.sharePercent}% of households · ${filter.source}`}
                  className={`rounded-full border px-2 py-0.5 text-[10.5px] font-semibold transition-colors ${
                    on ? "border-indigo-300 bg-indigo-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-indigo-200"
                  }`}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
      <p className="text-[10px] leading-snug text-slate-400">
        Same category adds up; categories multiply. Shares are from Settings &gt; Reach &amp; Frequency.
      </p>
    </div>
  );
};

/** "over 12 months" for long flights, "over 21 days" for short ones, "per month" when unknown. */
export function flightDurationLabel(days: number | null): string {
  if (days === null) return "per month";
  if (days >= 60) return `over ${Math.round(days / 30.4)} months`;
  return `over ${days} days`;
}

/** The reach card's first sub-line: the window, then the share of the households it is measured against. */
function reachShareLine(estimate: ReachEstimate): string {
  const reach = estimate.flight ?? {
    reachPercentOfTarget: estimate.reachPercentOfTarget,
    reachPercentOfUniverse: estimate.reachPercentOfUniverse,
  };
  const window = flightDurationLabel(estimate.flightDays);
  const pct = (val: number) => (val > 0 && val < 1 ? "<1%" : `${Math.round(val)}%`);
  const narrowed = estimate.audience && estimate.audience.method !== "none" && reach.reachPercentOfTarget <= 100;
  return narrowed
    ? `${window} · ${pct(reach.reachPercentOfTarget)} of ${compact(estimate.targetHouseholds)} target HH in ${estimate.universe.label}`
    : `${window} · ${pct(reach.reachPercentOfUniverse)} of ${estimate.universe.label} TV HH`;
}
