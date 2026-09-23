import React from "react";
import { AlertTriangle, Check, Loader2, ShieldCheck, X } from "lucide-react";
import * as api from "../api/client";
import type { AuditProposal, PlanAuditResponse } from "../api/client";
import type { AuditFindingRecord } from "../types";

// The manual QA audit. It audits the saved plan, shows every proposed fix as before and after,
// and changes nothing until the planner picks which fixes to apply. Fixes that touch the
// channel plan or charts are never proposed: they are listed as open issues for the planner.

const OWNER_NOTE: Record<AuditFindingRecord["owner"], string> = {
  narrative: "Text",
  personas: "Persona text",
  publisherRationale: "Publisher rationale",
  chart: "Chart - needs a planner",
  channelStrategy: "Channel plan - needs a planner",
  planner: "Planner decision",
};

/** "recommendations[1].why" -> "Recommendation 2 - why" */
export function describePath(path: string): string {
  const labels: Record<string, string> = {
    intro: "Introduction", executiveSummary: "Executive summary", publisherInsights: "Publisher insights",
    audienceAnalysis: "Audience analysis", takeaways: "Takeaway", recommendations: "Recommendation",
    personas: "Persona", ctvPublishers: "CTV publisher", demographics: "Demographics", browserAndReach: "Web & domains",
    deviceTypeIndex: "Devices", temporalPatterns: "Timing",
  };
  const fields: Record<string, string> = { overview: "overview", geographyNotes: "geography notes", activationNotes: "activation notes", why: "why", action: "action", title: "title", channels: "channels", narrative: "narrative", watch: "watches", browse: "browses", buy: "buys", gender: "gender" };
  const match = path.match(/^([A-Za-z]+)(?:\[(\d+)\])?(?:\.([A-Za-z]+))?$/);
  if (!match) return path;
  const [, root, index, field] = match;
  const head = `${labels[root] ?? root}${index !== undefined ? ` ${Number(index) + 1}` : ""}`;
  return field ? `${head} - ${fields[field] ?? field}` : head;
}

type Phase = "auditing" | "review" | "applying" | "error";

export function PlanAuditModal({
  planId,
  onClose,
  onApplied,
}: {
  planId: string;
  onClose: () => void;
  onApplied: (result: { plan: api.StoredPlan; applied: number; stale: number; verifyError: string | null }) => void;
}) {
  const [phase, setPhase] = React.useState<Phase>("auditing");
  const [result, setResult] = React.useState<PlanAuditResponse | null>(null);
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [error, setError] = React.useState<string | null>(null);
  const startedAt = React.useRef(Date.now());
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - startedAt.current) / 1000)), 1000);
    api.auditPlan(planId)
      .then((res) => {
        if (cancelled) return;
        setResult(res);
        setSelected(new Set(res.proposals.map((_, i) => i)));
        setPhase("review");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || "The QA audit could not be completed.");
        setPhase("error");
      })
      .finally(() => clearInterval(timer));
    return () => { cancelled = true; clearInterval(timer); };
  }, [planId]);

  const apply = async (accepted: AuditProposal[]) => {
    if (!result) return;
    setPhase("applying");
    try {
      const applied = await api.applyPlanAudit(planId, { expectedRevision: result.revision, audit: result.audit, accepted, notes: result.notes });
      onApplied(applied);
    } catch (err: any) {
      setError(err instanceof api.ApiError && err.isConflict
        ? "This plan was saved again after the audit ran, so these fixes may no longer match it. Close this and run the audit again."
        : err?.message || "The approved fixes could not be applied.");
      setPhase("error");
    }
  };

  const findingById = new Map((result?.audit.findings ?? []).map((f) => [f.id, f]));
  const proposedFindingIds = new Set((result?.proposals ?? []).map((p) => p.findingId));
  const needsPlanner = (result?.audit.findings ?? []).filter((f) => !proposedFindingIds.has(f.id));
  const toggle = (i: number) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="QA audit">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 uppercase tracking-wider">
            <ShieldCheck className="w-4 h-4 text-indigo-600" /> QA Audit
          </h2>
          <button type="button" onClick={onClose} disabled={phase === "applying"} className="text-slate-400 hover:text-slate-700 cursor-pointer disabled:opacity-40" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 text-sm">
          {phase === "auditing" && (
            <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
              <Loader2 className="w-7 h-7 animate-spin text-indigo-600" />
              <p className="font-semibold text-slate-800">Auditing the saved plan and preparing fixes...</p>
              <p className="text-xs text-slate-500">This usually takes 2-3 minutes ({elapsed}s). Nothing will change until you approve it.</p>
            </div>
          )}

          {phase === "applying" && (
            <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
              <Loader2 className="w-7 h-7 animate-spin text-indigo-600" />
              <p className="font-semibold text-slate-800">Applying the approved fixes, re-verifying and saving...</p>
            </div>
          )}

          {phase === "error" && (
            <div role="alert" className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-800 flex gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {phase === "review" && result && (
            <>
              <div className="flex flex-col sm:flex-row gap-4 items-start">
                <div className="shrink-0 bg-slate-900 text-white rounded-xl px-5 py-4 text-center">
                  <div className="text-3xl font-mono font-extrabold text-indigo-300">{result.audit.totalScore}</div>
                  <div className="text-[10px] font-mono text-indigo-200">/ 100 before fixes</div>
                </div>
                <div className="space-y-2">
                  <p className="text-slate-700 leading-relaxed">{result.audit.executiveSummary}</p>
                  <p className="text-[11px] text-slate-400">
                    Audited the saved version (revision {result.revision}) with {result.auditModel}. Unsaved changes in the workspace are not included.
                  </p>
                </div>
              </div>

              <section className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Proposed fixes ({selected.size} of {result.proposals.length} selected)
                </h3>
                {result.fixError && <p className="text-xs text-rose-700">Fixes could not be proposed: {result.fixError}</p>}
                {result.proposals.length === 0 && !result.fixError && (
                  <p className="text-xs text-slate-500 italic">No text fixes to propose.</p>
                )}
                {result.proposals.map((p, i) => {
                  const finding = findingById.get(p.findingId);
                  return (
                    <label key={i} className={`block border rounded-xl p-3 space-y-2 cursor-pointer ${selected.has(i) ? "border-indigo-200 bg-indigo-50/30" : "border-slate-200 opacity-70"}`}>
                      <div className="flex items-start gap-2">
                        <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} className="mt-0.5" />
                        <div className="space-y-0.5">
                          <p className="text-xs font-semibold text-slate-800">{finding?.issue ?? p.findingId}</p>
                          <p className="text-[11px] text-slate-500">{describePath(p.path)}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pl-6">
                        <div className="text-[11px] leading-relaxed bg-rose-50/60 border border-rose-100 rounded-lg p-2 text-slate-600">
                          <span className="block font-bold text-rose-700 mb-0.5">Before</span>{p.before}
                        </div>
                        <div className="text-[11px] leading-relaxed bg-emerald-50/60 border border-emerald-100 rounded-lg p-2 text-slate-700">
                          <span className="block font-bold text-emerald-700 mb-0.5">After</span>{p.after}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </section>

              {needsPlanner.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Other findings ({needsPlanner.length})</h3>
                  <ul className="space-y-2">
                    {needsPlanner.map((f) => (
                      <li key={f.id} className="text-xs border-b border-slate-100 pb-2 last:border-0">
                        <span className="px-1.5 py-0.5 mr-1.5 rounded text-[9px] font-semibold bg-slate-100 text-slate-600">{f.severity} · {OWNER_NOTE[f.owner]}</span>
                        <span className="text-slate-800 font-medium">{f.issue}</span>
                        {f.fix && <p className="text-slate-500 mt-0.5">Suggested: {f.fix}</p>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>

        {phase === "review" && result && (
          <div className="flex flex-wrap items-center justify-end gap-2 px-6 py-4 border-t border-slate-100">
            <button type="button" onClick={onClose} className="text-xs px-3.5 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer font-semibold">
              Discard
            </button>
            <button type="button" onClick={() => apply([])} className="text-xs px-3.5 py-2 rounded-xl border border-indigo-200 text-indigo-700 hover:bg-indigo-50 cursor-pointer font-semibold">
              Save audit without fixes
            </button>
            <button
              type="button"
              onClick={() => apply(result.proposals.filter((_, i) => selected.has(i)))}
              disabled={selected.size === 0}
              className="inline-flex items-center gap-1.5 text-xs px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Check className="w-3.5 h-3.5" /> Apply {selected.size} fix{selected.size === 1 ? "" : "es"}, verify and save
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
