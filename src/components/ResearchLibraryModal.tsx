import React from "react";
import { AlertTriangle, CheckCircle2, Database, FileText, Loader2, Pencil, Search, Trash2, Upload, X, XCircle } from "lucide-react";
import * as api from "../api/client";
import {
  FACT_MEASURES,
  FACT_MEASURE_LABELS,
  PARTNER_PROVIDERS,
  RESEARCH_ACCEPT,
  MAX_RESEARCH_FILES,
  isResearchFileType,
  providerById,
  type FactStatus,
  type PartnerProvider,
  type ResearchDataset,
  type ResearchDatasetSummary,
  type ResearchFact,
} from "../research/partnerData";
import { PartnerLogo } from "./PartnerLogo";

// The partner research library: upload GWI, Resonate, MediaRadar, Statista and Census files, then
// approve the figures read from them. Only approved figures reach a plan, and the client sees them
// credited to the partner, so this review is the last check before a partner's name goes on a figure.
// Sales, planning and marketing all use it; the server records who approved what.

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** The brief's advertiser: the default "prepared for" on a new upload. */
  advertiserName: string;
  /** Opens straight onto this dataset. */
  initialDatasetId?: string | null;
  /** Called after any change, so pickers can reload. */
  onChanged: () => void;
}

const STATUS_STYLES: Record<FactStatus, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-slate-100 text-slate-500 border-slate-200",
};

export function ResearchLibraryModal({ isOpen, onClose, advertiserName, initialDatasetId, onChanged }: Props) {
  const [providers, setProviders] = React.useState<PartnerProvider[]>(PARTNER_PROVIDERS);
  const [datasets, setDatasets] = React.useState<ResearchDatasetSummary[] | null>(null);
  const [query, setQuery] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => {
    try {
      setDatasets(await api.listResearchDatasets());
    } catch (err: any) {
      setError(err?.message || "The library could not be loaded.");
      setDatasets([]);
    }
  }, []);

  React.useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setSelectedId(initialDatasetId ?? null);
    void reload();
    api.getPartnerProviders().then((r) => setProviders(r.providers)).catch(() => {});
  }, [isOpen, initialDatasetId, reload]);

  if (!isOpen) return null;

  const q = query.trim().toLowerCase();
  const visible = (datasets || []).filter((d) => !q || `${d.title} ${d.advertiserName} ${d.providerLabel} ${providerById(d.provider).name} ${d.markets.join(" ")} ${d.category}`.toLowerCase().includes(q));

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs font-sans" onClick={onClose}>
      <div className="w-full max-w-[1400px] h-[90vh] flex flex-col bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden text-left" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
              <Database className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Partner research library</h2>
              <p className="text-xs text-slate-500">Upload partner data, approve the figures, and they back the plan with the partner's name on them.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[380px_1fr]">
          <div className="border-r border-slate-100 flex flex-col min-h-0">
            <UploadCard
              providers={providers}
              advertiserName={advertiserName}
              onUploaded={(dataset) => {
                void reload();
                setSelectedId(dataset.id);
                onChanged();
              }}
            />
            <div className="px-4 pt-3 pb-2 border-t border-slate-100">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by partner, advertiser, market…"
                  className="w-full text-xs pl-8 pr-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:border-indigo-500"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-3">
              {datasets === null ? (
                <div className="p-4 flex items-center gap-2 text-xs text-slate-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading the library…</div>
              ) : visible.length === 0 ? (
                <p className="p-4 text-xs text-slate-500">{datasets.length === 0 ? "Nothing in the library yet. Upload a partner's export above." : "Nothing matches that search."}</p>
              ) : (
                visible.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setSelectedId(d.id)}
                    className={`w-full text-left rounded-xl px-3 py-2.5 mb-1 border transition-colors cursor-pointer ${selectedId === d.id ? "border-indigo-200 bg-indigo-50/60" : "border-transparent hover:bg-slate-50"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <PartnerLogo provider={providerById(d.provider, providers)} size="sm" />
                      <span className="text-[10px] text-slate-400">{new Date(d.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div className="mt-1 text-xs font-semibold text-slate-800 line-clamp-2">{d.title}</div>
                    <div className="mt-0.5 text-[10px] text-slate-500">
                      {d.advertiserName ? `For ${d.advertiserName}` : "General research"}
                      {d.markets.length ? ` · ${d.markets.slice(0, 3).join(", ")}${d.markets.length > 3 ? "…" : ""}` : ""}
                    </div>
                    <FactCounts counts={d.factCounts} failed={d.extraction.status === "failed"} />
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto">
            {error && <div className="m-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
            {selectedId ? (
              <DatasetReview
                key={selectedId}
                id={selectedId}
                providers={providers}
                onSaved={() => {
                  void reload();
                  onChanged();
                }}
                onRemoved={() => {
                  setSelectedId(null);
                  void reload();
                  onChanged();
                }}
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-10 text-slate-500">
                <Database className="w-10 h-10 text-slate-300 mb-3" />
                <p className="text-sm font-semibold text-slate-700">Pick an upload to review its figures</p>
                <p className="mt-1 text-xs max-w-md">Each figure is read from the partner's file as it was reported. Approve the ones that are right; only approved figures are used in plans, credited to the partner.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FactCounts({ counts, failed }: { counts: Record<FactStatus, number>; failed?: boolean }) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold">
      {failed && <span className="px-1.5 py-0.5 rounded border bg-rose-50 text-rose-700 border-rose-200">Could not be read</span>}
      {counts.approved > 0 && <span className={`px-1.5 py-0.5 rounded border ${STATUS_STYLES.approved}`}>{counts.approved} approved</span>}
      {counts.pending > 0 && <span className={`px-1.5 py-0.5 rounded border ${STATUS_STYLES.pending}`}>{counts.pending} to review</span>}
      {counts.rejected > 0 && <span className={`px-1.5 py-0.5 rounded border ${STATUS_STYLES.rejected}`}>{counts.rejected} rejected</span>}
    </div>
  );
}

function UploadCard({ providers, advertiserName, onUploaded }: { providers: PartnerProvider[]; advertiserName: string; onUploaded: (d: ResearchDataset) => void }) {
  const [files, setFiles] = React.useState<File[]>([]);
  const [provider, setProvider] = React.useState("auto");
  const [preparedFor, setPreparedFor] = React.useState(advertiserName);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);

  const add = (list: FileList | null) => {
    if (!list) return;
    const picked = Array.from(list);
    const unsupported = picked.filter((f) => !isResearchFileType(f.name));
    const next = [...files, ...picked.filter((f) => isResearchFileType(f.name) && !files.some((g) => g.name === f.name && g.size === f.size))].slice(0, MAX_RESEARCH_FILES);
    setFiles(next);
    setMessage(unsupported.length ? { tone: "error", text: `Not a supported type: ${unsupported.map((f) => f.name).join(", ")}` } : null);
  };

  const upload = async () => {
    if (files.length === 0 || busy) return;
    setBusy(true);
    setMessage({ tone: "info", text: "Storing the files…" });
    try {
      const { dataset, duplicates } = await api.uploadResearch(files, { provider, advertiserName: preparedFor.trim() }, (event) => {
        if (event?.status === "reading") setMessage({ tone: "info", text: `Reading ${event.files} file${event.files === 1 ? "" : "s"}: charts, tables and write-ups. This takes a minute or two…` });
      });
      setFiles([]);
      setMessage(
        dataset.extraction.status === "failed"
          ? { tone: "error", text: `The files are saved, but could not be read (${dataset.extraction.error || "unknown error"}).` }
          : { tone: "info", text: `Read ${dataset.facts.length} figure${dataset.facts.length === 1 ? "" : "s"}. Review them on the right.${duplicates.length ? ` Skipped: ${duplicates.join("; ")}.` : ""}` },
      );
      onUploaded(dataset);
    } catch (err: any) {
      setMessage({ tone: "error", text: err?.message || "The upload failed." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 space-y-2.5">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); add(e.dataTransfer.files); }}
        onClick={() => input.current?.click()}
        className={`rounded-xl border-2 border-dashed px-3 py-4 text-center cursor-pointer transition-colors ${dragging ? "border-indigo-400 bg-indigo-50" : "border-slate-200 hover:border-indigo-300 hover:bg-slate-50"}`}
      >
        <Upload className="w-5 h-5 mx-auto text-indigo-500" />
        <p className="mt-1 text-xs font-semibold text-slate-700">Drop partner files here, or click to choose</p>
        <p className="text-[10px] text-slate-400">PDF, Word, Excel, CSV or a chart image · up to {MAX_RESEARCH_FILES} files read together</p>
        <input ref={input} type="file" multiple accept={RESEARCH_ACCEPT} className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      </div>
      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((f) => (
            <li key={`${f.name}-${f.size}`} className="flex items-center justify-between gap-2 text-[11px] text-slate-700 bg-slate-50 rounded-md px-2 py-1">
              <span className="flex items-center gap-1.5 min-w-0"><FileText className="w-3 h-3 text-slate-400 shrink-0" /><span className="truncate">{f.name}</span></span>
              <button type="button" onClick={() => setFiles(files.filter((g) => g !== f))} className="text-slate-400 hover:text-rose-600 cursor-pointer" aria-label={`Remove ${f.name}`}><X className="w-3 h-3" /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
          Partner
          <select value={provider} onChange={(e) => setProvider(e.target.value)} className="mt-1 w-full text-xs normal-case tracking-normal font-normal px-2 py-1.5 border border-slate-200 rounded-lg bg-white">
            <option value="auto">Detect from files</option>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
          Prepared for
          <input value={preparedFor} onChange={(e) => setPreparedFor(e.target.value)} placeholder="Advertiser (optional)" className="mt-1 w-full text-xs normal-case tracking-normal font-normal px-2 py-1.5 border border-slate-200 rounded-lg" />
        </label>
      </div>
      <button
        type="button"
        onClick={upload}
        disabled={files.length === 0 || busy}
        className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 rounded-lg px-3 py-2 cursor-pointer disabled:cursor-not-allowed"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
        {busy ? "Reading…" : `Upload and read ${files.length || ""} file${files.length === 1 ? "" : "s"}`.replace("  ", " ")}
      </button>
      {message && <p className={`text-[11px] leading-snug ${message.tone === "error" ? "text-rose-600" : "text-slate-500"}`}>{message.text}</p>}
    </div>
  );
}

type Filter = "all" | FactStatus;

function DatasetReview({ id, providers, onSaved, onRemoved }: { id: string; providers: PartnerProvider[]; onSaved: () => void; onRemoved: () => void }) {
  const [saved, setSaved] = React.useState<ResearchDataset | null>(null);
  const [draft, setDraft] = React.useState<ResearchDataset | null>(null);
  const [filter, setFilter] = React.useState<Filter>("all");
  const [editing, setEditing] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const d = await api.getResearchDataset(id);
      setSaved(d);
      setDraft(d);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "This research could not be loaded.");
    }
  }, [id]);

  React.useEffect(() => { void load(); }, [load]);

  if (error && !draft) return <div className="m-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>;
  if (!draft || !saved) return <div className="p-6 flex items-center gap-2 text-xs text-slate-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</div>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (patch: Partial<ResearchDataset>) => setDraft({ ...draft, ...patch });
  const setFact = (factId: string, patch: Partial<ResearchFact>) => setDraft({ ...draft, facts: draft.facts.map((f) => (f.id === factId ? { ...f, ...patch } : f)) });
  const counts = { all: draft.facts.length, pending: 0, approved: 0, rejected: 0 } as Record<Filter, number>;
  for (const f of draft.facts) counts[f.status]++;
  const shown = draft.facts.filter((f) => filter === "all" || f.status === filter);

  const save = async () => {
    setBusy(true);
    try {
      const next = await api.updateResearchDataset(draft.id, saved.revision, {
        title: draft.title, provider: draft.provider, providerLabel: draft.providerLabel, advertiserName: draft.advertiserName,
        category: draft.category, markets: draft.markets, period: draft.period, description: draft.description, notes: draft.notes, facts: draft.facts,
      });
      setSaved(next);
      setDraft(next);
      setEditing(null);
      setError(null);
      onSaved();
    } catch (err: any) {
      setError(err?.status === 409 ? "Someone else changed this research while you were reviewing. Reload it to see their changes (yours will be lost)." : err?.message || "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Remove "${draft.title}" from the library? Plans already built with it keep their figures.`)) return;
    setBusy(true);
    try {
      await api.archiveResearchDataset(draft.id);
      onRemoved();
    } catch (err: any) {
      setError(err?.message || "Could not remove it.");
      setBusy(false);
    }
  };

  const field = "mt-1 w-full text-xs px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-hidden focus:border-indigo-500";
  const labelCls = "text-[10px] font-semibold text-slate-500 uppercase tracking-wider";

  return (
    <div className="flex flex-col min-h-full">
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-100 px-5 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <PartnerLogo provider={providerById(draft.provider, providers)} />
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-900 truncate">{draft.title}</div>
            <div className="text-[11px] text-slate-500">Uploaded by {draft.createdBy} · {new Date(draft.createdAt).toLocaleDateString()}{draft.updatedBy !== draft.createdBy ? ` · last reviewed by ${draft.updatedBy}` : ""}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={remove} disabled={busy} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-rose-600 px-2 py-1.5 rounded-lg cursor-pointer"><Trash2 className="w-3.5 h-3.5" /> Remove</button>
          {dirty && <button type="button" onClick={() => setDraft(saved)} disabled={busy} className="text-xs font-semibold text-slate-600 hover:bg-slate-100 px-3 py-1.5 rounded-lg cursor-pointer">Discard</button>}
          <button type="button" onClick={save} disabled={!dirty || busy} className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 px-3 py-1.5 rounded-lg cursor-pointer disabled:cursor-not-allowed">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save review
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-5 mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 flex items-center justify-between gap-2">
          <span>{error}</span>
          <button type="button" onClick={load} className="font-bold underline cursor-pointer">Reload</button>
        </div>
      )}
      {draft.extraction.status === "failed" && (
        <div className="mx-5 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>The files are saved but could not be read ({draft.extraction.error || "unknown error"}). Remove this upload and try again, or upload the original export instead of a scan.</span>
        </div>
      )}

      <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-3 gap-3 border-b border-slate-100">
        <label className={labelCls}>Partner
          <select value={draft.provider} onChange={(e) => set({ provider: e.target.value as ResearchDataset["provider"] })} className={`${field} bg-white normal-case tracking-normal font-normal`}>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className={labelCls}>Credit on the plan
          <input value={draft.providerLabel} onChange={(e) => set({ providerLabel: e.target.value })} placeholder={providerById(draft.provider, providers).name} className={`${field} normal-case tracking-normal font-normal`} />
        </label>
        <label className={labelCls}>Prepared for
          <input value={draft.advertiserName} onChange={(e) => set({ advertiserName: e.target.value })} placeholder="General research" className={`${field} normal-case tracking-normal font-normal`} />
        </label>
        <label className={labelCls}>Internal title
          <input value={draft.title} onChange={(e) => set({ title: e.target.value })} className={`${field} normal-case tracking-normal font-normal`} />
        </label>
        <label className={labelCls}>Markets
          <input value={draft.markets.join(", ")} onChange={(e) => set({ markets: e.target.value.split(",").map((m) => m.trim()).filter(Boolean) })} className={`${field} normal-case tracking-normal font-normal`} />
        </label>
        <label className={labelCls}>Period
          <input value={draft.period} onChange={(e) => set({ period: e.target.value })} className={`${field} normal-case tracking-normal font-normal`} />
        </label>
        <label className={`${labelCls} md:col-span-3`}>What it measures (shown to clients, never names whom it was prepared for)
          <input value={draft.description} onChange={(e) => set({ description: e.target.value })} className={`${field} normal-case tracking-normal font-normal`} />
        </label>
        <label className={`${labelCls} md:col-span-3`}>Reviewer notes (internal only)
          <textarea value={draft.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} rows={2} placeholder="Caveats about the data: pages that could not be read, totals that disagree…" className={`${field} normal-case tracking-normal font-normal bg-amber-50/40`} />
        </label>
        <div className="md:col-span-3 flex flex-wrap items-center gap-1.5">
          {draft.files.map((f) => (
            <button key={f.id} type="button" onClick={() => api.openResearchFile(draft.id, f.id).catch((err) => setError(err?.message))} className="inline-flex items-center gap-1 text-[11px] text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 rounded-md px-2 py-1 cursor-pointer">
              <FileText className="w-3 h-3" /> {f.fileName}{f.role === "summary" ? " (write-up)" : ""}
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 py-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {(["all", "pending", "approved", "rejected"] as Filter[]).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg cursor-pointer ${filter === f ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
              {f === "all" ? "All" : f === "pending" ? "To review" : f[0].toUpperCase() + f.slice(1)} ({counts[f]})
            </button>
          ))}
        </div>
        {counts.pending > 0 && (
          <button type="button" onClick={() => setDraft({ ...draft, facts: draft.facts.map((f) => (f.status === "pending" ? { ...f, status: "approved" } : f)) })} className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg cursor-pointer">
            <CheckCircle2 className="w-3.5 h-3.5" /> Approve all {counts.pending} to review
          </button>
        )}
      </div>

      <ul className="px-5 pb-6 space-y-2">
        {shown.length === 0 && <li className="text-xs text-slate-500 py-6 text-center">No figures here.</li>}
        {shown.map((fact) => (
          <li key={fact.id} className={`rounded-xl border px-3 py-2.5 ${fact.status === "rejected" ? "border-slate-100 bg-slate-50/60 opacity-70" : "border-slate-200 bg-white"}`}>
            {editing === fact.id ? (
              <div className="space-y-2">
                <textarea value={fact.statement} onChange={(e) => setFact(fact.id, { statement: e.target.value })} rows={2} className={field} />
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  <input value={fact.figure} onChange={(e) => setFact(fact.id, { figure: e.target.value })} placeholder="Figure" className={field} />
                  <select value={fact.measure} onChange={(e) => setFact(fact.id, { measure: e.target.value as ResearchFact["measure"] })} className={`${field} bg-white`}>
                    {FACT_MEASURES.map((m) => <option key={m} value={m}>{FACT_MEASURE_LABELS[m]}</option>)}
                  </select>
                  <input value={fact.population} onChange={(e) => setFact(fact.id, { population: e.target.value })} placeholder="Population" className={field} />
                  <input value={fact.geography} onChange={(e) => setFact(fact.id, { geography: e.target.value })} placeholder="Geography" className={field} />
                  <input value={fact.period} onChange={(e) => setFact(fact.id, { period: e.target.value })} placeholder="Period" className={field} />
                </div>
                <button type="button" onClick={() => setEditing(null)} className="text-[11px] font-bold text-indigo-700 cursor-pointer">Done editing</button>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-slate-800 leading-snug">{fact.statement}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
                    {fact.figure && <span className="font-mono font-bold text-slate-700">{fact.figure}</span>}
                    <span className="px-1.5 py-0.5 rounded bg-slate-100">{FACT_MEASURE_LABELS[fact.measure]}</span>
                    {fact.population && <span>· {fact.population}</span>}
                    {fact.geography && <span>· {fact.geography}</span>}
                    {fact.period && <span>· {fact.period}</span>}
                    {fact.location && <span className="text-slate-400">· {fact.fileName} {fact.location}</span>}
                    {fact.fromSummary && <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-100" title="Read from a written summary of the data, not the partner's export. Check it against the source if you can.">From a write-up</span>}
                    {fact.edited && <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">Edited</span>}
                    {fact.reviewedBy && <span className="text-slate-400">· {fact.status} by {fact.reviewedBy}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" onClick={() => setEditing(fact.id)} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 cursor-pointer" aria-label="Edit figure"><Pencil className="w-3.5 h-3.5" /></button>
                  <button type="button" onClick={() => setFact(fact.id, { status: fact.status === "approved" ? "pending" : "approved" })} className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg border cursor-pointer ${fact.status === "approved" ? STATUS_STYLES.approved : "border-slate-200 text-slate-600 hover:bg-emerald-50 hover:text-emerald-700"}`}>
                    <CheckCircle2 className="w-3.5 h-3.5" /> {fact.status === "approved" ? "Approved" : "Approve"}
                  </button>
                  <button type="button" onClick={() => setFact(fact.id, { status: fact.status === "rejected" ? "pending" : "rejected" })} className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg border cursor-pointer ${fact.status === "rejected" ? STATUS_STYLES.rejected : "border-slate-200 text-slate-600 hover:bg-rose-50 hover:text-rose-700"}`}>
                    <XCircle className="w-3.5 h-3.5" /> {fact.status === "rejected" ? "Rejected" : "Reject"}
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
