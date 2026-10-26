import React from "react";
import { ArrowRight, FlaskConical } from "lucide-react";
import type { MatchedMarketDesign } from "../planning/matchedMarkets";
import { SectionVisibilityButton } from "./SectionVisibilityButton";

const households = (value: number) =>
  value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : `${Math.round(value / 1000)}K`;

interface MatchedMarketCardProps {
  design: MatchedMarketDesign;
  /** The plan's primary KPI, named in the explanation of what the test measures. */
  kpi?: string;
  isHidden: boolean;
  isShareView: boolean;
  onToggleHidden: (sectionKey: string, inactive: boolean) => void;
}

/**
 * A proposed design, worded as one: the controls are chosen by code from households and region,
 * and nothing here says a study is booked or names a measurement product the plan may not carry.
 */
export const MatchedMarketCard: React.FC<MatchedMarketCardProps> = ({ design, kpi, isHidden, isShareView, onToggleHidden }) => {
  const unit = design.scope === "dma" ? "market" : "state";
  const matched = design.pairs.filter((pair) => pair.control);
  const unmatched = design.pairs.filter((pair) => !pair.control);
  const measure = kpi?.trim() ? kpi.trim().toLowerCase() : "the primary KPI";

  return (
    <div className={`rounded-xl border p-4 ${isHidden ? "border-dashed border-slate-300 bg-slate-100/70 opacity-50" : "border-slate-100 bg-white"}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase font-mono text-indigo-600 font-bold">Measurement Design</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100/80 rounded-md">
            <FlaskConical className="w-3 h-3" />
            Matched-{unit} lift test
          </span>
        </div>
        {!isShareView && <SectionVisibilityButton sectionKey="geoTest" isInactive={isHidden} onToggle={onToggleHidden} />}
      </div>
      <p className="text-xs text-slate-600 leading-relaxed mb-3">
        Hold out comparable {unit}s to show what the campaign adds. Lift is the difference in {measure} between
        the test and control {unit}s over the flight.
      </p>

      <div className="divide-y divide-slate-100">
        <div className="grid grid-cols-[minmax(0,1fr)_16px_minmax(0,1fr)_auto] gap-3 pb-1.5 text-[10px] font-semibold text-slate-400">
          <span>Test {unit}</span>
          <span />
          <span>Control {unit}</span>
          <span className="text-right">Match</span>
        </div>
        {matched.map((pair) => (
          <div key={pair.test.id} className="grid grid-cols-[minmax(0,1fr)_16px_minmax(0,1fr)_auto] gap-3 items-center py-2 text-xs">
            <span className="min-w-0">
              <span className="font-semibold text-slate-800 block leading-snug">{pair.test.name}</span>
              <span className="text-[10px] text-slate-400">{households(pair.test.households)} TV HH</span>
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-300" />
            <span className="min-w-0">
              <span className="font-semibold text-slate-800 block leading-snug">{pair.control!.name}</span>
              <span className="text-[10px] text-slate-400">{households(pair.control!.households)} TV HH</span>
            </span>
            <span className="text-[10px] text-slate-500 text-right whitespace-nowrap">{pair.match}</span>
          </div>
        ))}
      </div>

      {unmatched.length > 0 && (
        <p className="text-[11px] text-slate-500 leading-relaxed mt-2">
          {unmatched.map((pair) => pair.test.name).join(", ")} {unmatched.length === 1 ? "has" : "have"} no untargeted {unit} of
          comparable size; measure {unmatched.length === 1 ? "it" : "them"} against {unmatched.length === 1 ? "its" : "their"} own
          pre-campaign baseline.
        </p>
      )}
      <p className="text-[10px] text-slate-400 mt-2">
        Controls matched on TV households and Census region · {households(design.testHouseholds)} test vs {households(design.controlHouseholds)} control
        households · Confirm the design with the measurement partner before launch.
      </p>
    </div>
  );
};
