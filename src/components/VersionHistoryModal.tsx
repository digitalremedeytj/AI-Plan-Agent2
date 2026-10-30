import React, { useEffect, useState } from "react";
import { AlertCircle, History, Loader2, RotateCcw, X } from "lucide-react";
import * as api from "../api/client";

interface VersionHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  planId: string | null;
  /** When and by whom the plan as it stands now was last saved, shown as the top row. */
  current: { savedAt: string; savedBy: string } | null;
  /** Restores the version; resolves once the workspace shows it. Errors are shown in the modal. */
  onRestore: (version: api.PlanVersionSummary) => Promise<void>;
}

// Each checkpoint holds the plan as it stood just before the event it is named for.
const REASON_LABELS: Record<api.PlanVersionSummary["reason"], string> = {
  original: "Original, as generated",
  editing: "Saved while editing",
  scout: "Before a ScoutAI change",
  qa_fixes: "Before QA fixes were applied",
  recap: "Before a Campaign Recap was added",
  restore: "Before an earlier version was restored",
  media_plan: "Before a media plan was uploaded",
  content_refresh: "Before the plan's content was rewritten",
  regenerate: "Before the plan was regenerated",
};

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export const VersionHistoryModal: React.FC<VersionHistoryModalProps> = ({ isOpen, onClose, planId, current, onRestore }) => {
  const [versions, setVersions] = useState<api.PlanVersionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !planId) return;
    let active = true;
    setVersions(null);
    setError(null);
    setRestoringId(null);
    api.listPlanVersions(planId)
      .then((list) => { if (active) setVersions(list); })
      .catch((err) => { if (active) setError(err?.message || "Could not load this plan's history."); });
    return () => { active = false; };
  }, [isOpen, planId]);

  if (!isOpen || !planId) return null;

  const handleRestore = async (version: api.PlanVersionSummary) => {
    if (restoringId) return;
    const confirmed = window.confirm(
      `Restore the version saved ${formatWhen(version.savedAt)}? The plan as it is now is kept in this history, so you can undo this.`,
    );
    if (!confirmed) return;
    setRestoringId(version.id);
    setError(null);
    try {
      await onRestore(version);
      onClose();
    } catch (err: any) {
      setError(
        err instanceof api.ApiError && err.isConflict
          ? "Someone else changed this plan just now. Close this, reload the plan, and try again."
          : err?.message || "Could not restore that version.",
      );
      setRestoringId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs font-sans"
      onClick={() => !restoringId && onClose()}
    >
      <div
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden text-left animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
              <History className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800">Version history</h3>
              <p className="text-[11px] text-slate-400">A checkpoint about every 15 minutes of editing, and before big changes</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={Boolean(restoringId)}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl text-xs text-rose-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <ul className="max-h-[60vh] overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-100">
            {current && (
              <li className="flex items-center justify-between gap-3 px-4 py-3 bg-emerald-50/40">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-800">Current version</p>
                  <p className="text-[11px] text-slate-500 truncate">Saved {formatWhen(current.savedAt)} by {current.savedBy}</p>
                </div>
              </li>
            )}
            {versions === null && !error && (
              <li className="flex items-center justify-center gap-2 px-4 py-6 text-xs text-slate-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading history...
              </li>
            )}
            {versions?.length === 0 && (
              <li className="px-4 py-6 text-center text-xs text-slate-500">
                No earlier versions yet. One is kept about every 15 minutes while this plan is edited.
              </li>
            )}
            {versions?.map((version) => (
              <li key={version.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-800">{formatWhen(version.savedAt)}</p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {REASON_LABELS[version.reason] ?? "Earlier version"} · {version.savedBy}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRestore(version)}
                  disabled={Boolean(restoringId)}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 disabled:pointer-events-none rounded-lg transition-colors cursor-pointer"
                >
                  {restoringId === version.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                  Restore
                </button>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Restoring puts that version back as the newest one. The plan as it is now is kept here first, so a restore can be undone.
            The original and the 20 most recent versions are kept.
          </p>
        </div>
      </div>
    </div>
  );
};
