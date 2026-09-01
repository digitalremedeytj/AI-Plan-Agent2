import React from "react";
import { AlertTriangle, Plus, RotateCcw, Save, Search, Settings, Trash2, X } from "lucide-react";
import {
  BudgetChannelTier,
  clonePlanningSettings,
  DEFAULT_PLANNING_SETTINGS,
  EnhancementPlanningSetting,
  OverviewMetricId,
  PlanningSettings,
  ProductPlanningSetting,
  PublisherPlanningSetting,
  validatePlanningSettings,
} from "../planning/settings";

interface SettingsDrawerProps {
  open: boolean;
  settings: PlanningSettings;
  onClose: () => void;
  onSave: (settings: PlanningSettings) => void;
}

type SettingsTab = "overview" | "budgets" | "products" | "publishers" | "enhancements";

function numericValue(value: string): number {
  if (value.trim() === "") return Number.NaN;
  return Number(value);
}

function nullableNumericValue(value: string): number | null {
  return value.trim() === "" ? null : numericValue(value);
}

function listValue(value: string): string[] {
  return value.split(/[,;]+/).map((item) => item.trim()).filter(Boolean);
}

const inputClass = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100";
const labelClass = "text-xs font-semibold text-slate-600";

function ShowToggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={`Show ${label}`}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-200 ${checked ? "bg-indigo-600" : "bg-slate-300"}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}

export function SettingsDrawer({ open, settings, onClose, onSave }: SettingsDrawerProps) {
  const [draft, setDraft] = React.useState<PlanningSettings>(() => clonePlanningSettings(settings));
  const [errors, setErrors] = React.useState<string[]>([]);
  const [activeTab, setActiveTab] = React.useState<SettingsTab>("budgets");
  const [search, setSearch] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setDraft(clonePlanningSettings(settings));
      setErrors([]);
      setSearch("");
    }
  }, [open, settings]);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const clearErrors = () => setErrors([]);
  const updateTier = (index: number, patch: Partial<BudgetChannelTier>) => {
    setDraft((current) => ({ ...current, budgetChannelTiers: current.budgetChannelTiers.map((tier, tierIndex) => tierIndex === index ? { ...tier, ...patch } : tier) }));
    clearErrors();
  };
  const updateProduct = (productId: string, patch: Partial<ProductPlanningSetting>) => {
    setDraft((current) => ({ ...current, products: current.products.map((product) => product.productId === productId ? { ...product, ...patch } : product) }));
    clearErrors();
  };
  const updatePublisher = (publisherId: string, patch: Partial<PublisherPlanningSetting>) => {
    setDraft((current) => ({ ...current, publishers: current.publishers.map((publisher) => publisher.publisherId === publisherId ? { ...publisher, ...patch } : publisher) }));
    clearErrors();
  };
  const updateEnhancement = (enhancementId: string, patch: Partial<EnhancementPlanningSetting>) => {
    setDraft((current) => ({ ...current, enhancements: current.enhancements.map((enhancement) => enhancement.enhancementId === enhancementId ? { ...enhancement, ...patch } : enhancement) }));
    clearErrors();
  };
  const updateOverviewMetric = (metricId: OverviewMetricId, show: boolean) => {
    setDraft((current) => ({ ...current, overviewMetrics: current.overviewMetrics.map((metric) => metric.id === metricId ? { ...metric, show } : metric) }));
    clearErrors();
  };

  const addTier = () => {
    setDraft((current) => {
      const tiers = current.budgetChannelTiers.map((tier) => ({ ...tier }));
      const last = tiers[tiers.length - 1];
      const splitAt = last.maxBudgetExclusive ?? Math.max(last.minBudget + 100_000, last.minBudget * 2);
      if (last.maxBudgetExclusive === null) last.maxBudgetExclusive = splitAt;
      tiers.push({ minBudget: splitAt, maxBudgetExclusive: null, maxChannels: last.maxChannels });
      return { ...current, budgetChannelTiers: tiers };
    });
    clearErrors();
  };

  const deleteTier = (index: number) => {
    setDraft((current) => {
      if (current.budgetChannelTiers.length === 1) return current;
      const tiers = current.budgetChannelTiers.map((tier) => ({ ...tier }));
      const removed = tiers[index];
      tiers.splice(index, 1);
      if (index === 0) tiers[0].minBudget = 0;
      else tiers[index - 1].maxBudgetExclusive = removed.maxBudgetExclusive;
      if (index >= tiers.length) tiers[tiers.length - 1].maxBudgetExclusive = null;
      return { ...current, budgetChannelTiers: tiers };
    });
    clearErrors();
  };

  const handleSave = () => {
    const result = validatePlanningSettings(draft);
    if (!result.valid || !result.settings) {
      setErrors(result.errors);
      return;
    }
    onSave(result.settings);
    onClose();
  };

  const handleCancel = () => {
    setDraft(clonePlanningSettings(settings));
    setErrors([]);
    onClose();
  };

  const normalizedSearch = search.trim().toLowerCase();
  const visiblePublishers = draft.publishers.filter((publisher) => !normalizedSearch || `${publisher.displayName} ${publisher.attachesTo.join(" ")} ${publisher.notes}`.toLowerCase().includes(normalizedSearch));
  const visibleEnhancements = draft.enhancements.filter((enhancement) => !normalizedSearch || `${enhancement.displayName} ${enhancement.attachesTo.join(" ")} ${enhancement.trigger} ${enhancement.formatType}`.toLowerCase().includes(normalizedSearch));

  const tabs: Array<{ id: SettingsTab; label: string; count?: number }> = [
    { id: "overview", label: "Overview", count: draft.overviewMetrics.length },
    { id: "budgets", label: "Budgets" },
    { id: "products", label: "Products", count: draft.products.length },
    { id: "publishers", label: "Publishers", count: draft.publishers.length },
    { id: "enhancements", label: "Enhancements", count: draft.enhancements.length },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex justify-end" role="dialog" aria-modal="true" aria-label="Settings">
      <button className="absolute inset-0 bg-slate-950/30" aria-label="Close settings" onClick={handleCancel} />
      <aside className="relative flex h-full w-full max-w-5xl flex-col bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4 md:px-7">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-indigo-50 p-2 text-indigo-700"><Settings className="h-5 w-5" /></div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Settings</h2>
              <p className="text-xs text-slate-500">Provisional defaults · saved in this browser</p>
            </div>
          </div>
          <button onClick={handleCancel} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close settings"><X className="h-5 w-5" /></button>
        </header>

        <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-4 py-2 md:px-7" aria-label="Settings sections">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => { setActiveTab(tab.id); setSearch(""); }}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-bold ${activeTab === tab.id ? "bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:bg-white"}`}
            >
              {tab.label}{tab.count ? ` (${tab.count})` : ""}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto px-5 py-5 md:px-7">
          {activeTab === "overview" && (
            <section>
              <h3 className="text-base font-bold text-slate-900">Overview metrics</h3>
              <p className="mt-1 mb-5 text-sm leading-6 text-slate-600">Choose which Plan vs. AI Scout metrics appear in the left-column overview. These preferences are saved in this browser.</p>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <table className="w-full border-collapse text-left">
                  <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Metric</th>
                      <th className="w-24 px-4 py-3 text-center">Show</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {draft.overviewMetrics.map((metric) => (
                      <tr key={metric.id}>
                        <td className="px-4 py-3 text-sm font-semibold text-slate-800">{metric.label}</td>
                        <td className="px-4 py-3 text-center"><ShowToggle checked={metric.show} onChange={(show) => updateOverviewMetric(metric.id, show)} label={metric.label} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeTab === "budgets" && (
            <section>
              <h3 className="text-base font-bold text-slate-900">Budget &amp; media-type limits</h3>
              <p className="mt-1 mb-5 text-sm leading-6 text-slate-600">Campaign budgets are normalized to 30 days before these caps are applied. ScoutAI may recommend fewer media types when minimums or allocation bounds make a wider mix infeasible.</p>
              <div className="space-y-3">
                {draft.budgetChannelTiers.map((tier, index) => (
                  <div key={index} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Tier {index + 1}</span>
                      <button type="button" onClick={() => deleteTier(index)} disabled={draft.budgetChannelTiers.length === 1} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30" aria-label={`Delete tier ${index + 1}`}><Trash2 className="h-4 w-4" /></button>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <label className={labelClass}>Minimum 30-day budget<input type="number" min="0" step="0.01" value={Number.isFinite(tier.minBudget) ? tier.minBudget : ""} onChange={(event) => updateTier(index, { minBudget: numericValue(event.target.value) })} className={inputClass} /></label>
                      <label className={labelClass}>Maximum 30-day budget<input type="number" min="0" step="0.01" placeholder="No maximum" value={tier.maxBudgetExclusive === null || !Number.isFinite(tier.maxBudgetExclusive) ? "" : tier.maxBudgetExclusive} onChange={(event) => updateTier(index, { maxBudgetExclusive: nullableNumericValue(event.target.value) })} className={inputClass} /></label>
                      <label className={labelClass}>Max media types<input type="number" min="1" max="50" step="1" value={Number.isFinite(tier.maxChannels) ? tier.maxChannels : ""} onChange={(event) => updateTier(index, { maxChannels: numericValue(event.target.value) })} className={inputClass} /></label>
                    </div>
                    {tier.maxBudgetExclusive === null && <p className="mt-2 text-[11px] font-medium text-indigo-600">Open-ended final tier</p>}
                  </div>
                ))}
              </div>
              <button type="button" onClick={addTier} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-indigo-200 px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50"><Plus className="h-4 w-4" /> Add tier</button>
            </section>
          )}

          {activeTab === "products" && (
            <section>
              <h3 className="text-base font-bold text-slate-900">Digital Remedy product rules</h3>
              <p className="mt-1 mb-5 text-sm leading-6 text-slate-600">These are conservative planning defaults. Only products in the controlled Digital Remedy registry can be recommended. Geography defaults to United States only.</p>
              <div className="space-y-4">
                {draft.products.map((product) => (
                  <article key={product.productId} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div><h4 className="font-bold text-slate-900">{product.displayName}</h4><p className="text-[11px] text-slate-400">{product.productId}</p></div>
                      <div className="flex flex-wrap gap-4 text-xs font-semibold text-slate-600">
                        <label className="flex items-center gap-2"><input type="checkbox" checked={product.digitalRemedyExecutable} onChange={(event) => updateProduct(product.productId, { digitalRemedyExecutable: event.target.checked })} /> DR executable</label>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={product.recommendationEligible} onChange={(event) => updateProduct(product.productId, { recommendationEligible: event.target.checked })} /> Recommend</label>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <label className={labelClass}>Status<select value={product.status} onChange={(event) => updateProduct(product.productId, { status: event.target.value as ProductPlanningSetting["status"] })} className={inputClass}><option value="live">Live</option><option value="beta">Beta</option><option value="future">Future</option><option value="retired">Retired</option></select></label>
                      <label className={`${labelClass} lg:col-span-3`}>Geography coverage<input value={product.supportedGeographies.join(", ")} onChange={(event) => updateProduct(product.productId, { supportedGeographies: listValue(event.target.value) })} className={inputClass} placeholder="United States" /></label>
                      <label className={labelClass}>Typical CPM low<input type="number" min="0" step="0.01" value={product.typicalCpmLow ?? ""} onChange={(event) => updateProduct(product.productId, { typicalCpmLow: nullableNumericValue(event.target.value) })} className={inputClass} placeholder="Varies" /></label>
                      <label className={labelClass}>Typical CPM high<input type="number" min="0" step="0.01" value={product.typicalCpmHigh ?? ""} onChange={(event) => updateProduct(product.productId, { typicalCpmHigh: nullableNumericValue(event.target.value) })} className={inputClass} placeholder="Varies" /></label>
                      <label className={labelClass}>Minimum total spend<input type="number" min="0" step="1" value={product.minimumTotalSpend} onChange={(event) => updateProduct(product.productId, { minimumTotalSpend: numericValue(event.target.value) })} className={inputClass} /></label>
                      <label className={labelClass}>Minimum 30-day spend<input type="number" min="0" step="1" value={product.minimumNormalized30DaySpend} onChange={(event) => updateProduct(product.productId, { minimumNormalized30DaySpend: numericValue(event.target.value) })} className={inputClass} /></label>
                      <label className={labelClass}>Minimum flight days<input type="number" min="1" step="1" value={product.minimumFlightDays} onChange={(event) => updateProduct(product.productId, { minimumFlightDays: numericValue(event.target.value) })} className={inputClass} /></label>
                      <label className={labelClass}>Minimum allocation %<input type="number" min="0" max="100" step="0.1" value={product.minimumAllocationPercent} onChange={(event) => updateProduct(product.productId, { minimumAllocationPercent: numericValue(event.target.value) })} className={inputClass} /></label>
                      <label className={labelClass}>Maximum allocation %<input type="number" min="0" max="100" step="0.1" value={product.maximumAllocationPercent} onChange={(event) => updateProduct(product.productId, { maximumAllocationPercent: numericValue(event.target.value) })} className={inputClass} /></label>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {activeTab === "publishers" && (
            <section>
              <h3 className="text-base font-bold text-slate-900">Publisher tiers</h3>
              <p className="mt-1 text-sm leading-6 text-slate-600">Tier 1 is highest priority. Tier and audience notes deterministically order approved publishers for each selected channel.</p>
              <div className="relative my-4"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm" placeholder="Search publishers, channels, or notes" /></div>
              <div className="space-y-3">
                {visiblePublishers.map((publisher) => (
                  <article key={publisher.publisherId} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-[minmax(140px,1fr)_100px_180px_minmax(240px,2fr)] md:items-end">
                    <div><label className="flex items-center gap-2 text-sm font-bold text-slate-900"><input type="checkbox" checked={publisher.recommendationEligible} onChange={(event) => updatePublisher(publisher.publisherId, { recommendationEligible: event.target.checked })} />{publisher.displayName}</label><p className="mt-1 text-[11px] text-slate-400">{publisher.publisherId}</p></div>
                    <label className={labelClass}>Tier<input type="number" min="1" max="4" step="1" value={publisher.tier} onChange={(event) => updatePublisher(publisher.publisherId, { tier: numericValue(event.target.value) })} className={inputClass} /></label>
                    <label className={labelClass}>Channels<input value={publisher.attachesTo.join(", ")} onChange={(event) => updatePublisher(publisher.publisherId, { attachesTo: listValue(event.target.value) })} className={inputClass} /></label>
                    <label className={labelClass}>Audience / environment notes<input value={publisher.notes} onChange={(event) => updatePublisher(publisher.publisherId, { notes: event.target.value })} className={inputClass} /></label>
                  </article>
                ))}
              </div>
            </section>
          )}

          {activeTab === "enhancements" && (
            <section>
              <h3 className="text-base font-bold text-slate-900">Creative enhancements</h3>
              <p className="mt-1 text-sm leading-6 text-slate-600">Workbook gaps are filled with usable best-guess triggers and format notes. Confirm final vendor specifications before activation.</p>
              <div className="relative my-4"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm" placeholder="Search enhancements, channels, triggers, or formats" /></div>
              <div className="space-y-3">
                {visibleEnhancements.map((enhancement) => (
                  <article key={enhancement.enhancementId} className="rounded-xl border border-slate-200 bg-white p-4">
                    <label className="flex items-center gap-2 text-sm font-bold text-slate-900"><input type="checkbox" checked={enhancement.recommendationEligible} onChange={(event) => updateEnhancement(enhancement.enhancementId, { recommendationEligible: event.target.checked })} />{enhancement.displayName}</label>
                    <p className="mt-1 text-[11px] text-slate-400">{enhancement.enhancementId}</p>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <label className={labelClass}>Attaches to channels<input value={enhancement.attachesTo.join(", ")} onChange={(event) => updateEnhancement(enhancement.enhancementId, { attachesTo: listValue(event.target.value) })} className={inputClass} /></label>
                      <label className={labelClass}>Format type<input value={enhancement.formatType} onChange={(event) => updateEnhancement(enhancement.enhancementId, { formatType: event.target.value })} className={inputClass} /></label>
                      <label className={`${labelClass} md:col-span-2`}>Trigger keywords<input value={enhancement.trigger} onChange={(event) => updateEnhancement(enhancement.enhancementId, { trigger: event.target.value })} className={inputClass} /></label>
                      <label className={`${labelClass} md:col-span-2`}>Specification / vendor notes<textarea value={enhancement.specificationNotes} onChange={(event) => updateEnhancement(enhancement.enhancementId, { specificationNotes: event.target.value })} rows={3} className={inputClass} /></label>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {errors.length > 0 && (
            <div className="sticky bottom-0 mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 shadow-lg">
              <div className="mb-2 flex items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4" /> Fix these settings</div>
              <ul className="max-h-32 list-disc space-y-1 overflow-y-auto pl-5">{errors.map((error) => <li key={error}>{error}</li>)}</ul>
            </div>
          )}
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-7">
          <button type="button" onClick={() => { setDraft(clonePlanningSettings(DEFAULT_PLANNING_SETTINGS)); setErrors([]); }} className="inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"><RotateCcw className="h-4 w-4" /> Reset provisional defaults</button>
          <div className="flex gap-2">
            <button type="button" onClick={handleCancel} className="flex-1 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:flex-none">Cancel</button>
            <button type="button" onClick={handleSave} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 sm:flex-none"><Save className="h-4 w-4" /> Save settings</button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
