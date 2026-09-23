import React from "react";
import { ClipboardList } from "lucide-react";
import type { BriefOfRecord } from "../types";
import { alsoServedSegments } from "../research/briefOfRecord";

// Read-only by design: the brief of record is what every generation step was built for, so
// editing it after the fact would leave the plan describing an audience it was not built for.
// A different audience means regenerating the plan.
export function BriefOfRecordCard({ brief }: { brief: BriefOfRecord }) {
  const rows: Array<[string, string]> = [
    ["Advertiser", [brief.advertiser, brief.whatTheySell].filter(Boolean).join(" - ")],
    ["Business model", `${brief.businessModel || "Unknown"} (price tier: ${brief.priceTier})`],
    ["Audience type", brief.audienceType],
    ["Primary audience", brief.primaryAudience],
    ["Core segments", (brief.coreSegments ?? []).join("; ")],
    [brief.coreSegments?.length ? "Also served" : "In scope", alsoServedSegments(brief).join("; ")],
    ["Out of scope", brief.excludedSegments.join("; ")],
    ["Objective", `${brief.campaignObjective} (funnel emphasis: ${brief.funnelEmphasis})`],
    ["Geography", brief.geography],
    ["Not established", brief.uncertainties.join("; ")],
  ];
  return (
    <details className="group bg-white rounded-2xl border border-slate-100 shadow-xs">
      <summary className="flex items-center justify-between gap-3 p-4 md:px-6 cursor-pointer list-none">
        <span className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider">
          <ClipboardList className="w-4 h-4" />
          Brief of Record
        </span>
        <span className="text-[11px] text-slate-400 font-medium">
          Built from {brief.basis} · <span className="group-open:hidden">Show</span><span className="hidden group-open:inline">Hide</span>
        </span>
      </summary>
      <dl className="px-4 md:px-6 pb-5 grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-x-4 gap-y-2 text-sm">
        {rows.filter(([, value]) => value && value.trim()).map(([label, value]) => (
          <React.Fragment key={label}>
            <dt className="text-slate-400 font-semibold text-xs uppercase tracking-wide sm:pt-0.5">{label}</dt>
            <dd className="text-slate-700 leading-relaxed">{value}</dd>
          </React.Fragment>
        ))}
      </dl>
      <p className="px-4 md:px-6 pb-4 text-[11px] text-slate-400">
        The audience definition every step of this plan was built for. It is not editable here; to change it, update the brief and regenerate.
      </p>
    </details>
  );
}
