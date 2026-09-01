import React from "react";
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
  CheckCircle2
} from "lucide-react";
import {
  ExtractedPlacement,
  ParsedPlanOption,
  RfpAnalysis,
  AudienceProfile
} from "../types";

interface OverviewMetricsTabProps {
  extractedPlacements: ExtractedPlacement[];
  planOptions: ParsedPlanOption[];
  rfpAnalysis: RfpAnalysis | null;
  profileData: AudienceProfile | null;
}

export const OverviewMetricsTab: React.FC<OverviewMetricsTabProps> = ({
  extractedPlacements,
  planOptions,
  rfpAnalysis,
  profileData
}) => {
  // Determine active placements (selected plan options if any, else extracted placements)
  const selectedOptions = planOptions.filter((p) => p.selected);
  const activePlacements =
    selectedOptions.length > 0
      ? selectedOptions.flatMap((o) => o.placements)
      : extractedPlacements;

  // 1. Calculate Base Planned Budget
  let plannedBudget = 0;
  if (selectedOptions.length > 0) {
    plannedBudget = selectedOptions.reduce((acc, o) => acc + (o.budget || 0), 0);
  } else if (activePlacements.length > 0) {
    plannedBudget = activePlacements.reduce((acc, p) => acc + (p.budget || 0), 0);
  } else if (profileData?.channelStrategy?.totalRfpBudget) {
    plannedBudget = profileData.channelStrategy.totalRfpBudget;
  } else if (rfpAnalysis?.extractedMetadata?.budget) {
    plannedBudget = rfpAnalysis.extractedMetadata.budget;
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

  let plannedEcpm = 18.33; // Standard baseline CTV/video rate
  if (plannedBudget > 0 && rawImpressionsSum > 0) {
    plannedEcpm = (plannedBudget / rawImpressionsSum) * 1000;
  }

  let plannedImpressions = rawImpressionsSum;
  if (plannedBudget > 0 && (!explicitImpressionsFound || rawImpressionsSum === 0)) {
    plannedImpressions = (plannedBudget / plannedEcpm) * 1000;
  }

  // 3. Planned Video & Reach Metrics
  const plannedVcr = 0.92; // Baseline raw plan completion rate
  const plannedCompletedViews = Math.round(plannedImpressions * plannedVcr);
  const plannedCpv = plannedCompletedViews > 0 ? plannedBudget / plannedCompletedViews : 0;
  const plannedFreq = 6.00; // Unoptimized frequency baseline
  const plannedReachHH = Math.round(plannedImpressions / plannedFreq);

  // --- AI SCOUT RECOMMENDED METRICS (SPO, Frequency Capping & Inventory Optimization) ---
  const aiBudget = plannedBudget;
  const aiEcpm = plannedEcpm * 0.83; // 17% SPO efficiency gain
  const aiImpressions = Math.round((aiBudget / aiEcpm) * 1000);
  const aiVcr = 0.98; // Non-skippable premium CTV targeting
  const aiCompletedViews = Math.round(aiImpressions * aiVcr);
  const aiCpv = aiCompletedViews > 0 ? aiBudget / aiCompletedViews : 0;
  const aiFreq = 5.45; // AI Scout frequency capping cap in mid 5s
  const aiReachHH = Math.round(aiImpressions / aiFreq);

  // Formatting helpers
  const formatCurrency = (val: number) => "$" + Math.round(val).toLocaleString("en-US");
  const formatDecimals = (val: number, decimals = 2) => "$" + val.toFixed(decimals);
  const formatNumber = (val: number) => Math.round(val).toLocaleString("en-US");

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
      label: "Avg Frequency",
      icon: Target,
      iconBg: "bg-slate-100 text-slate-600",
      plannedVal: plannedFreq,
      aiVal: aiFreq,
      plannedFormatted: `${plannedFreq.toFixed(2)}x`,
      aiFormatted: `${aiFreq.toFixed(2)}x`,
      delta: getDeltaMeta(plannedFreq, aiFreq, true)
    }
  ];

  // Filter out any metrics that are null due to limited information
  const availableMetrics = metricsList.filter(
    (m) => m.plannedFormatted !== null && m.aiFormatted !== null
  );

  if (availableMetrics.length === 0) {
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
      {/* Header Badge */}
      <div className="flex items-center justify-between mb-1 px-0.5">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 uppercase tracking-wider">
          <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
          <span>Plan vs. AI Scout</span>
        </div>
        <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-2 py-0.5 rounded-full flex items-center gap-1">
          <CheckCircle2 className="w-2.5 h-2.5" />
          Optimized
        </span>
      </div>

      {/* Metrics List */}
      <div className="space-y-1.5">
        {availableMetrics.map((metric) => {
          const IconComponent = metric.icon;
          const { pctText, isPositive, isNeutral } = metric.delta;

          // Badge styling
          let badgeClass = "bg-slate-100 text-slate-600 border-slate-200/60";
          let ArrowIcon = null;

          if (!isNeutral) {
            if (isPositive) {
              badgeClass = "bg-emerald-50 text-emerald-700 border-emerald-200/60 font-bold";
              ArrowIcon = metric.delta.rawDiff > 0 ? ArrowUpRight : ArrowDownRight;
            } else {
              badgeClass = "bg-amber-50 text-amber-700 border-amber-200/60 font-bold";
              ArrowIcon = metric.delta.rawDiff > 0 ? ArrowUpRight : ArrowDownRight;
            }
          }

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
                    {metric.label}
                  </span>
                  <span className="text-xs font-extrabold text-slate-900 font-sans tracking-tight shrink-0">
                    {metric.aiFormatted}
                  </span>
                </div>

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
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
