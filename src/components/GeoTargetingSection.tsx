import React from "react";
import { AlertTriangle, MapPin } from "lucide-react";
import type { GeoTargeting } from "../types";
import { DMA_SOURCE_LABEL } from "../planning/knowledge/dmaMarkets";
import { geoCoverage } from "../planning/geoTargeting";

interface GeoTargetingSectionProps {
  targeting: GeoTargeting;
  /** Model-authored narrative. The market list beside it is the planner's own input. */
  insights?: string;
}

/**
 * Renders open by default: the PDF export screenshots the live DOM, so a collapsed panel
 * would be missing from the exported plan entirely.
 */
export const GeoTargetingSection: React.FC<GeoTargetingSectionProps> = ({ targeting, insights }) => {
  const coverage = geoCoverage(targeting);
  if (!coverage) return null;

  const isDma = coverage.scope === "dma";
  const provenance = targeting.inputMethod === "upload" && targeting.sourceFileName
    ? `Uploaded from ${targeting.sourceFileName}`
    : targeting.inputMethod === "paste"
      ? "Entered by the planner"
      : "Selected by the planner";

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-xs overflow-hidden">
      <div className="p-4 md:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
            <MapPin className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-indigo-600 text-[11px] font-bold uppercase tracking-wider">
              <span>Geo Targeting</span>
            </div>
            <h3 className="text-base font-display font-bold text-slate-800">
              {isDma ? "Market Footprint & Coverage" : "State Footprint & Market Overlap"}
            </h3>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 flex-1 md:justify-end">
          <span className="px-2.5 py-1 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100/80 rounded-lg">
            {isDma ? "DMA Targeting" : "State Targeting"}
          </span>
          {coverage.scope === "dma" ? (
            <>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200/70 rounded-lg">
                <span className="font-semibold text-slate-900">Markets:</span>
                <span>{coverage.marketCount}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200/70 rounded-lg">
                <span className="font-semibold text-slate-900">TV HH:</span>
                <span>{(coverage.tvHouseholds / 1_000_000).toFixed(1)}M · {coverage.usSharePct.toFixed(1)}% of US</span>
              </span>
            </>
          ) : (
            <>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200/70 rounded-lg">
                <span className="font-semibold text-slate-900">States:</span>
                <span>{coverage.stateCount}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200/70 rounded-lg">
                <span className="font-semibold text-slate-900">Overlapping DMAs:</span>
                <span>{coverage.overlappingDmaCount}</span>
              </span>
            </>
          )}
        </div>
      </div>

      <div className="border-t border-slate-100 p-5 md:p-6 bg-slate-50/30 space-y-5">
        <div>
          <span className="text-[10px] uppercase font-mono text-indigo-600 font-bold block mb-2">
            {isDma ? "Targeted Markets" : "Targeted States"}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {targeting.entries.map((entry) => (
              <span key={entry.id} className="inline-flex items-baseline gap-1.5 px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 rounded-lg">
                {entry.name}
                <span className="text-slate-400">{isDma ? `#${entry.rank} · ${entry.id}` : entry.id}</span>
              </span>
            ))}
          </div>
          <p className="text-[10px] text-slate-400 mt-2">
            {provenance}
            {targeting.unresolved.length > 0 && ` · ${targeting.unresolved.length} entr${targeting.unresolved.length === 1 ? "y was" : "ies were"} not recognised and excluded`}
            {isDma && ` · Household data: ${DMA_SOURCE_LABEL}`}
          </p>
        </div>

        {/* Multi-state markets are why state targeting shows overlap rather than a household
            share: a roll-up would count one market's households once per state it touches. */}
        {coverage.scope === "state" && coverage.spillMarketCount > 0 && (
          <div className="bg-amber-50 rounded-xl border border-amber-100 p-4 text-[11px] text-amber-800">
            <span className="text-[10px] uppercase font-mono font-bold flex items-center gap-1.5 mb-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              Market Spill
            </span>
            <p className="leading-relaxed">
              {coverage.spillMarketCount} of the {coverage.overlappingDmaCount} markets serving these states also deliver
              into {coverage.spillStates.length} neighbouring states ({coverage.spillStates.join(", ")}). Plan for delivery
              outside the named states wherever those markets are bought.
            </p>
          </div>
        )}

        {coverage.scope === "dma" && coverage.states.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-100/80 p-4 text-[11px] text-slate-500">
            <span className="text-[10px] uppercase font-mono text-indigo-600 font-bold block mb-1">State Delivery</span>
            <p className="leading-relaxed">
              These markets deliver into {coverage.states.length} states: {coverage.states.join(", ")}.
            </p>
          </div>
        )}

        {insights && insights.trim().length > 0 && (
          <div>
            <span className="text-[10px] uppercase font-mono text-indigo-600 font-bold block mb-1.5">Geo Insights</span>
            <p className="text-xs text-slate-600 leading-relaxed">{insights}</p>
          </div>
        )}
      </div>
    </div>
  );
};
