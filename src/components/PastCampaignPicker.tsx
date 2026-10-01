import React from "react";
import { BarChart3, CheckCircle2, Loader2 } from "lucide-react";
import * as api from "../api/client";

// In the brief: the advertiser's past campaigns to build the new plan from. Every campaign in the
// library is included until the planner unticks one (selection null); a reopened plan arrives
// with exactly the campaigns it was built from.

interface Props {
  advertiserName: string;
  /** null: every campaign in the advertiser's library. */
  selection: string[] | null;
  onChange: (selection: string[]) => void;
  /** The campaigns on offer, so a null selection can be resolved when the plan is generated. */
  onOptions: (ids: string[]) => void;
  onManage: () => void;
  /** Bumped after the library changes, to reload it. */
  refreshKey: number;
}

export function PastCampaignPicker({ advertiserName, selection, onChange, onOptions, onManage, refreshKey }: Props) {
  const [campaigns, setCampaigns] = React.useState<api.PerformanceCampaignSummary[] | null>(null);
  const advertiser = advertiserName.trim();

  React.useEffect(() => {
    if (!advertiser) {
      setCampaigns(null);
      onOptions([]);
      return;
    }
    let cancelled = false;
    // Typing the advertiser's name should not query the library on every keystroke.
    const timer = setTimeout(() => {
      api.listPerformanceCampaigns({ advertiser })
        .then((list) => {
          if (cancelled) return;
          setCampaigns(list);
          onOptions(list.map((c) => c.id));
        })
        .catch(() => !cancelled && setCampaigns([]));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advertiser, refreshKey]);

  if (!advertiser) return null;
  const checked = (id: string) => selection === null || selection.includes(id);
  const toggle = (id: string) => {
    const current = selection ?? (campaigns || []).map((c) => c.id);
    onChange(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  };

  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
          <BarChart3 className="w-3.5 h-3.5 text-indigo-500" /> Past campaigns
        </span>
        <button type="button" onClick={onManage} className="text-[11px] font-bold text-indigo-700 hover:text-indigo-900 cursor-pointer">
          {campaigns && campaigns.length ? "Manage" : "Add reports"}
        </button>
      </div>
      {campaigns === null ? (
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-400"><Loader2 className="w-3 h-3 animate-spin" /> Checking the library…</div>
      ) : campaigns.length === 0 ? (
        <p className="mt-1 text-[11px] leading-snug text-slate-500">None for {advertiser} yet. Add a past campaign's reports and the plan is built with what worked.</p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {campaigns.map((c) => (
            <li key={c.id}>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={checked(c.id)} onChange={() => toggle(c.id)} className="mt-0.5 h-3.5 w-3.5 accent-indigo-600 cursor-pointer" />
                <span className="min-w-0 text-[11px] leading-snug text-slate-700">
                  <span className="font-semibold">{c.name}</span>
                  <span className="text-slate-400"> · {c.fileCount} file{c.fileCount === 1 ? "" : "s"}{c.conversionLabel ? ` · ${c.conversionLabel}` : ""}</span>
                </span>
              </label>
            </li>
          ))}
          <li className="pt-0.5 flex items-center gap-1 text-[10px] text-slate-400">
            <CheckCircle2 className="w-3 h-3" /> Ticked campaigns shape the channel mix and publisher picks, and stay linked to the new plan.
          </li>
        </ul>
      )}
    </div>
  );
}
