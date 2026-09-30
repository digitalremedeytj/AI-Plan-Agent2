import React from "react";
import { createPortal } from "react-dom";
import { AlertCircle, AlertTriangle, BarChart3, FileSpreadsheet, Info, Link2, Loader2, Trash2, Unlink, Upload, X } from "lucide-react";
import * as api from "../api/client";
import type { CampaignAnalysis, CampaignDetailsInput, PerformanceCampaignSummary, PerformanceCampaignView, PreparedFile } from "../api/client";
import { prepareFiles } from "../performance/browserFiles";
import { CAMPAIGN_GOALS, CONVERSION_EVENTS } from "../performance/constants";

// The advertiser's library of past campaigns, opened from the plan. A planner uploads a
// campaign's report set, checks what was read (the flight, the conversion event, which files are
// reference, the data notes) and saves it linked to this plan. Nothing is analysed by AI here:
// this is the reconciled data ScoutAI will read.

interface Props {
  isOpen: boolean;
  onClose: () => void;
  planId: string;
  /** The plan's advertiser: the library shown, and the default for new campaigns. */
  advertiserName: string;
  onChanged: () => void;
}

type View = { mode: "list" } | { mode: "upload"; campaign?: PerformanceCampaignView } | { mode: "campaign"; id: string };

const money = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : `$${Math.round(v).toLocaleString("en-US")}`);
const count = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : Math.round(v).toLocaleString("en-US"));
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const flightText = (start: string | null, end: string | null) => (start && end ? `${start} to ${end}` : "Flight not set");

export function PastPerformanceModal({ isOpen, onClose, planId, advertiserName, onChanged }: Props) {
  const [view, setView] = React.useState<View>({ mode: "list" });
  React.useEffect(() => {
    if (isOpen) setView({ mode: "list" });
  }, [isOpen]);
  if (!isOpen) return null;

  // Opened from inside the left column, whose stacking context would put the plan above it.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs font-sans" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden text-left" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
              <BarChart3 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800">Past campaign performance</h3>
              <p className="text-[11px] text-slate-400">Reports from earlier flights, for ScoutAI to learn from{advertiserName ? ` · ${advertiserName}` : ""}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          {view.mode === "list" && <Library planId={planId} advertiserName={advertiserName} onOpen={(id) => setView({ mode: "campaign", id })} onUpload={() => setView({ mode: "upload" })} onChanged={onChanged} />}
          {view.mode === "upload" && (
            <UploadStep
              planId={planId}
              advertiserName={advertiserName}
              campaign={view.campaign}
              onCancel={() => setView(view.campaign ? { mode: "campaign", id: view.campaign.id } : { mode: "list" })}
              onSaved={(id) => {
                onChanged();
                setView({ mode: "campaign", id });
              }}
            />
          )}
          {view.mode === "campaign" && (
            <CampaignStep
              id={view.id}
              planId={planId}
              onBack={() => setView({ mode: "list" })}
              onAddFiles={(campaign) => setView({ mode: "upload", campaign })}
              onChanged={onChanged}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Library({ planId, advertiserName, onOpen, onUpload, onChanged }: { planId: string; advertiserName: string; onOpen: (id: string) => void; onUpload: () => void; onChanged: () => void }) {
  const [campaigns, setCampaigns] = React.useState<PerformanceCampaignSummary[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const [linked, library] = await Promise.all([
        api.listPerformanceCampaigns({ planId }),
        advertiserName.trim() ? api.listPerformanceCampaigns({ advertiser: advertiserName }) : Promise.resolve([]),
      ]);
      const byId = new Map([...linked, ...library].map((c) => [c.id, c]));
      setCampaigns([...byId.values()]);
    } catch (err: any) {
      setError(err?.message || "Could not load the library.");
    }
  }, [planId, advertiserName]);
  React.useEffect(() => {
    load();
  }, [load]);

  const toggleLink = async (c: PerformanceCampaignSummary, link: boolean) => {
    setBusy(c.id);
    setError(null);
    try {
      await api.updatePerformanceCampaign(c.id, c.revision, link ? { linkPlanIds: [planId] } : { unlinkPlanIds: [planId] });
      await load();
      onChanged();
    } catch (err: any) {
      setError(err?.message || "Could not update the campaign.");
    } finally {
      setBusy(null);
    }
  };

  const linked = (campaigns || []).filter((c) => c.linkedPlanIds.includes(planId));
  const others = (campaigns || []).filter((c) => !c.linkedPlanIds.includes(planId));

  return (
    <div className="p-6 space-y-5">
      {error && <ErrorBox text={error} />}
      <div className="flex items-start justify-between gap-4">
        <p className="text-xs leading-relaxed text-slate-500 max-w-lg">
          Upload the report exports from a campaign that has already run: the media type, publisher, audience, ad group, creative and daily reports, and all-touch or last-touch conversion exports. ScoutAI reads what is linked to this plan.
        </p>
        <button onClick={onUpload} className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 cursor-pointer">
          <Upload className="w-3.5 h-3.5" /> Add a campaign
        </button>
      </div>
      {campaigns === null ? (
        <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</div>
      ) : (
        <>
          <Section title="Linked to this plan" empty="No past campaigns are linked yet.">
            {linked.map((c) => (
              <CampaignRow key={c.id} campaign={c} onOpen={() => onOpen(c.id)} action={
                <button disabled={busy === c.id} onClick={() => toggleLink(c, false)} className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 cursor-pointer disabled:opacity-50">
                  <Unlink className="w-3 h-3" /> Unlink
                </button>
              } />
            ))}
          </Section>
          {others.length > 0 && (
            <Section title={`Other campaigns for ${advertiserName}`} empty="">
              {others.map((c) => (
                <CampaignRow key={c.id} campaign={c} onOpen={() => onOpen(c.id)} action={
                  <button disabled={busy === c.id} onClick={() => toggleLink(c, true)} className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold text-indigo-700 hover:bg-indigo-50 cursor-pointer disabled:opacity-50">
                    <Link2 className="w-3 h-3" /> Link to this plan
                  </button>
                } />
              ))}
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const items = React.Children.toArray(children);
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">{title}</div>
      {items.length ? <div className="space-y-2">{items}</div> : <p className="text-xs text-slate-400">{empty}</p>}
    </div>
  );
}

function CampaignRow({ campaign: c, onOpen, action }: { campaign: PerformanceCampaignSummary; onOpen: () => void; action: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 hover:border-indigo-200 transition-colors">
      <button onClick={onOpen} className="flex-1 min-w-0 text-left cursor-pointer">
        <div className="text-xs font-bold text-slate-800 truncate">{c.name}</div>
        <div className="text-[11px] text-slate-500 truncate">
          {flightText(c.flightStart, c.flightEnd)} · {c.fileCount} file{c.fileCount === 1 ? "" : "s"}{c.conversionLabel ? ` · ${c.conversionLabel}` : ""} · added by {c.createdBy}
        </div>
      </button>
      {action}
    </div>
  );
}

// --- upload ------------------------------------------------------------------

function UploadStep({ planId, advertiserName, campaign, onCancel, onSaved }: { planId: string; advertiserName: string; campaign?: PerformanceCampaignView; onCancel: () => void; onSaved: (id: string) => void }) {
  const [files, setFiles] = React.useState<PreparedFile[]>([]);
  const [progress, setProgress] = React.useState<{ fileName: string; fraction: number } | null>(null);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [details, setDetails] = React.useState<CampaignDetailsInput>(() => (campaign ? {} : { advertiserName }));
  const [touched, setTouched] = React.useState<Set<keyof CampaignDetailsInput>>(new Set());
  const [preview, setPreview] = React.useState<api.PerformancePreview | null>(null);
  const [previewing, setPreviewing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const addFiles = async (list: FileList | File[]) => {
    const picked = Array.from(list);
    if (!picked.length) return;
    setError(null);
    const result = await prepareFiles(picked, (fileName, fraction) => setProgress(fraction >= 1 ? null : { fileName, fraction }));
    setProgress(null);
    setErrors((prev) => [...prev, ...result.errors]);
    setFiles((prev) => [...prev.filter((f) => !result.files.some((n) => n.fileName === f.fileName)), ...result.files]);
  };

  // Re-read on every change, so the flight and conversion event the planner sets are what the
  // preview shows. Suggestions fill only the fields the planner has not touched.
  React.useEffect(() => {
    if (!files.length) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setPreviewing(true);
      try {
        const result = await api.previewPerformanceFiles({ files, campaignId: campaign?.id, details });
        if (cancelled) return;
        setPreview(result);
        setDetails((prev) => {
          const next = { ...prev };
          for (const [key, value] of Object.entries(result.suggested) as Array<[keyof CampaignDetailsInput, string]>) {
            if (!touched.has(key) && !next[key] && !campaign) next[key] = value;
          }
          return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;
        });
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Could not read the reports.");
      } finally {
        if (!cancelled) setPreviewing(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, details]);

  const edit = (key: keyof CampaignDetailsInput, value: string) => {
    setTouched((prev) => new Set(prev).add(key));
    setDetails((prev) => ({ ...prev, [key]: value }));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = campaign
        ? await api.updatePerformanceCampaign(campaign.id, campaign.revision, { addFiles: files, details })
        : await api.createPerformanceCampaign({ files, details, planId });
      onSaved(response.campaign.id);
    } catch (err: any) {
      setError(err?.message || "Could not save the campaign.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-5">
      {error && <ErrorBox text={error} />}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          addFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className="rounded-xl border-2 border-dashed border-slate-200 hover:border-indigo-300 bg-slate-50/50 px-4 py-6 text-center cursor-pointer transition-colors"
      >
        <input ref={inputRef} type="file" multiple accept=".csv,.txt,.tsv,.xlsx,.xls" className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
        <FileSpreadsheet className="w-6 h-6 text-indigo-400 mx-auto mb-1.5" />
        <p className="text-xs font-bold text-slate-700">{campaign ? `Add reports to ${campaign.name}` : "Drop a campaign's report exports here"}</p>
        <p className="text-[11px] text-slate-400 mt-0.5">CSV or Excel, several at once. All-touch and last-touch exports are summarised in your browser; their rows are never uploaded.</p>
        {progress && (
          <div className="mt-3 mx-auto max-w-xs">
            <div className="text-[10px] text-slate-500 truncate mb-1">Summarising {progress.fileName}…</div>
            <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.round(progress.fraction * 100)}%` }} /></div>
          </div>
        )}
      </div>
      {errors.map((e, i) => <ErrorBox key={i} text={e} />)}

      {files.length > 0 && (
        <>
          {!campaign && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Advertiser" required>
                <input value={details.advertiserName || ""} onChange={(e) => edit("advertiserName", e.target.value)} className={inputClass} />
              </Field>
              <Field label="Campaign name">
                <input value={details.name || ""} placeholder="Named after the flight if left blank" onChange={(e) => edit("name", e.target.value)} className={inputClass} />
              </Field>
              <DetailFields details={details} edit={edit} />
            </div>
          )}
          {preview?.advertiserMismatch && (
            <Notice tone="caution" text={`These files are for ${preview.advertiserMismatch}, not ${details.advertiserName || campaign?.advertiserName}. They can inform this plan, but will not appear in anything client-facing unless the advertisers match.`} />
          )}
          {preview?.duplicates.length ? <Notice tone="info" text={`Already in this campaign, skipped: ${preview.duplicates.join(", ")}.`} /> : null}
          {preview ? <AnalysisView analysis={preview.analysis} removable={files.map((f) => f.fileName)} onRemove={(name) => setFiles((prev) => prev.filter((f) => f.fileName !== name))} /> : <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading the reports…</div>}
        </>
      )}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
        <button onClick={onCancel} className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-50 cursor-pointer">Cancel</button>
        <button
          onClick={save}
          disabled={!files.length || saving || previewing || Boolean(progress) || (!campaign && !details.advertiserName?.trim())}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {campaign ? "Add to campaign" : "Save and link to this plan"}
        </button>
      </div>
    </div>
  );
}

const inputClass = "w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100";

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-bold text-slate-700 mb-1">{label}{required && <span className="text-rose-500"> *</span>}</span>
      {children}
      {hint && <span className="block mt-1 text-[10px] leading-snug text-slate-400">{hint}</span>}
    </label>
  );
}

/** The fields the exports cannot answer. They are the planner's to confirm. */
function DetailFields({ details, edit }: { details: CampaignDetailsInput; edit: (key: keyof CampaignDetailsInput, value: string) => void }) {
  return (
    <>
      <Field label="Flight start" hint="Files outside the flight are kept as reference.">
        <input type="date" value={details.flightStart || ""} onChange={(e) => edit("flightStart", e.target.value)} className={inputClass} />
      </Field>
      <Field label="Flight end">
        <input type="date" value={details.flightEnd || ""} onChange={(e) => edit("flightEnd", e.target.value)} className={inputClass} />
      </Field>
      <Field label="Conversion event" hint="The exports call every pixel conversion Visits. What was it?">
        <input list="conversion-events" value={details.conversionLabel || ""} placeholder="e.g. Checkouts" onChange={(e) => edit("conversionLabel", e.target.value)} className={inputClass} />
        <datalist id="conversion-events">{CONVERSION_EVENTS.map((e) => <option key={e} value={e} />)}</datalist>
      </Field>
      <Field label="What it optimised for" hint="Decides what counts as performing well.">
        <select value={details.campaignGoal || ""} onChange={(e) => edit("campaignGoal", e.target.value)} className={inputClass}>
          <option value="">Not set</option>
          {CAMPAIGN_GOALS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
        </select>
      </Field>
    </>
  );
}

// --- one campaign ----------------------------------------------------------------

function CampaignStep({ id, planId, onBack, onAddFiles, onChanged }: { id: string; planId: string; onBack: () => void; onAddFiles: (c: PerformanceCampaignView) => void; onChanged: () => void }) {
  const [data, setData] = React.useState<api.CampaignResponse | null>(null);
  const [details, setDetails] = React.useState<CampaignDetailsInput>({});
  const [dirty, setDirty] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const apply = (response: api.CampaignResponse) => {
    setData(response);
    const c = response.campaign;
    setDetails({ advertiserName: c.advertiserName, name: c.name, flightStart: c.flightStart, flightEnd: c.flightEnd, conversionLabel: c.conversionLabel, campaignGoal: c.campaignGoal });
    setDirty(false);
  };
  React.useEffect(() => {
    api.getPerformanceCampaign(id).then(apply).catch((err) => setError(err?.message || "Could not load the campaign."));
  }, [id]);

  const run = async (action: () => Promise<api.CampaignResponse | void>) => {
    setBusy(true);
    setError(null);
    try {
      const response = await action();
      if (response) apply(response);
      onChanged();
    } catch (err: any) {
      setError(err instanceof api.ApiError && err.isConflict ? "Someone else changed this campaign. Close and reopen it to see their change." : err?.message || "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <div className="p-6">{error ? <ErrorBox text={error} /> : <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</div>}</div>;
  const c = data.campaign;
  const edit = (key: keyof CampaignDetailsInput, value: string) => {
    setDetails((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };
  const isLinked = c.linkedPlanIds.includes(planId);

  return (
    <div className="p-6 space-y-5">
      {error && <ErrorBox text={error} />}
      <div className="flex items-center justify-between gap-3">
        <button onClick={onBack} className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 cursor-pointer">← Library</button>
        <div className="flex items-center gap-1.5">
          <button disabled={busy} onClick={() => run(() => api.updatePerformanceCampaign(c.id, c.revision, isLinked ? { unlinkPlanIds: [planId] } : { linkPlanIds: [planId] }))} className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer disabled:opacity-50">
            {isLinked ? <><Unlink className="w-3 h-3" /> Unlink from this plan</> : <><Link2 className="w-3 h-3" /> Link to this plan</>}
          </button>
          <button disabled={busy} onClick={() => onAddFiles(c)} className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-bold text-indigo-700 hover:bg-indigo-50 cursor-pointer disabled:opacity-50">
            <Upload className="w-3 h-3" /> Add reports
          </button>
          <button
            disabled={busy}
            onClick={() => {
              if (!window.confirm(`Archive ${c.name}? It is removed from the library for every plan; the reports are kept and can be restored.`)) return;
              run(async () => {
                await api.archivePerformanceCampaign(c.id);
                onBack();
              });
            }}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold text-rose-600 hover:bg-rose-50 cursor-pointer disabled:opacity-50"
          >
            <Trash2 className="w-3 h-3" /> Archive
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Advertiser" required><input value={details.advertiserName || ""} onChange={(e) => edit("advertiserName", e.target.value)} className={inputClass} /></Field>
        <Field label="Campaign name"><input value={details.name || ""} onChange={(e) => edit("name", e.target.value)} className={inputClass} /></Field>
        <DetailFields details={details} edit={edit} />
      </div>
      {dirty && (
        <div className="flex justify-end">
          <button disabled={busy} onClick={() => run(() => api.updatePerformanceCampaign(c.id, c.revision, { details }))} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 cursor-pointer disabled:opacity-50">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save details
          </button>
        </div>
      )}
      {data.advertiserMismatch && <Notice tone="caution" text={`These files are for ${data.advertiserMismatch}, not ${c.advertiserName}. They will not appear in anything client-facing unless the advertisers match.`} />}
      <AnalysisView
        analysis={data.analysis}
        removable={c.files.length > 1 ? c.files.map((f) => f.fileName) : []}
        onRemove={(fileName) => {
          const file = c.files.find((f) => f.fileName === fileName);
          if (file && window.confirm(`Remove ${fileName} from this campaign?`)) run(() => api.updatePerformanceCampaign(c.id, c.revision, { removeFileIds: [file.id] }));
        }}
      />
    </div>
  );
}

// --- what was read -----------------------------------------------------------------

const KIND_LABEL: Record<string, string> = { breakdown: "Breakdown", summary: "Summary", series: "Daily", touches: "Touch-level", unread: "Not read" };
const ROLE_STYLE: Record<string, string> = {
  campaign: "bg-emerald-50 text-emerald-700 border-emerald-100",
  reference: "bg-slate-100 text-slate-600 border-slate-200",
  undated: "bg-amber-50 text-amber-700 border-amber-100",
};
const ROLE_LABEL: Record<string, string> = { campaign: "In flight", reference: "Reference", undated: "No dates" };

function describeFile(analysis: CampaignAnalysis, fileName: string, kind: string, reportType?: string): string {
  const breakdown = analysis.breakdowns.find((b) => b.fileName === fileName);
  if (breakdown) return `By ${breakdown.dimension.toLowerCase()} · ${breakdown.rows.length} rows`;
  const touch = analysis.touches.find((t) => t.fileName === fileName);
  if (touch) return `${touch.summary.attribution === "all-touch" ? "All-touch" : "Last-touch"} · ${count(touch.summary.conversions)} conversions, ${count(touch.summary.rows)} rows`;
  const series = analysis.series.find((s) => s.fileName === fileName);
  if (series) return `${series.days} days${series.cumulative ? " · running total" : ""}`;
  if (analysis.pacing.some((p) => p.fileName === fileName)) return "Insertion order pacing";
  return reportType || KIND_LABEL[kind] || kind;
}

function AnalysisView({ analysis, removable, onRemove }: { analysis: CampaignAnalysis; removable: string[]; onRemove: (fileName: string) => void }) {
  const t = analysis.totals;
  const label = analysis.conversionLabel.label;
  const notes = [...analysis.warnings].sort((a, b) => ["problem", "caution", "info"].indexOf(a.severity) - ["problem", "caution", "info"].indexOf(b.severity));
  return (
    <div className="space-y-4">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">What was read</div>
        {t ? (
          <div className="grid grid-cols-4 gap-2">
            <Stat label="Spend" value={money(t.spend)} />
            <Stat label={label} value={count(t.conversions)} />
            <Stat label="CPA" value={t.cpa !== null ? `$${t.cpa.toFixed(2)}` : "n/a"} />
            <Stat label="ROAS" value={t.roas !== null && (t.revenue ?? 0) > 0 ? `${t.roas.toFixed(2)}x` : "n/a"} />
          </div>
        ) : (
          <p className="text-xs text-slate-500">No file in the flight has spend and conversions yet.</p>
        )}
        <p className="mt-2 text-[11px] text-slate-500">
          {analysis.flight ? `Flight ${day(analysis.flight.start)} to ${day(analysis.flight.end)}.` : "No flight dates found."} Conversion event: {label}
          {analysis.conversionLabel.source === "default" ? " (the exports don't say; set it above)" : analysis.conversionLabel.source === "summary" ? " (from the conversions summary)" : ""}.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
        {analysis.files.map((f) => (
          <div key={f.fileName} className="flex items-center gap-3 px-3 py-2">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold text-slate-800 truncate" title={f.fileName}>{f.reportType || f.fileName}</div>
              <div className="text-[10px] text-slate-500 truncate">{describeFile(analysis, f.fileName, f.kind, f.reportType)}{f.window ? ` · ${day(f.window.start)} to ${day(f.window.end)}` : ""}</div>
            </div>
            <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border ${f.kind === "unread" ? "bg-rose-50 text-rose-700 border-rose-100" : ROLE_STYLE[f.role]}`}>
              {f.kind === "unread" ? "Not read" : ROLE_LABEL[f.role]}
            </span>
            {removable.includes(f.fileName) && (
              <button onClick={() => onRemove(f.fileName)} title="Remove" className="shrink-0 text-slate-300 hover:text-rose-600 cursor-pointer"><X className="w-3.5 h-3.5" /></button>
            )}
          </div>
        ))}
      </div>

      {notes.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">Data notes ScoutAI will read first</div>
          <ul className="space-y-1.5">
            {notes.map((w, i) => <li key={i}><Notice tone={w.severity} text={w.message} /></li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 border border-slate-100 px-2.5 py-2">
      <div className="text-[10px] text-slate-500 truncate">{label}</div>
      <div className="text-sm font-bold text-slate-800">{value}</div>
    </div>
  );
}

function Notice({ tone, text }: { tone: "problem" | "caution" | "info"; text: string }) {
  const style = tone === "problem" ? "bg-rose-50 border-rose-100 text-rose-800" : tone === "caution" ? "bg-amber-50 border-amber-100 text-amber-900" : "bg-slate-50 border-slate-100 text-slate-600";
  const Icon = tone === "info" ? Info : AlertTriangle;
  return (
    <div className={`flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug ${style}`}>
      <Icon className="w-3.5 h-3.5 shrink-0 mt-px" /> <span>{text}</span>
    </div>
  );
}

function ErrorBox({ text }: { text: string }) {
  return (
    <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl text-xs text-rose-700 flex items-start gap-2">
      <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" /> <span>{text}</span>
    </div>
  );
}
