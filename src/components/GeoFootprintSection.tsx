import React from "react";
import { Ban, ChevronDown, ChevronUp, Crosshair, Hash, Home, Info, Map as MapIcon, MapPin, PieChart } from "lucide-react";
import type { GeoFootprintView, PrecisionKind } from "../planning/geoFootprint";
import { DMA_SOURCE_LABEL } from "../planning/knowledge/dmaMarkets";
import { STATE_HOUSEHOLDS_SOURCE_LABEL } from "../planning/knowledge/stateHouseholds";
import { FootprintMap } from "./FootprintMap";
import { MatchedMarketCard } from "./MatchedMarketCard";
import type { MatchedMarketDesign } from "../planning/matchedMarkets";
import { SectionVisibilityButton } from "./SectionVisibilityButton";

const PRECISION_ICONS: Record<PrecisionKind, React.ComponentType<{ className?: string }>> = {
  radius: Crosshair,
  zip: Hash,
  exclusion: Ban,
};

function compactHouseholds(value: number): string {
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : `${Math.round(value / 1000)}K`;
}

function compactDollars(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1000) return `$${Math.round(value / 1000)}K`;
  return `$${Math.round(value)}`;
}

function sharePctLabel(value: number): string {
  return value < 0.1 ? "<0.1%" : `${value.toFixed(1)}%`;
}

interface GeoFootprintSectionProps {
  view: GeoFootprintView;
  /** The narrative's geography note (demographics.geographyNotes), the section's only model text. */
  insight?: string;
  isHidden: boolean;
  isShareView: boolean;
  onToggleHidden: (sectionKey: string, inactive: boolean) => void;
  /** A matched-market lift test for the footprint; null when none can be designed. */
  testDesign?: MatchedMarketDesign | null;
  kpi?: string;
  isTestHidden?: boolean;
}

/**
 * Open by default: the PDF export captures the live page, so a collapsed panel would be missing
 * from the exported plan.
 */
export const GeoFootprintSection: React.FC<GeoFootprintSectionProps> = ({ view, insight, isHidden, isShareView, onToggleHidden, testDesign, kpi, isTestHidden = false }) => {
  const [expanded, setExpanded] = React.useState(true);
  const isDma = view.scope === "dma";
  const showBudget = view.rows.some((row) => row.budget !== undefined);

  const chips = [
    { icon: isDma ? MapPin : MapIcon, label: isDma ? "Markets" : "States", value: String(view.rows.length) },
    { icon: Home, label: "TV HH", value: compactHouseholds(view.households) },
    { icon: PieChart, label: "Share of US", value: sharePctLabel(view.usSharePct) },
  ];

  return (
    <div className={`group relative rounded-2xl border shadow-xs overflow-hidden transition-all duration-200 ${
      isHidden
        ? "border-dashed border-slate-300 bg-slate-100/70 opacity-40 hover:opacity-70"
        : "border-slate-100 bg-white hover:border-slate-200"
    }`}>
      <div className="w-full p-4 md:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3 text-left">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="flex items-center gap-3 shrink-0 cursor-pointer text-left focus:outline-none"
          aria-expanded={expanded}
        >
          <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
            <MapPin className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-indigo-600 text-[11px] font-bold uppercase tracking-wider">
              <span>Geo Footprint</span>
            </div>
            <h3 className="text-base font-display font-bold text-slate-800">{view.title}</h3>
          </div>
        </button>

        <div className="flex flex-wrap items-center gap-2 flex-1 md:justify-end md:mr-3 cursor-pointer" onClick={() => setExpanded((prev) => !prev)}>
          <span className="px-2.5 py-1 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100/80 rounded-lg">
            {isDma ? "DMA Targeting" : "State Targeting"}
          </span>
          {chips.map(({ icon: Icon, label, value }) => (
            <span key={label} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200/70 rounded-lg">
              <Icon className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              <span className="font-semibold text-slate-900">{label}:</span>
              <span>{value}</span>
            </span>
          ))}
        </div>

        <div className="flex items-center gap-2 self-end md:self-center shrink-0">
          {!isShareView && <SectionVisibilityButton sectionKey="geo" isInactive={isHidden} onToggle={onToggleHidden} />}
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 group-hover:text-indigo-600 hover:text-indigo-600 hover:bg-indigo-50 border border-slate-200/60 transition-colors shrink-0 cursor-pointer"
            aria-label={expanded ? "Collapse Geo Footprint" : "Expand Geo Footprint"}
          >
            {expanded ? <ChevronUp className="w-4 h-4 text-indigo-600" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-100 p-5 md:p-6 bg-slate-50/30 space-y-5">
          {insight && insight.trim() && <p className="text-xs text-slate-600 leading-relaxed">{insight}</p>}

          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-5 items-start">
            <div className="bg-white rounded-xl border border-slate-100 p-4 min-w-0">
              <span className="text-[10px] uppercase font-mono text-indigo-600 font-bold block mb-3">Coverage Map</span>
              <FootprintMap view={view} />
            </div>

            <div className="bg-white rounded-xl border border-slate-100 p-4 min-w-0">
              <span className="text-[10px] uppercase font-mono text-indigo-600 font-bold block mb-2">Market Breakdown</span>
              <table className="w-full text-xs table-fixed">
                <thead>
                  <tr className="text-[10px] text-slate-400 font-semibold text-left">
                    <th className="py-1.5 font-semibold">{isDma ? "Market" : "State"}</th>
                    <th className="py-1.5 font-semibold w-16">{isDma ? "Rank" : "Markets"}</th>
                    <th className="py-1.5 font-semibold w-20 text-right">TV HH</th>
                    <th className="py-1.5 font-semibold w-32 pl-3">Share of footprint</th>
                    {showBudget && <th className="py-1.5 font-semibold w-16 text-right">Budget</th>}
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100">
                      <td className="py-2 pr-2 font-semibold text-slate-800 leading-snug">{row.name}</td>
                      <td className="py-2 font-mono text-[10px] text-slate-400">{row.detail}</td>
                      <td className="py-2 text-right text-slate-600">{compactHouseholds(row.households)}</td>
                      <td className="py-2 pl-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-indigo-50 overflow-hidden">
                            <div className="h-full rounded-full bg-indigo-600" style={{ width: `${row.sharePct}%` }} />
                          </div>
                          <span className="w-8 text-right text-[10px] text-slate-500">{row.sharePct}%</span>
                        </div>
                      </td>
                      {showBudget && <td className="py-2 text-right font-mono font-bold text-slate-900">{row.budget !== undefined ? compactDollars(row.budget) : ""}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {view.precision.length > 0 && (
            <div>
              <span className="text-[10px] uppercase font-mono text-indigo-600 font-bold block mb-2">Precision Targeting</span>
              <div className="flex flex-wrap gap-1.5">
                {view.precision.map((target, index) => {
                  const Icon = PRECISION_ICONS[target.kind];
                  return (
                    <span key={index} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-100/80 rounded-lg">
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span>{target.label}</span>
                      <span className="text-indigo-400">→ {target.action}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {testDesign && (!isShareView || !isTestHidden) && (
            <MatchedMarketCard design={testDesign} kpi={kpi} isHidden={isTestHidden} isShareView={isShareView} onToggleHidden={onToggleHidden} />
          )}

          {view.coverageNote && (
            <div className="flex gap-2 bg-white rounded-xl border border-slate-100 p-4 text-xs text-slate-600 leading-relaxed">
              <Info className="w-4 h-4 text-indigo-600 shrink-0 mt-px" />
              <span>{view.coverageNote}</span>
            </div>
          )}

          <p className="text-[10px] text-slate-400">
            Household data: {isDma ? DMA_SOURCE_LABEL : STATE_HOUSEHOLDS_SOURCE_LABEL} · Map: U.S. Census Bureau
            {showBudget && " · Budget split by TV households"}
            {/* Planner-only: a prospect has no use for which picks failed to size. */}
            {!isShareView && view.unsized.length > 0 && ` · Not sized: ${view.unsized.join(", ")}`}
          </p>
        </div>
      )}
    </div>
  );
};
