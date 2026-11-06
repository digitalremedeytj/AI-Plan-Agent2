import React from "react";
import { ChevronDown, Database, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import * as api from "../api/client";
import { providerById, toAdvertiserKey, type PartnerProvider, type ResearchDatasetSummary } from "../research/partnerData";
import { suggestDatasets } from "../research/partnerReinforcement";
import { PartnerLogo } from "./PartnerLogo";

// In the brief: the partner research to build the plan with. The library is shared, so research
// prepared for one advertiser can back another's plan (the other client is never named in it).
// Until the planner ticks something, the advertiser's own research with approved figures is used
// (selection null), like past campaigns. Research with nothing approved cannot be ticked.
// Other advertisers' research that fits the brief (same category or markets) is suggested, never
// ticked for the planner: it was made for another client, so using it is the planner's call.

interface Props {
  advertiserName: string;
  /** null: the advertiser's own approved research. */
  selection: string[] | null;
  onChange: (selection: string[]) => void;
  /** What a null selection resolves to, for the generation request. */
  onDefaults: (ids: string[]) => void;
  onManage: (datasetId?: string) => void;
  refreshKey: number;
  /** What the brief says, to suggest other advertisers' research that fits it. */
  brief?: { text: string; geography: string };
}

export function PartnerResearchPicker({ advertiserName, selection, onChange, onDefaults, onManage, refreshKey, brief }: Props) {
  const [datasets, setDatasets] = React.useState<ResearchDatasetSummary[] | null>(null);
  const [providers, setProviders] = React.useState<PartnerProvider[] | undefined>(undefined);
  const [showOthers, setShowOthers] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const advertiserKey = toAdvertiserKey(advertiserName);

  React.useEffect(() => {
    let cancelled = false;
    api.listResearchDatasets().then((list) => !cancelled && setDatasets(list)).catch(() => !cancelled && setDatasets([]));
    api.getPartnerProviders().then((r) => !cancelled && setProviders(r.providers)).catch(() => {});
    return () => { cancelled = true; };
  }, [refreshKey]);

  const own = (datasets || []).filter((d) => advertiserKey && d.advertiserKey === advertiserKey);
  const others = (datasets || []).filter((d) => !own.includes(d));
  const defaults = own.filter((d) => d.factCounts.approved > 0).map((d) => d.id);
  const defaultsKey = defaults.join(",");

  React.useEffect(() => {
    onDefaults(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultsKey]);

  const current = selection ?? defaults;
  const briefText = brief?.text ?? "";
  const briefGeography = brief?.geography ?? "";
  const suggestions = React.useMemo(
    () => (datasets && advertiserKey ? suggestDatasets(others, { advertiserName, text: briefText, geography: briefGeography }) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [datasets, advertiserKey, briefText, briefGeography],
  );
  const suggestedIds = new Set(suggestions.map((s) => s.id));
  const toggle = (id: string) => onChange(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  const q = query.trim().toLowerCase();
  // Ticked research from the wider library stays visible even when the list is folded away.
  const othersShown = others.filter((d) => !suggestedIds.has(d.id)).filter((d) => (showOthers && (!q || `${d.title} ${d.providerLabel} ${providerById(d.provider).name} ${d.markets.join(" ")} ${d.category}`.toLowerCase().includes(q))) || current.includes(d.id));
  const tickedCount = current.filter((id) => (datasets || []).some((d) => d.id === id)).length;

  const row = (d: ResearchDatasetSummary, showAdvertiser: boolean, reason?: string) => {
    const usable = d.factCounts.approved > 0;
    return (
      <li key={d.id}>
        <label className={`flex items-start gap-2 ${usable ? "cursor-pointer" : "opacity-70"}`}>
          <input type="checkbox" disabled={!usable} checked={usable && current.includes(d.id)} onChange={() => toggle(d.id)} className="mt-0.5 h-3.5 w-3.5 accent-indigo-600 cursor-pointer disabled:cursor-not-allowed" />
          <span className="min-w-0 text-[11px] leading-snug text-slate-700">
            <span className="inline-flex align-middle mr-1"><PartnerLogo provider={providerById(d.provider, providers)} size="sm" /></span>
            <span className="font-semibold">{d.title}</span>
            <span className="text-slate-400">
              {showAdvertiser && d.advertiserName ? ` · for ${d.advertiserName}` : ""}
              {usable ? ` · ${d.factCounts.approved} approved figure${d.factCounts.approved === 1 ? "" : "s"}` : ""}
            </span>
            {d.factCounts.pending > 0 && (
              <button type="button" onClick={(e) => { e.preventDefault(); onManage(d.id); }} className="ml-1 text-amber-700 font-semibold hover:underline cursor-pointer">
                {d.factCounts.pending} to review
              </button>
            )}
            {reason && <span className="block text-[10px] text-indigo-600">{reason}</span>}
          </span>
        </label>
      </li>
    );
  };

  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
          <Database className="w-3.5 h-3.5 text-indigo-500" /> Partner research
          {tickedCount > 0 && <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded px-1.5">{tickedCount} in use</span>}
        </span>
        <button type="button" onClick={() => onManage()} className="text-[11px] font-bold text-indigo-700 hover:text-indigo-900 cursor-pointer">
          {datasets && datasets.length ? "Library" : "Upload data"}
        </button>
      </div>
      {datasets === null ? (
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-400"><Loader2 className="w-3 h-3 animate-spin" /> Checking the library…</div>
      ) : datasets.length === 0 ? (
        <p className="mt-1 text-[11px] leading-snug text-slate-500">Upload GWI, Resonate, MediaRadar, Statista or Census data and the plan is built on it, credited to the partner.</p>
      ) : (
        <>
          {own.length > 0 && <ul className="mt-1.5 space-y-1">{own.map((d) => row(d, false))}</ul>}
          {own.length === 0 && advertiserKey && <p className="mt-1 text-[11px] text-slate-500">None prepared for {advertiserName.trim()} yet.</p>}
          {suggestions.length > 0 && (
            <div className="mt-1.5">
              <div className="flex items-center gap-1 text-[11px] font-semibold text-indigo-700"><Sparkles className="w-3 h-3" /> Suggested for this brief</div>
              <ul className="mt-1 space-y-1">{suggestions.map((sug) => { const d = others.find((x) => x.id === sug.id); return d ? row(d, true, sug.reason) : null; })}</ul>
            </div>
          )}
          {others.length > suggestedIds.size && (
            <div className="mt-1.5">
              <button type="button" onClick={() => setShowOthers((v) => !v)} className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-800 cursor-pointer">
                <ChevronDown className={`w-3 h-3 transition-transform ${showOthers ? "rotate-180" : ""}`} />
                {advertiserKey ? "Other research in the library" : "Research in the library"} ({others.length - suggestedIds.size})
              </button>
              {showOthers && others.length > 6 && (
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search partner, market, category…" className="mt-1 w-full text-[11px] px-2 py-1 border border-slate-200 rounded-md bg-white" />
              )}
              {othersShown.length > 0 && <ul className="mt-1 space-y-1">{othersShown.map((d) => row(d, true))}</ul>}
            </div>
          )}
          <p className="pt-1.5 flex items-center gap-1 text-[10px] text-slate-400">
            <ShieldCheck className="w-3 h-3" /> Only approved figures are used. Research prepared for another client never names them in this plan.
          </p>
        </>
      )}
    </div>
  );
}
