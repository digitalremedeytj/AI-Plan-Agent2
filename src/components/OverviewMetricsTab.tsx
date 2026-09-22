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
  CheckCircle2
} from "lucide-react";
import {
  ExtractedPlacement,
  ParsedPlanOption,
  RfpAnalysis,
  AudienceProfile
} from "../types";
import { DEFAULT_OVERVIEW_METRICS, OverviewMetricSetting } from "../planning/settings";

interface OverviewMetricsTabProps {
  extractedPlacements: ExtractedPlacement[];
  planOptions: ParsedPlanOption[];
  rfpAnalysis: RfpAnalysis | null;
  profileData: AudienceProfile | null;
  metricSettings?: OverviewMetricSetting[];
}

const ALLOCATION_COLORS = ["#4f46e5", "#0f9f94", "#84a720", "#036987", "#db2777", "#d97706", "#7c3aed", "#0284c7", "#e11d48", "#64748b"];

export const OverviewMetricsTab: React.FC<OverviewMetricsTabProps> = ({
  extractedPlacements = [],
  planOptions = [],
  rfpAnalysis,
  profileData,
  metricSettings = DEFAULT_OVERVIEW_METRICS,
}) => {
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

  const metricVisibility = new Map(metricSettings.map((metric) => [metric.id, metric.show]));

  // The ScoutAI comparison is only offered against something the user uploaded. With nothing
  // uploaded there is no plan to compare to, and every figure other than the budget would come
  // from the constants above rather than from the plan, so only the budget is shown.
  const hasUploadedContent = selectedOptions.length > 0 || safeExtractedPlacements.length > 0 || Boolean(rfpAnalysis);

  // Filter out hidden metrics and values unavailable due to limited information
  const availableMetrics = hasUploadedContent
    ? metricsList.filter(
        (m) => (metricVisibility.get(m.id as OverviewMetricSetting["id"]) ?? true) && m.plannedFormatted !== null && m.aiFormatted !== null
      )
    : [];
  const budgetOnly = !hasUploadedContent && plannedBudget > 0 && (metricVisibility.get("budget") ?? true);

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

  if (availableMetrics.length === 0 && !budgetOnly && allocationData.length === 0) {
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
      {budgetOnly && (
        <div className="p-2 rounded-xl bg-slate-50/50 border border-slate-100/80 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-blue-50 text-blue-600">
            <TrendingUp className="w-4 h-4 stroke-[2.25]" />
          </div>
          <div className="flex-1 min-w-0 flex items-center justify-between gap-1.5">
            <span className="text-xs font-bold text-slate-800 truncate">Working Media Budget</span>
            <span className="text-xs font-extrabold text-slate-900 tracking-tight shrink-0">{formatCurrency(plannedBudget)}</span>
          </div>
        </div>
      )}

      {availableMetrics.length > 0 && (
        <>
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
