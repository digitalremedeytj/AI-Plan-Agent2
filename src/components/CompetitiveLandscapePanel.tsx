import React from "react";
import { BarChart3, Download, Trophy } from "lucide-react";
import { clientPeriod, type PartnerProvider } from "../research/partnerData";
import { competitiveHighlights, formatSpend, type CompetitiveLandscape, type CompetitiveRow } from "../research/partnerReinforcement";
import { PartnerLogo } from "./PartnerLogo";
import { SectionVisibilityButton } from "./SectionVisibilityButton";

// Where competitors put their money, from the data partner's spend figures. Every value on it was
// read from an approved figure by code (normalizeCompetitive), so the panel can show exact numbers
// next to the partner's logo without a model having typed any of them.

export const COMPETITIVE_SECTION = "competitiveLandscape";

interface Props {
  landscape: CompetitiveLandscape;
  provider?: Pick<PartnerProvider, "id" | "name" | "logoUrl" | "color">;
  isShareView: boolean;
  isHidden: boolean;
  onToggleHidden: (sectionKey: string, inactive: boolean) => void;
  onExport?: () => void;
}

export function CompetitiveLandscapePanel({ landscape, provider, isShareView, isHidden, onToggleHidden, onExport }: Props) {
  const { competitors, mediaTypes, markets } = landscape;
  // Recomputed from the rows (pure arithmetic), so a wording fix reaches plans already saved.
  const highlights = competitiveHighlights(landscape);
  return (
    <div
      className={`group relative rounded-2xl border p-5 md:p-6 transition-all ${
        isHidden ? "border-dashed border-slate-300 bg-slate-100/70 opacity-40 hover:opacity-70" : "border-slate-200 bg-white shadow-xs"
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider">
          <BarChart3 className="w-4 h-4" />
          <span>Competitive Landscape</span>
        </div>
        <div className="flex items-center gap-1">
          {onExport && (
            <button type="button" onClick={onExport} className="p-1.5 text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200/90 rounded-lg inline-flex items-center justify-center cursor-pointer" title="Export presentation slides" aria-label="Export competitive landscape slides">
              <Download className="w-4 h-4" />
            </button>
          )}
          {!isShareView && <SectionVisibilityButton sectionKey={COMPETITIVE_SECTION} isInactive={isHidden} onToggle={onToggleHidden} />}
        </div>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-display font-bold text-slate-900 leading-snug">Where competitors are spending</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {landscape.scope}{clientPeriod(landscape.period) ? ` · ${clientPeriod(landscape.period)}` : ""}{landscape.totalSpend ? ` · ${formatSpend(landscape.totalSpend)} tracked` : ""}
          </p>
        </div>
        {provider && (
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Source <PartnerLogo provider={provider} size="sm" label={landscape.providerLabel} framed />
          </div>
        )}
      </div>

      {highlights.length > 0 && (
        <ul className="mt-4 grid gap-2 md:grid-cols-3">
          {highlights.map((h) => (
            <li key={h} className="rounded-xl bg-indigo-50/60 border border-indigo-100 px-3 py-2 text-xs leading-snug text-slate-700">{h}</li>
          ))}
        </ul>
      )}

      <div className={`mt-5 grid gap-6 ${competitors.length > 0 && mediaTypes.length > 0 ? "md:grid-cols-2" : ""}`}>
        {competitors.length > 0 && <Bars title="Spend by competitor" rows={competitors} color="bg-indigo-500" />}
        {mediaTypes.length > 0 && <Bars title="Competitor spend by media type" rows={mediaTypes} color="bg-emerald-500" />}
      </div>

      {markets.length > 0 && (
        <div className="mt-6">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Market by market</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
                  <th className="py-1.5 pr-3 font-semibold">Market</th>
                  <th className="py-1.5 pr-3 font-semibold">Spend leader</th>
                  <th className="py-1.5 pr-3 font-semibold text-right">Leader's share</th>
                  <th className="py-1.5 font-semibold text-right">Total tracked</th>
                </tr>
              </thead>
              <tbody>
                {markets.map((m) => (
                  <tr key={m.market} className="border-b border-slate-50 last:border-0">
                    <td className="py-1.5 pr-3 font-semibold text-slate-700">{m.market}</td>
                    <td className="py-1.5 pr-3 text-slate-600">
                      {m.leader ? <span className="inline-flex items-center gap-1"><Trophy className="w-3 h-3 text-amber-500" />{m.leader}{m.leaderSpend !== undefined ? <span className="text-slate-400"> · {formatSpend(m.leaderSpend)}</span> : null}</span> : "—"}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-slate-700">{m.leaderShare !== undefined ? `${m.leaderShare.toFixed(m.leaderShare % 1 ? 1 : 0)}%` : "—"}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-700">{m.totalSpend !== undefined ? formatSpend(m.totalSpend) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Bars({ title, rows, color }: { title: string; rows: CompetitiveRow[]; color: string }) {
  const max = Math.max(...rows.map((r) => r.spend), 1);
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">{title}</div>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.name} className="grid grid-cols-[minmax(0,8.5rem)_1fr_auto] items-center gap-2 text-xs">
            <span className={`truncate ${r.isAdvertiser ? "font-bold text-indigo-700" : "text-slate-700"}`} title={r.name}>{r.name}{r.isAdvertiser ? " (you)" : ""}</span>
            <span className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
              <span className={`block h-full rounded-full ${r.isAdvertiser ? "bg-amber-500" : color}`} style={{ width: `${Math.max(2, (r.spend / max) * 100)}%` }} />
            </span>
            <span className="tabular-nums text-slate-600 w-14 text-right">{formatSpend(r.spend)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
