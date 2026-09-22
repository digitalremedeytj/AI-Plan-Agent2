// Deterministic guardrails over the generated profile's charts, run after the QA scoring and
// auto-remediation agents have had their turn. These are the last thing to touch the numbers, so
// a check that misreads a chart's metric type does not just miss a problem - it creates one, and
// it does so in the copy that goes to the client. Two rules follow from that, and both were
// learned the hard way:
//
//   * Know which metric a chart carries before rewriting it. `deviceTypeIndex` is a composition
//     share; `browserAndReach` is an affinity index against a 100 = average baseline. Applying
//     the share rule to the index chart relabelled a correct metric on every single run.
//   * Only report what a media buyer would call a correction. Every note here surfaces in the
//     client-facing auto-fix list, so rounding drift reported as a "verification mismatch" makes
//     a clean profile look remediated.
//
//   * Never substitute numbers. A chart that is not what it claims to be is removed and the
//     plan says so; it is not rescaled into a different shape or pulled toward a benchmark.
//
// Mutates `data` in place. Returns one note per cosmetic correction (rounding drift) and one
// alert per chart that was removed or needs a reader's attention.

import type { GenerationAlert } from "../types";

// A composition that misses 100 by more than this is not rounding: it is overlapping or
// mixed-denominator data, and rescaling it would invent a split nobody measured.
const MAX_RESCALABLE_DRIFT_PTS = 10;

// Classifies an income bracket by where it starts. Matching on "100k" anywhere in the label
// counted "$75k-$100k" as a six-figure bracket.
function bracketLowerBoundThousands(bracket: string): number | null {
  if (/^\s*(<|under|less than|below)/i.test(bracket)) return 0;
  const match = bracket.replace(/,000\b/g, "k").match(/(\d+(?:\.\d+)?)\s*(k)?/i);
  if (!match) return null;
  const value = Number(match[1]);
  return match[2] ? value : value >= 1000 ? value / 1000 : value;
}

export function applyProgrammaticSanityChecks(data: any, reqBody: any): { corrections: string[]; alerts: GenerationAlert[] } {
  const programmaticCorrections: string[] = [];
  const alerts: GenerationAlert[] = [];

  // 1. Percentage-based chart normalizations helper
  // Sub-2pt drift is the model rounding its own composition shares, not a data-integrity
  // problem. It is still corrected, but silently: reporting it padded the auto-fix list on
  // effectively every run, which made a clean profile read as heavily remediated.
  const REPORTABLE_DRIFT_PTS = 2;
  const normalizePercentages = (arr: any[], valueKey: string, chartName: string, section: string) => {
    if (!arr || arr.length === 0) return;
    const sum = arr.reduce((acc, item) => acc + (Number(item[valueKey]) || 0), 0);
    if (sum === 0) return;
    if (Math.abs(sum - 100) > MAX_RESCALABLE_DRIFT_PTS) {
      arr.length = 0;
      alerts.push({
        section,
        severity: "flagged",
        message: `${chartName}: removed because its shares summed to ${sum.toFixed(1)}% instead of 100%, so the figures are not one comparable split.`,
      });
      return;
    }
    if (Math.abs(sum - 100) > 0.05) {
      let runningSum = 0;
      arr.forEach((item, idx) => {
        if (idx === arr.length - 1) {
          item[valueKey] = Math.round((100 - runningSum) * 10) / 10;
        } else {
          const val = Math.round(((Number(item[valueKey]) || 0) / sum) * 1000) / 10;
          item[valueKey] = val;
          runningSum += val;
        }
      });
      if (Math.abs(sum - 100) > REPORTABLE_DRIFT_PTS) {
        programmaticCorrections.push(`Programmatically normalized ${chartName} percentage split to sum to exactly 100% (was ${sum.toFixed(1)}%).`);
      }
    }
  };

  // Run normalizations
  if (data.demographics) {
    if (data.demographics.ageChartData) {
      normalizePercentages(data.demographics.ageChartData, "value", "Age distribution", "demographics");
    }
    if (data.demographics.genderChartData) {
      normalizePercentages(data.demographics.genderChartData, "value", "Gender split", "demographics");
    }
    if (data.demographics.incomeChartData) {
      normalizePercentages(data.demographics.incomeChartData, "value", "Household income", "demographics");
    }
  }
  // The device chart is consumed as a composition share everywhere downstream - a pie in
  // DeviceChart, a "Reach Share" column, "Split Share %" in the markdown export - so an
  // index-valued chart cannot be rendered honestly no matter what the caption says. The
  // remediation agent used to reframe it as non-comparable indices, which left a table
  // renormalized to 100% sitting directly under an overview insisting it did not sum to 100.
  // Index values that arrive here are removed rather than converted: turning an index into a
  // share manufactures a split the research never reported.
  if (data.deviceTypeIndex && data.deviceTypeIndex.chartData) {
    normalizePercentages(data.deviceTypeIndex.chartData, "value", "Device split", "deviceTypeIndex");
  }

  // 2. Domain chart metric labelling
  // browserAndReach is an affinity index by contract: the schema pins metricType to
  // "Affinity Index", the chart axis, tooltip and export header all say Affinity Index, and
  // 5-8 domains indexed against a 100 baseline necessarily sum well past 110. Relabelling on
  // the sum alone therefore fired on every single run, renamed a correct metric to something
  // no renderer reads, and reported a phantom auto-fix. Only relabel a chart that is actually
  // claiming to be a share.
  if (data.browserAndReach && data.browserAndReach.chartData) {
    const domainChart = data.browserAndReach.chartData;
    const claimsIndex = domainChart.some((item: any) => /index/i.test(String(item.metricType || "")));
    const domainSum = domainChart.reduce((acc: number, item: any) => acc + (Number(item.value) || 0), 0);
    if (!claimsIndex && domainSum > 110) {
      let changed = false;
      domainChart.forEach((item: any) => {
        if (item.metricType !== "Audience Reach Penetration") {
          item.metricType = "Audience Reach Penetration";
          changed = true;
        }
      });
      if (changed) {
        programmaticCorrections.push(`Recalibrated Top Domain Share metrics to "Audience Reach Penetration" to avoid media buyer confusion as domain penetration levels represent overlapping reach adding up to ${domainSum}%.`);
      }
    }
  }

  // 3. Broad/General Audience Demographics Skew Prevention (Income)
  const luxuryKeywords = [
    "luxury", "affluent", "wealthy", "rich", "high income", "high hhi", "executive", 
    "investor", "accredited", "premium hardware buyer", "high-end", "bespoke", "boutique", 
    "exclusive", "upper class", "venture", "director", "manager", "hhi over", "hhi 100k",
    "earning over $100", "earning over 100", "over 100k", "over $100k", "above $100k", "above 100k"
  ];

  const searchStr = [
    reqBody.audienceDescription || "",
    reqBody.campaignFocus || "",
    reqBody.additionalContext || "",
    data.intro || "",
    data.executiveSummary || ""
  ].join(" ").toLowerCase();

  const isLuxuryAudience = luxuryKeywords.some(keyword => searchStr.includes(keyword));

  if (!isLuxuryAudience && data.demographics && data.demographics.incomeChartData) {
    let highIncomeSum = 0;
    for (const item of data.demographics.incomeChartData) {
      const lowerBound = bracketLowerBoundThousands(String(item.bracket || ""));
      if (lowerBound !== null && lowerBound >= 100) highIncomeSum += Number(item.value) || 0;
    }

    // Flagged, not rewritten. This used to rescale the researched split to a fixed "national
    // benchmark" of 34% over $100k, which put a number in the plan that no source reported.
    if (highIncomeSum > 40) {
      alerts.push({
        section: "demographics",
        severity: "flagged",
        message: `Household income: ${highIncomeSum.toFixed(0)}% of this audience is shown earning over $100k, which is high for a brief that does not describe an affluent audience. Check the cited source before presenting.`,
      });
    }
  }

  return { corrections: programmaticCorrections, alerts };
}
