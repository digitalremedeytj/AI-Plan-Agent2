import React from "react";
import { ArrowRightLeft, Database, Download, MapPin, RefreshCw, ShieldCheck } from "lucide-react";
import { clientPeriod, type PartnerEvidence, type PartnerProvider } from "../research/partnerData";
import { PartnerLogo } from "./PartnerLogo";
import { SectionVisibilityButton } from "./SectionVisibilityButton";

// The client-facing proof that the plan rests on named data partners, not on AI alone: their logos,
// how many checked figures the plan uses, and what each dataset measured. Everything shown comes from
// the plan's partnerEvidence, which never names the client a dataset was first prepared for.

interface Props {
  evidence: PartnerEvidence;
  /** The partners as an admin has them now, so a logo uploaded after the plan was made still shows. */
  liveProviders?: PartnerProvider[];
  isShareView: boolean;
  isHidden: boolean;
  onToggleHidden: (sectionKey: string, inactive: boolean) => void;
  /** Planners only: add or change the plan's partner research. */
  onUpdate?: () => void;
  /** Opens the slide export; offered on share links too, like the persona slides. */
  onExport?: () => void;
}

export const DATA_PARTNERS_SECTION = "dataPartners";

export function DataPartnersPanel({ evidence, liveProviders, isShareView, isHidden, onToggleHidden, onUpdate, onExport }: Props) {
  const providers = evidence.providers.map((p) => {
    const live = liveProviders?.find((l) => l.id === p.id);
    return { ...p, logoUrl: live?.logoUrl || p.logoUrl };
  });
  const providerFor = (id: string) => providers.find((p) => p.id === id) ?? providers[0];
  const credits = [...new Set(evidence.datasets.map((d) => d.providerLabel))];

  return (
    <div
      className={`group relative rounded-2xl border overflow-hidden transition-all ${
        isHidden ? "border-dashed border-slate-300 bg-slate-100/70 opacity-40 hover:opacity-70" : "border-indigo-100 bg-white shadow-xs"
      }`}
    >
      <div className="bg-gradient-to-r from-indigo-50 via-white to-emerald-50/60 px-5 md:px-6 pt-5 pb-4 border-b border-indigo-100/60">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider">
            <ShieldCheck className="w-4 h-4" />
            <span>Data Partners</span>
          </div>
          <div className="flex items-center gap-1">
            {onExport && (
              <button type="button" onClick={onExport} className="p-1.5 text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200/90 rounded-lg inline-flex items-center justify-center cursor-pointer" title="Export presentation slides" aria-label="Export Data Partners slides">
                <Download className="w-4 h-4" />
              </button>
            )}
          {!isShareView && (
            <div className="flex items-center gap-1">
              {onUpdate && (
                <button type="button" onClick={onUpdate} className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50 px-2 py-1 rounded-lg cursor-pointer">
                  <RefreshCw className="w-3 h-3" /> Update research
                </button>
              )}
              <SectionVisibilityButton sectionKey={DATA_PARTNERS_SECTION} isInactive={isHidden} onToggle={onToggleHidden} />
            </div>
          )}
          </div>
        </div>
        <h3 className="text-lg font-display font-bold text-slate-900 leading-snug">Built on licensed research from our data partners</h3>
        <p className="mt-1 text-sm text-slate-600 leading-relaxed">
          The audience, market and competitive figures in this plan are taken from {credits.length === 1 ? credits[0] : `${credits.slice(0, -1).join(", ")} and ${credits[credits.length - 1]}`}.
          Each was checked against the partner's data by our team before it was used.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {providers.map((p) => <PartnerLogo key={p.id} provider={p} size="lg" framed />)}
        </div>
      </div>

      <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100 text-center">
        <Stat value={evidence.factCount} label={`verified data point${evidence.factCount === 1 ? "" : "s"}`} />
        <Stat value={evidence.datasets.length} label={`partner dataset${evidence.datasets.length === 1 ? "" : "s"}`} />
        <Stat value={providers.length} label={`data partner${providers.length === 1 ? "" : "s"}`} />
      </div>

      <ul className="px-5 md:px-6 py-4 space-y-3">
        {evidence.datasets.map((d) => {
          const provider = providerFor(d.provider);
          return (
            <li key={d.id} className="flex items-center gap-4">
              {/* A fixed tile, so every description starts at the same point whatever the logo's shape. */}
              {provider && <PartnerLogo provider={provider} size="sm" label={d.providerLabel} framed />}
              <div className="min-w-0">
                <p className="text-xs text-slate-700 leading-snug">{d.description}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-500">
                  <span className="font-semibold text-slate-600">{d.providerLabel}</span>
                  {clientPeriod(d.period) && <span>· {clientPeriod(d.period)}</span>}
                  {d.markets.length > 0 && (
                    <span className="inline-flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" />{d.markets.slice(0, 5).join(", ")}{d.markets.length > 5 ? ` +${d.markets.length - 5} more` : ""}</span>
                  )}
                  <span className="inline-flex items-center gap-0.5"><Database className="w-2.5 h-2.5" />{d.factCount} data point{d.factCount === 1 ? "" : "s"}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* A budget move the data made is the one place partner data changed the plan, not just
          supported it, so the client sees what moved and the figure that moved it. */}
      {evidence.allocationChanges && evidence.allocationChanges.length > 0 && (
        <div className="mx-5 md:mx-6 mb-5 rounded-xl border border-emerald-100 bg-emerald-50/50 px-4 py-3">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 mb-1.5">
            <ArrowRightLeft className="w-3.5 h-3.5" /> What the partner data changed
          </div>
          <ul className="space-y-2">
            {evidence.allocationChanges.map((c) => (
              <li key={`${c.appliedAt}-${c.title}`}>
                <p className="text-xs font-semibold text-slate-800">{c.title}</p>
                <p className="text-xs text-slate-600 leading-snug">{c.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="py-3 px-2">
      <div className="text-2xl font-display font-extrabold text-indigo-700 leading-none">{value.toLocaleString()}</div>
      <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
    </div>
  );
}
