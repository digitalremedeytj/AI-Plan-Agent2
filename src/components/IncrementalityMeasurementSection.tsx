import React from "react";
import { ArrowRight, ChevronDown, ChevronUp, Clock, EyeOff, FlaskConical, Gift, Info, Merge, PieChart, Repeat, Route, Target } from "lucide-react";
import type { IncrementalityView } from "../planning/incrementality";

const QUESTION_ICONS = { combination: Merge, sequence: Route, frequency: Repeat, timing: Clock } as const;

function compactDollars(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `$${Math.round(value / 1000)}K`;
  return `$${Math.round(value)}`;
}

/** Under the threshold: planner-only, since it names the client's budget as short. */
export const IncrementalityThresholdNote: React.FC<{ view: IncrementalityView }> = ({ view }) => (
  <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
    <Info className="w-4 h-4 shrink-0 mt-px text-amber-700" />
    <span>
      This plan spends <strong>{compactDollars(view.monthlySpend)}/mo</strong>. Plans at <strong>{compactDollars(view.threshold)}/mo</strong> or
      more include Incrementality Measurement at no cost. Add <strong>{compactDollars(view.shortfall)}/mo</strong> to qualify.
    </span>
  </div>
);

/**
 * Planner-only while the product is in testing: the page never renders it on a share link, and
 * its eye is locked off rather than offered, so no planner can put it in front of a client.
 */
export const IncrementalityMeasurementSection: React.FC<{ view: IncrementalityView }> = ({ view }) => {
  const [expanded, setExpanded] = React.useState(true);
  const measuredWidth = Math.min(100, view.measuredPct);

  return (
    <div className="group relative rounded-2xl border border-dashed border-slate-300 bg-white shadow-xs overflow-hidden">
      <div className="flex items-start gap-2.5 border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
        <FlaskConical className="w-4 h-4 shrink-0 mt-px text-amber-700" />
        <span>
          <strong>In testing: Incrementality Measurement (OPA) is not live yet.</strong> This section is for planners to review and
          give feedback on. It is not ready for clients, so it never appears on share links.
        </span>
      </div>
      <div className="w-full p-4 md:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3 text-left">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="flex items-center gap-3 shrink-0 cursor-pointer text-left focus:outline-none"
          aria-expanded={expanded}
        >
          <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
            <Target className="w-4 h-4" />
          </div>
          <div>
            <div className="text-indigo-600 text-[11px] font-bold uppercase tracking-wider">Incrementality Measurement</div>
            <h3 className="text-base font-display font-bold text-slate-800">How this plan proves what it adds</h3>
          </div>
        </button>

        <div className="flex flex-wrap items-center gap-2 flex-1 md:justify-end md:mr-3 cursor-pointer" onClick={() => setExpanded((prev) => !prev)}>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200/80 rounded-lg">
            <Gift className="w-3.5 h-3.5" />
            Included at no cost
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200/70 rounded-lg">
            <PieChart className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
            <span className="font-semibold text-slate-900">{view.measuredPct}%</span>
            <span>of budget measured</span>
          </span>
        </div>

        <div className="flex items-center gap-2 self-end md:self-center shrink-0">
          <span
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-100/90 px-2 py-0.5 text-[10px] font-bold text-amber-800 border border-amber-200/80"
            title="Not live yet: this section cannot be shown on share links"
          >
            <EyeOff className="w-3 h-3" />
            Hidden from share link
          </span>
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 group-hover:text-indigo-600 hover:text-indigo-600 hover:bg-indigo-50 border border-slate-200/60 transition-colors shrink-0 cursor-pointer"
            aria-label={expanded ? "Collapse Incrementality Measurement" : "Expand Incrementality Measurement"}
          >
            {expanded ? <ChevronUp className="w-4 h-4 text-indigo-600" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-100 p-5 md:p-6 bg-slate-50/30 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              { step: "1 · Identity", title: "Who saw what", body: "Every exposure tied to one household, across TV, phone and laptop." },
              { step: "2 · Lift", title: "Did it work?", body: "Exposed households compared with matched control households. No PSAs, no dark markets." },
              { step: "3 · Path analysis", title: "How did it work?", body: "Lift split across media combinations, publisher order, frequency and timing." },
            ].map((item) => (
              <div key={item.step} className="bg-white rounded-xl border border-slate-100 p-4">
                <span className="text-[10px] font-semibold text-slate-400">{item.step}</span>
                <p className="mt-1 text-sm font-bold text-slate-800">{item.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">{item.body}</p>
              </div>
            ))}
          </div>

          {view.metric && view.kpi && (
            <div className="bg-white rounded-xl border border-slate-100 p-4 flex flex-col md:flex-row md:items-center gap-3">
              <div className="shrink-0">
                <span className="text-[10px] uppercase font-mono text-indigo-600 font-bold block">Your KPI</span>
                <p className="mt-1 text-sm font-bold text-slate-800 flex flex-wrap items-center gap-1.5">
                  <span>{view.kpi}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-indigo-600">{view.metric}</span>
                </p>
                <p className="text-xs text-slate-500">{view.metricMeaning}</p>
              </div>
              <div className="flex flex-wrap gap-1.5 md:justify-end md:flex-1">
                {view.otherMetrics.map((metric) => (
                  <span key={metric} className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200/70 rounded-lg">{metric}</span>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-white rounded-xl border border-slate-100 p-4">
              <span className="text-[10px] uppercase font-mono text-indigo-600 font-bold block mb-3">Questions this plan will answer</span>
              <ul className="space-y-2.5">
                {view.questions.map((question) => {
                  const Icon = QUESTION_ICONS[question.kind];
                  return (
                    <li key={question.kind} className="flex gap-2 text-xs leading-relaxed text-slate-700">
                      <Icon className="w-4 h-4 shrink-0 text-indigo-600" />
                      <span>{question.text}</span>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="bg-white rounded-xl border border-slate-100 p-4">
              <span className="text-[10px] uppercase font-mono text-indigo-600 font-bold block">Your readout will show</span>
              <p className="text-[11px] text-slate-500 mb-3">Conversion rate, exposed vs. control, for this plan's publishers</p>
              {/* Even bars on purpose: the product is not released, so the preview shows the readout's shape, never a result. */}
              <div className="space-y-2">
                {(view.publishers.length ? view.publishers : ["Publisher A", "Publisher B", "Publisher C"]).map((name) => (
                  <div key={name} className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2">
                    <span className="text-[11px] text-slate-500 truncate">{name}</span>
                    <div className="space-y-0.5">
                      <div className="h-1.5 w-3/4 rounded-full bg-indigo-200" />
                      <div className="h-1.5 w-3/5 rounded-full bg-slate-200" />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-3 text-[10px] text-slate-500">
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-indigo-200" />Exposed</span>
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-slate-200" />Control</span>
                <span className="ml-auto">Shape only, no results</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-3">
            <div className="bg-white rounded-xl border border-slate-100 p-4">
              <span className="text-[10px] uppercase font-mono text-indigo-600 font-bold block mb-3">What's measured</span>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden mb-3">
                <div className="h-full bg-indigo-600" style={{ width: `${measuredWidth}%` }} />
              </div>
              <p className="text-[10px] font-semibold text-slate-400 mb-1">Lift and path analysis</p>
              <ul className="text-xs space-y-1.5">
                {view.measured.map((line) => (
                  <li key={line.name} className="flex justify-between gap-2"><span className="text-slate-800">{line.name}</span><span className="text-slate-500 whitespace-nowrap">{line.sharePct}%</span></li>
                ))}
              </ul>
              {view.notMeasured.length > 0 && (
                <>
                  <p className="text-[10px] font-semibold text-slate-400 mt-3 mb-1">Outside this measurement</p>
                  <ul className="text-xs space-y-1.5">
                    {view.notMeasured.map((line) => (
                      <li key={line.name} className="flex justify-between gap-2"><span className="text-slate-500">{line.name}</span><span className="text-slate-400 whitespace-nowrap">{line.sharePct}%</span></li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <div className="bg-white rounded-xl border border-slate-100 p-4">
              <span className="text-[10px] uppercase font-mono text-indigo-600 font-bold block mb-3">Readout cadence</span>
              <ul className="text-xs space-y-2 leading-relaxed">
                <li><span className="font-semibold text-slate-800">Launch</span> <span className="text-slate-500">· control baseline set for the flight</span></li>
                <li><span className="font-semibold text-slate-800">Mid-flight</span> <span className="text-slate-500">· shift budget and frequency to proven paths</span></li>
                <li><span className="font-semibold text-slate-800">Wrap</span> <span className="text-slate-500">· full lift and path readout</span></li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
