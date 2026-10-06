import React from "react";
import { createPortal } from "react-dom";
import { Activity, AlertCircle, AlertTriangle, BarChart3, CheckCircle2, ChevronDown, FileSpreadsheet, Info, Link2, Loader2, RefreshCw, Sparkles, Trash2, Unlink, Upload, X, XCircle } from "lucide-react";
import * as api from "../api/client";
import type { CampaignAnalysis, CampaignDetailsInput, PerformanceCampaignSummary, PerformanceCampaignView, PreparedFile } from "../api/client";
import { prepareFiles } from "../performance/browserFiles";
import { DatasetViewer } from "./DatasetViewer";
import { CAMPAIGN_GOALS, CONVERSION_EVENTS } from "../performance/constants";

// The advertiser's library of past campaigns, opened from the plan. A planner uploads a
// campaign's report set, checks what was read (the flight, the conversion event, which files are
// reference, the data notes) and saves it linked to this plan. Nothing is analysed by AI here:
// this is the reconciled data ScoutAI will read.

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** The plan the library is opened from; absent from the brief form, before there is a plan. */
  planId?: string;
  /** The plan's advertiser: the library shown, and the default for new campaigns. */
  advertiserName: string;
  onChanged: () => void;
}

type View = { mode: "list" } | { mode: "upload"; campaign?: PerformanceCampaignView; kind?: "past" | "live" } | { mode: "campaign"; id: string; writeReview?: boolean };

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

  // The library is a short list; a campaign or an upload opens wide, with its reports down the
  // left and the overview or an opened report on the right, at a fixed height so switching
  // between reports does not resize the window.
  const wide = view.mode !== "list";
  // Opened from inside the left column, whose stacking context would put the plan above it.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs font-sans" onClick={onClose}>
      <div className={`w-full flex flex-col bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden text-left ${wide ? "max-w-[1600px] h-[90vh]" : "max-w-3xl max-h-[90vh]"}`} onClick={(e) => e.stopPropagation()}>
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
        <div className={`flex-1 min-h-0 ${wide ? "flex flex-col" : "overflow-y-auto custom-scrollbar"}`}>
          {view.mode === "list" && <Library planId={planId} advertiserName={advertiserName} onOpen={(id) => setView({ mode: "campaign", id })} onUpload={(kind) => setView({ mode: "upload", kind })} onChanged={onChanged} />}
          {view.mode === "upload" && (
            <UploadStep
              planId={planId}
              advertiserName={advertiserName}
              campaign={view.campaign}
              kind={view.campaign?.kind ?? view.kind ?? "past"}
              onCancel={() => setView(view.campaign ? { mode: "campaign", id: view.campaign.id } : { mode: "list" })}
              onSaved={(id) => {
                onChanged();
                // New reports mean a new read: the review is written straight away.
                setView({ mode: "campaign", id, writeReview: true });
              }}
            />
          )}
          {view.mode === "campaign" && (
            <CampaignStep
              id={view.id}
              writeReview={Boolean(view.writeReview)}
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

function Library({ planId, advertiserName, onOpen, onUpload, onChanged }: { planId?: string; advertiserName: string; onOpen: (id: string) => void; onUpload: (kind: "past" | "live") => void; onChanged: () => void }) {
  const [campaigns, setCampaigns] = React.useState<PerformanceCampaignSummary[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const [linked, library] = await Promise.all([
        planId ? api.listPerformanceCampaigns({ planId }) : Promise.resolve([]),
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
    if (!planId) return;
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

  const live = planId ? (campaigns || []).find((c) => c.kind === "live" && c.linkedPlanIds.includes(planId)) : undefined;
  const linked = planId ? (campaigns || []).filter((c) => c.linkedPlanIds.includes(planId) && c !== live) : [];
  const others = (campaigns || []).filter((c) => !planId || !c.linkedPlanIds.includes(planId));

  return (
    <div className="p-6 space-y-5">
      {error && <ErrorBox text={error} />}
      <div className="flex items-start justify-between gap-4">
        <p className="text-xs leading-relaxed text-slate-500 max-w-lg">
          Upload the report exports from a campaign that has already run: the media type, publisher, audience, ad group, creative and daily reports, and all-touch or last-touch conversion exports. {planId ? "ScoutAI reads what is linked to this plan." : "Ticked campaigns in the brief shape the plan that is generated."}
        </p>
        <button onClick={() => onUpload("past")} className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 cursor-pointer">
          <Upload className="w-3.5 h-3.5" /> Add a past campaign
        </button>
      </div>
      {planId && campaigns !== null && (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-800"><Activity className="w-3.5 h-3.5" /> This plan's live campaign</div>
              <p className="text-[11px] text-slate-600 truncate">
                {live ? `${live.name} · ${live.snapshots.length} upload${live.snapshots.length === 1 ? "" : "s"} · last data ${live.snapshots[live.snapshots.length - 1]?.asOf ?? "n/a"}` : "Once it is running, re-export the reports and upload them here to see it against the plan."}
              </p>
            </div>
            {live ? (
              <button onClick={() => onOpen(live.id)} className="shrink-0 px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-bold hover:bg-emerald-700 cursor-pointer">Plan vs actual</button>
            ) : (
              <button onClick={() => onUpload("live")} className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-emerald-200 bg-white text-emerald-800 text-[11px] font-bold hover:bg-emerald-50 cursor-pointer"><Upload className="w-3 h-3" /> Upload live reports</button>
            )}
          </div>
        </div>
      )}
      {campaigns === null ? (
        <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</div>
      ) : (
        <>
          {planId && <Section title="Past campaigns linked to this plan" empty="No past campaigns are linked yet.">
            {linked.map((c) => (
              <CampaignRow key={c.id} campaign={c} onOpen={() => onOpen(c.id)} action={
                <button disabled={busy === c.id} onClick={() => toggleLink(c, false)} className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 cursor-pointer disabled:opacity-50">
                  <Unlink className="w-3 h-3" /> Unlink
                </button>
              } />
            ))}
          </Section>}
          {(others.length > 0 || !planId) && (
            <Section title={planId ? `Other campaigns for ${advertiserName}` : `Campaigns for ${advertiserName || "this advertiser"}`} empty="None yet.">
              {others.map((c) => (
                <CampaignRow key={c.id} campaign={c} onOpen={() => onOpen(c.id)} action={planId && c.kind !== "live" ? (
                  <button disabled={busy === c.id} onClick={() => toggleLink(c, true)} className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold text-indigo-700 hover:bg-indigo-50 cursor-pointer disabled:opacity-50">
                    <Link2 className="w-3 h-3" /> Link to this plan
                  </button>
                ) : null} />
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
        <div className="text-xs font-bold text-slate-800 truncate">{c.name}{c.kind === "live" && <span className="ml-1.5 text-[10px] font-bold text-emerald-700">LIVE</span>}</div>
        <div className="text-[11px] text-slate-500 truncate">
          {flightText(c.flightStart, c.flightEnd)} · {c.fileCount} file{c.fileCount === 1 ? "" : "s"}{c.conversionLabel ? ` · ${c.conversionLabel}` : ""} · added by {c.createdBy}
        </div>
      </button>
      {action}
    </div>
  );
}

// --- upload ------------------------------------------------------------------

function UploadStep({ planId, advertiserName, campaign, kind, onCancel, onSaved }: { planId?: string; advertiserName: string; campaign?: PerformanceCampaignView; kind: "past" | "live"; onCancel: () => void; onSaved: (id: string) => void }) {
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
        const result = await api.previewPerformanceFiles({ files, campaignId: campaign?.id, details, kind });
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
        : await api.createPerformanceCampaign({ files, details, planId, kind });
      onSaved(response.campaign.id);
    } catch (err: any) {
      setError(err?.message || "Could not save the campaign.");
    } finally {
      setSaving(false);
    }
  };

  const dropTitle = campaign ? (kind === "live" ? `Upload the latest exports for ${campaign.name}` : `Add reports to ${campaign.name}`) : kind === "live" ? "Drop this plan's live campaign exports here" : "Drop a campaign's report exports here";
  const progressBar = progress && (
    <div className="mt-3 mx-auto max-w-xs">
      <div className="text-[10px] text-slate-500 truncate mb-1">Summarising {progress.fileName}…</div>
      <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.round(progress.fraction * 100)}%` }} /></div>
    </div>
  );

  return (
    <div
      className="flex-1 min-h-0 flex flex-col"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        addFiles(e.dataTransfer.files);
      }}
    >
      <input ref={inputRef} type="file" multiple accept=".csv,.txt,.tsv,.xlsx,.xls" className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
      {files.length === 0 ? (
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-6">
          <div className="max-w-2xl mx-auto space-y-5">
            {error && <ErrorBox text={error} />}
            <div onClick={() => inputRef.current?.click()} className="rounded-xl border-2 border-dashed border-slate-200 hover:border-indigo-300 bg-slate-50/50 px-4 py-10 text-center cursor-pointer transition-colors">
              <FileSpreadsheet className="w-6 h-6 text-indigo-400 mx-auto mb-1.5" />
              <p className="text-xs font-bold text-slate-700">{dropTitle}</p>
              {kind === "live" && <p className="text-[11px] text-emerald-700 mt-0.5">Re-export the reports during the flight; each new export replaces the earlier one of the same report.</p>}
              <p className="text-[11px] text-slate-400 mt-0.5">CSV or Excel, several at once. All-touch and last-touch exports are summarised in your browser; their rows are never uploaded.</p>
              {progressBar}
            </div>
            {errors.map((e, i) => <ErrorBox key={i} text={e} />)}
          </div>
        </div>
      ) : (
        <SplitView
          analysis={preview?.analysis ?? null}
          removable={files.map((f) => f.fileName)}
          onRemove={(name) => setFiles((prev) => prev.filter((f) => f.fileName !== name))}
          top={
            <div onClick={() => inputRef.current?.click()} className="mb-2 rounded-lg border border-dashed border-slate-300 hover:border-indigo-300 bg-white px-3 py-2.5 text-center cursor-pointer transition-colors">
              <p className="flex items-center justify-center gap-1 text-[11px] font-bold text-slate-700"><Upload className="w-3 h-3" /> Add more files</p>
              <p className="text-[10px] text-slate-400">or drop them anywhere here</p>
              {progressBar}
            </div>
          }
          viewer={(entry) => {
            const file = files.find((f) => f.fileName === entry.fileName);
            const text = file && "text" in file ? file.text : null;
            return <DatasetViewer key={entry.fileName} entry={entry} loadText={text !== null ? () => Promise.resolve(text) : null} touch={file && "touchSummary" in file ? file.touchSummary : undefined} />;
          }}
          overview={
            <>
              {error && <ErrorBox text={error} />}
              {errors.map((e, i) => <ErrorBox key={i} text={e} />)}
              {!campaign && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Advertiser" required>
                    <input value={details.advertiserName || ""} onChange={(e) => edit("advertiserName", e.target.value)} className={inputClass} />
                  </Field>
                  <Field label="Campaign name">
                    <input value={details.name || ""} placeholder="Named after the flight if left blank" onChange={(e) => edit("name", e.target.value)} className={inputClass} />
                  </Field>
                  <DetailFields details={details} edit={edit} live={kind === "live"} />
                </div>
              )}
              {preview?.replaced?.length ? <Notice tone="info" text={`Replaces the earlier export${preview.replaced.length === 1 ? "" : "s"}: ${preview.replaced.join(", ")}.`} /> : null}
              {preview?.advertiserMismatch && (
                <Notice tone="caution" text={`These files are for ${preview.advertiserMismatch}, not ${details.advertiserName || campaign?.advertiserName}. They can inform this plan, but will not appear in anything client-facing unless the advertisers match.`} />
              )}
              {preview?.duplicates.length ? <Notice tone="info" text={`Already in this campaign, skipped: ${preview.duplicates.join(", ")}.`} /> : null}
              {preview ? <AnalysisSummary analysis={preview.analysis} /> : <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading the reports…</div>}
            </>
          }
        />
      )}

      <div className="shrink-0 flex items-center justify-end gap-2 px-6 py-3 border-t border-slate-100">
        <button onClick={onCancel} className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-50 cursor-pointer">Cancel</button>
        <button
          onClick={save}
          disabled={!files.length || saving || previewing || Boolean(progress) || (!campaign && !details.advertiserName?.trim())}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {campaign ? (kind === "live" ? "Upload" : "Add to campaign") : kind === "live" ? "Track as this plan's live campaign" : planId ? "Save and link to this plan" : "Save to the library"}
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
function DetailFields({ details, edit, live = false }: { details: CampaignDetailsInput; edit: (key: keyof CampaignDetailsInput, value: string) => void; live?: boolean }) {
  return (
    <>
      <Field label={live ? "Planned flight start" : "Flight start"} hint={live ? "The whole flight, not the reports' dates: pacing is measured against it." : "Files outside the flight are kept as reference."}>
        <input type="date" value={details.flightStart || ""} onChange={(e) => edit("flightStart", e.target.value)} className={inputClass} />
      </Field>
      <Field label={live ? "Planned flight end" : "Flight end"}>
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

function CampaignStep({ id, writeReview, planId, onBack, onAddFiles, onChanged }: { id: string; writeReview: boolean; planId?: string; onBack: () => void; onAddFiles: (c: PerformanceCampaignView) => void; onChanged: () => void }) {
  const [data, setData] = React.useState<api.CampaignResponse | null>(null);
  const [reviewing, setReviewing] = React.useState(false);
  const [reviewError, setReviewError] = React.useState<string | null>(null);
  const [details, setDetails] = React.useState<CampaignDetailsInput>({});
  const [dirty, setDirty] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Reports are fetched when first opened and kept, so switching back to one is instant.
  const texts = React.useRef(new Map<string, Promise<string>>());
  const loadText = (fileId: string) => () => {
    let pending = texts.current.get(fileId);
    if (!pending) {
      pending = api.getPerformanceFileText(id, fileId);
      pending.catch(() => texts.current.delete(fileId));
      texts.current.set(fileId, pending);
    }
    return pending;
  };

  const apply = (response: api.CampaignResponse) => {
    setData(response);
    const c = response.campaign;
    setDetails({ advertiserName: c.advertiserName, name: c.name, flightStart: c.flightStart, flightEnd: c.flightEnd, conversionLabel: c.conversionLabel, campaignGoal: c.campaignGoal });
    setDirty(false);
  };
  const review = async (campaign: PerformanceCampaignView) => {
    setReviewing(true);
    setReviewError(null);
    try {
      try {
        apply(await api.reviewPerformanceCampaign(campaign.id, campaign.revision));
      } catch (err) {
        if (!(err instanceof api.ApiError && err.isConflict)) throw err;
        // The campaign moved on after this window opened (building a recap writes a review).
        // Reload it and review the latest revision once. A first review that someone else has
        // since written is the answer as it stands; a Rewrite the planner asked for still runs.
        const rewriting = Boolean(data?.review);
        const latest = await api.getPerformanceCampaign(campaign.id);
        apply(!rewriting && latest.review && !latest.reviewStale ? latest : await api.reviewPerformanceCampaign(latest.campaign.id, latest.campaign.revision));
      }
      onChanged();
    } catch (err: any) {
      setReviewError(err?.message || "The review could not be written. Try again.");
    } finally {
      setReviewing(false);
    }
  };
  React.useEffect(() => {
    api.getPerformanceCampaign(id).then((response) => {
      apply(response);
      if (writeReview && !response.review) review(response.campaign);
    }).catch((err) => setError(err?.message || "Could not load the campaign."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  if (!data) return <div className="p-6 overflow-y-auto">{error ? <ErrorBox text={error} /> : <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</div>}</div>;
  const c = data.campaign;
  const edit = (key: keyof CampaignDetailsInput, value: string) => {
    setDetails((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };
  const isLinked = Boolean(planId && c.linkedPlanIds.includes(planId));

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-6 py-2.5 border-b border-slate-100 [&_button]:whitespace-nowrap">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onBack} className="shrink-0 text-[11px] font-semibold text-slate-500 hover:text-slate-800 cursor-pointer">← Library</button>
          <span className="text-xs font-bold text-slate-800 truncate">{c.name}{c.kind === "live" && <span className="ml-1.5 text-[10px] font-bold text-emerald-700">LIVE</span>}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {planId && c.kind !== "live" && (
            <button disabled={busy} onClick={() => run(() => api.updatePerformanceCampaign(c.id, c.revision, isLinked ? { unlinkPlanIds: [planId] } : { linkPlanIds: [planId] }))} className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer disabled:opacity-50">
              {isLinked ? <><Unlink className="w-3 h-3" /> Unlink from this plan</> : <><Link2 className="w-3 h-3" /> Link to this plan</>}
            </button>
          )}
          <button disabled={busy} onClick={() => onAddFiles(c)} className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-bold text-indigo-700 hover:bg-indigo-50 cursor-pointer disabled:opacity-50">
            <Upload className="w-3 h-3" /> {c.kind === "live" ? "Upload latest reports" : "Add reports"}
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
      <SplitView
        analysis={data.analysis}
        removable={c.files.length > 1 ? c.files.map((f) => f.fileName) : []}
        onRemove={(fileName) => {
          const file = c.files.find((f) => f.fileName === fileName);
          if (file && window.confirm(`Remove ${fileName} from this campaign?`)) run(() => api.updatePerformanceCampaign(c.id, c.revision, { removeFileIds: [file.id] }));
        }}
        viewer={(entry) => {
          const file = c.files.find((f) => f.fileName === entry.fileName);
          return (
            <DatasetViewer
              key={entry.fileName}
              entry={entry}
              loadText={file && file.source === "export" ? loadText(file.id) : null}
              touch={data.analysis.touches.find((t) => t.fileName === entry.fileName)?.summary}
            />
          );
        }}
        overview={
          <>
            {error && <ErrorBox text={error} />}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Advertiser" required><input value={details.advertiserName || ""} onChange={(e) => edit("advertiserName", e.target.value)} className={inputClass} /></Field>
              <Field label="Campaign name"><input value={details.name || ""} onChange={(e) => edit("name", e.target.value)} className={inputClass} /></Field>
              <DetailFields details={details} edit={edit} live={c.kind === "live"} />
            </div>
            {dirty && (
              <div className="flex justify-end">
                <button disabled={busy} onClick={() => run(() => api.updatePerformanceCampaign(c.id, c.revision, { details }))} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 cursor-pointer disabled:opacity-50">
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save details
                </button>
              </div>
            )}
            {data.advertiserMismatch && <Notice tone="caution" text={`These files are for ${data.advertiserMismatch}, not ${c.advertiserName}. They will not appear in anything client-facing unless the advertisers match.`} />}
            {c.kind === "live" && planId && isLinked && <PlanVsActualCard planId={planId} revision={c.revision} />}
            <ReviewPanel review={data.review} stale={data.reviewStale} busy={reviewing || busy} error={reviewError} onWrite={() => review(c)} />
            <AnalysisSummary analysis={data.analysis} />
          </>
        }
      />
    </div>
  );
}

// --- plan vs actual -------------------------------------------------------------------

const STATUS: Record<string, { label: string; style: string }> = {
  "on-pace": { label: "On pace", style: "bg-emerald-50 text-emerald-700 border-emerald-100" },
  under: { label: "Under", style: "bg-amber-50 text-amber-800 border-amber-100" },
  over: { label: "Over", style: "bg-sky-50 text-sky-700 border-sky-100" },
  "not-delivering": { label: "Not delivering", style: "bg-rose-50 text-rose-700 border-rose-100" },
  "not-started": { label: "Not started", style: "bg-slate-100 text-slate-600 border-slate-200" },
  "off-plan": { label: "Not in plan", style: "bg-violet-50 text-violet-700 border-violet-100" },
};

function PlanVsActualCard({ planId, revision }: { planId: string; revision: number }) {
  const [p, setP] = React.useState<api.PlanVsActual | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    api.getPlanLive(planId).then((live) => setP(live?.comparison ?? null)).catch((err) => setError(err?.message || "Could not compare with the plan."));
  }, [planId, revision]);
  if (error) return <ErrorBox text={error} />;
  if (!p) return <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Comparing with the plan…</div>;
  const usd = (v: number | null) => (v === null ? "n/a" : v < 100 ? `$${v.toFixed(2)}` : money(v));
  const pctText = (v: number | null) => (v === null ? "n/a" : `${Math.round(v * 100)}%`);
  const targetText = p.target ? (p.target.metric === "cpa" ? `CPA target ${usd(p.target.value)}` : `ROAS target ${p.target.value.toFixed(2)}x`) : "No CPA or ROAS target in the KPIs";
  const actualKpi = p.target?.metric === "roas" ? (p.actual.roas !== null ? `${p.actual.roas.toFixed(2)}x` : "n/a") : usd(p.actual.cpa);
  const kpiGood = p.target ? (p.target.metric === "cpa" ? (p.actual.cpa ?? Infinity) <= p.target.value : (p.actual.roas ?? 0) >= p.target.value) : null;
  return (
    <div className="rounded-xl border border-emerald-100">
      <div className="px-4 py-3 border-b border-emerald-50 flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">Plan vs actual{p.asOf ? ` · data to ${p.asOf}` : ""}</div>
        {p.sinceLast && <div className="text-[10px] text-slate-500">Since last upload: {money(p.sinceLast.spend)}, {Math.round(p.sinceLast.conversions).toLocaleString()} {p.conversionLabel}, CPA {usd(p.sinceLast.cpa)}</div>}
      </div>
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-4 gap-2">
          <Stat label="Flight" value={p.daysElapsed !== null && p.flight ? `Day ${p.daysElapsed} of ${p.flight.days}` : "n/a"} />
          <Stat label={`Spent of ${money(p.budget)}`} value={`${money(p.spent)} (${pctText(p.spendShare)})`} />
          <Stat label="Pacing (100% = on plan)" value={pctText(p.pacing)} />
          <Stat label={targetText} value={actualKpi} />
        </div>
        <div>
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden relative">
            <div className="absolute inset-y-0 left-0 bg-emerald-500" style={{ width: `${Math.min(100, p.spendShare * 100)}%` }} />
            {p.elapsedShare !== null && <div className="absolute inset-y-0 w-0.5 bg-slate-700" style={{ left: `${Math.min(100, p.elapsedShare * 100)}%` }} title="Where spend should be by now" />}
          </div>
          <p className="mt-1 text-[10px] text-slate-500">
            Bar: share of budget spent; the line marks the share of the flight elapsed.{p.projectedSpend !== null ? ` At the last week's rate it ends near ${money(p.projectedSpend)} (a straight line, not a forecast).` : ""}
            {kpiGood !== null && <span className={kpiGood ? "text-emerald-700" : "text-rose-700"}> {kpiGood ? "Inside" : "Outside"} the target so far.</span>}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                <th className="py-1 pr-2 font-bold">Media type</th><th className="py-1 px-2 font-bold text-right">Planned</th><th className="py-1 px-2 font-bold text-right">Expected to date</th><th className="py-1 px-2 font-bold text-right">Spent</th><th className="py-1 px-2 font-bold text-right">{p.conversionLabel}</th><th className="py-1 px-2 font-bold text-right">CPA</th><th className="py-1 pl-2 font-bold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {p.channels.map((c) => (
                <tr key={c.name}>
                  <td className="py-1.5 pr-2 font-semibold text-slate-700">{c.name}</td>
                  <td className="py-1.5 px-2 text-right text-slate-600">{c.plannedPercent !== null ? `${c.plannedPercent}%` : "–"}</td>
                  <td className="py-1.5 px-2 text-right text-slate-600">{c.expectedToDate !== null ? money(c.expectedToDate) : "–"}</td>
                  <td className="py-1.5 px-2 text-right text-slate-800">{money(c.spend)}{c.delivery !== null ? <span className="text-slate-400"> ({pctText(c.delivery)})</span> : null}</td>
                  <td className="py-1.5 px-2 text-right text-slate-600">{Math.round(c.conversions).toLocaleString()}</td>
                  <td className={`py-1.5 px-2 text-right ${c.aboveTarget ? "text-rose-700 font-bold" : "text-slate-800"}`}>{usd(c.cpa)}{c.thinSample && c.spend > 0 ? <span className="text-slate-400" title="Under 30 conversions"> *</span> : null}</td>
                  <td className="py-1.5 pl-2"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${STATUS[c.status].style}`}>{STATUS[c.status].label}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[10px] text-slate-400">* Under 30 conversions: too early to judge its CPA. CPA in red is over the target on enough conversions.</p>
        </div>
        {p.publishers && (p.publishers.notDelivering.length > 0 || p.publishers.offPlan.length > 0) && (
          <div className="space-y-1.5">
            {p.publishers.notDelivering.length > 0 && <Notice tone="caution" text={`Plan publishers not delivering: ${p.publishers.notDelivering.join(", ")}.`} />}
            {p.publishers.offPlan.length > 0 && <Notice tone="info" text={`Delivering but not in the plan: ${p.publishers.offPlan.slice(0, 6).map((x) => `${x.name} (${money(x.spend)})`).join(", ")}${p.publishers.offPlan.length > 6 ? ` and ${p.publishers.offPlan.length - 6} more` : ""}.`} />}
          </div>
        )}
        {p.notes.map((n, i) => <Notice key={i} tone="info" text={n} />)}
      </div>
    </div>
  );
}

// --- the saved review ------------------------------------------------------------------

const KIND: Record<api.ReviewFinding["kind"], { label: string; icon: React.ReactNode }> = {
  worked: { label: "What worked", icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> },
  didnt: { label: "What didn't", icon: <XCircle className="w-3.5 h-3.5 text-rose-600" /> },
  watch: { label: "Read with care", icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-600" /> },
};
const CONFIDENCE_STYLE: Record<string, string> = {
  high: "bg-emerald-50 text-emerald-700 border-emerald-100",
  medium: "bg-sky-50 text-sky-700 border-sky-100",
  low: "bg-slate-100 text-slate-600 border-slate-200",
};

function ReviewPanel({ review, stale, busy, error, onWrite }: { review: api.PerformanceReview | null; stale: boolean; busy: boolean; error: string | null; onWrite: () => void }) {
  const [open, setOpen] = React.useState<string | null>(null);
  if (!review) {
    return (
      <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 px-4 py-3">
        {busy ? (
          <div className="flex items-center gap-2 text-xs text-indigo-900"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Writing the review. This takes about a minute…</div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-600">No review yet. ScoutAI reads the reports once and saves what worked, what didn't and what to read with care, for every plan to build on.</p>
            <button onClick={onWrite} className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-[11px] font-bold hover:bg-indigo-700 cursor-pointer"><Sparkles className="w-3 h-3" /> Write the review</button>
          </div>
        )}
        {error && <div className="mt-2"><ErrorBox text={error} /></div>}
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-slate-200">
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-100">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-indigo-600">Performance review</div>
          <p className="mt-1 text-xs leading-relaxed text-slate-700">{review.summary}</p>
          <p className="mt-1 text-[10px] text-slate-400">Written {new Date(review.generatedAt).toLocaleDateString()} · requested by {review.generatedBy}</p>
        </div>
        <button disabled={busy} onClick={onWrite} className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 cursor-pointer disabled:opacity-50">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Rewrite
        </button>
      </div>
      {stale && <div className="px-4 pt-3"><Notice tone="caution" text="The reports or details changed after this review was written. Rewrite it before using it for client learnings." /></div>}
      {error && <div className="px-4 pt-3"><ErrorBox text={error} /></div>}
      <div className="p-4 space-y-3">
        {(["worked", "didnt", "watch"] as const).map((kind) => {
          const findings = review.findings.filter((f) => f.kind === kind);
          if (!findings.length) return null;
          return (
            <div key={kind}>
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700 mb-1.5">{KIND[kind].icon} {KIND[kind].label}</div>
              <ul className="space-y-1.5">
                {findings.map((f) => (
                  <li key={f.id} className="rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2">
                    <button onClick={() => setOpen(open === f.id ? null : f.id)} className="w-full flex items-start gap-2 text-left cursor-pointer">
                      <span className="flex-1 min-w-0">
                        <span className="block text-[11px] font-bold text-slate-800">{f.headline}</span>
                        <span className="block text-[11px] leading-relaxed text-slate-600">{f.detail}</span>
                      </span>
                      <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border ${CONFIDENCE_STYLE[f.confidence]}`}>{f.confidence}</span>
                      <ChevronDown className={`w-3.5 h-3.5 shrink-0 text-slate-400 transition-transform ${open === f.id ? "rotate-180" : ""}`} />
                    </button>
                    {open === f.id && <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500"><span className="font-bold">Evidence:</span> {f.evidence}</p>}
                    {f.unverified.length > 0 && <p className="mt-1.5 text-[10px] text-amber-800">Figures not found in the data: {f.unverified.join(", ")}. This finding is kept out of anything client-facing.</p>}
                    {f.causalClaim && <p className="mt-1.5 text-[10px] text-amber-800">States a cause ("{f.causalClaim}") the data does not show. This finding is kept out of anything client-facing.</p>}
                    {f.confidenceNote && <p className="mt-1.5 text-[10px] text-slate-500">Confidence lowered: {f.confidenceNote}.</p>}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
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

/** The totals the reports add up to and the data notes: the overview's "what was read". */
function AnalysisSummary({ analysis }: { analysis: CampaignAnalysis }) {
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
          {" "}Open a report on the left to see its rows.
        </p>
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

type FileEntry = CampaignAnalysis["files"][number];

/**
 * The campaign's reports down a narrow left column, and the overview or the opened report in the
 * wide right panel. The overview is the default. On a narrow screen the two stack.
 */
function SplitView({ analysis, removable, onRemove, top, overview, viewer }: {
  /** Null while the reports are still being read. */
  analysis: CampaignAnalysis | null;
  removable: string[];
  onRemove: (fileName: string) => void;
  top?: React.ReactNode;
  overview: React.ReactNode;
  viewer: (entry: FileEntry) => React.ReactNode;
}) {
  const [selected, setSelected] = React.useState<string | null>(null);
  const entry = selected !== null ? analysis?.files.find((f) => f.fileName === selected) : undefined;
  // A removed report closes back to the overview.
  React.useEffect(() => {
    if (selected !== null && analysis && !entry) setSelected(null);
  }, [selected, analysis, entry]);

  const item = (active: boolean) => `w-full flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left cursor-pointer transition-colors ${active ? "bg-white border-indigo-200 shadow-xs ring-1 ring-indigo-100" : "border-transparent hover:bg-white hover:border-slate-200"}`;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto md:overflow-hidden md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,3fr)] md:grid-rows-[minmax(0,1fr)]">
      <aside className="max-h-72 md:max-h-none overflow-y-auto custom-scrollbar border-b md:border-b-0 md:border-r border-slate-100 bg-slate-50/60 p-3 space-y-1">
        {top}
        <button onClick={() => setSelected(null)} className={item(!entry)}>
          <BarChart3 className={`w-3.5 h-3.5 shrink-0 ${!entry ? "text-indigo-600" : "text-slate-400"}`} />
          <span className="text-[11px] font-bold text-slate-800">Overview</span>
        </button>
        <div className="pt-2 pb-1 px-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Reports{analysis ? ` (${analysis.files.length})` : ""}</div>
        {!analysis ? (
          <div className="flex items-center gap-2 px-1 text-[11px] text-slate-500"><Loader2 className="w-3 h-3 animate-spin" /> Reading…</div>
        ) : (
          analysis.files.map((f) => (
            <div key={f.fileName} className="group relative">
              <button onClick={() => setSelected(f.fileName)} className={`${item(entry?.fileName === f.fileName)} ${removable.includes(f.fileName) ? "pr-7" : ""}`}>
                <span className="flex-1 min-w-0">
                  <span className="block text-[11px] font-semibold text-slate-800 truncate" title={f.fileName}>{f.reportType || f.fileName}</span>
                  <span className="block text-[10px] text-slate-500 truncate">{describeFile(analysis, f.fileName, f.kind, f.reportType)}{f.window ? ` · ${day(f.window.start)} to ${day(f.window.end)}` : ""}</span>
                </span>
                <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border ${f.kind === "unread" ? "bg-rose-50 text-rose-700 border-rose-100" : ROLE_STYLE[f.role]}`}>
                  {f.kind === "unread" ? "Not read" : ROLE_LABEL[f.role]}
                </span>
              </button>
              {removable.includes(f.fileName) && (
                <button onClick={() => onRemove(f.fileName)} title="Remove" className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-300 hover:text-rose-600 cursor-pointer"><X className="w-3.5 h-3.5" /></button>
              )}
            </div>
          ))
        )}
      </aside>
      <section className="min-h-0 md:overflow-hidden">
        {entry ? (
          <div className="h-[70vh] md:h-full">{viewer(entry)}</div>
        ) : (
          <div className="h-full md:overflow-y-auto custom-scrollbar">
            <div className="p-6 space-y-5 max-w-4xl">{overview}</div>
          </div>
        )}
      </section>
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
