import React, { useState, useEffect, useRef } from "react";
import { Copy, X, Loader2, AlertCircle } from "lucide-react";
import * as api from "../api/client";
import { generateClonedPlanTitle } from "../utils/planNaming";

interface ClonePlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  plan: { id: string; title: string } | null;
  existingTitles: string[];
  onCloneSuccess: (clonedPlan: api.StoredPlan) => void;
}

export const ClonePlanModal: React.FC<ClonePlanModalProps> = ({
  isOpen,
  onClose,
  plan,
  existingTitles,
  onCloneSuccess,
}) => {
  const [cloneTitle, setCloneTitle] = useState("");
  const [isCloning, setIsCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && plan) {
      const suggested = generateClonedPlanTitle(plan.title, existingTitles);
      setCloneTitle(suggested);
      setError(null);
      setIsCloning(false);
      // Auto-focus and highlight input on open
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 50);
    }
  }, [isOpen, plan, existingTitles]);

  if (!isOpen || !plan) return null;

  const handleClone = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isCloning) return;

    const trimmedTitle = cloneTitle.trim();
    if (!trimmedTitle) {
      setError("Please enter a name for the cloned plan.");
      return;
    }

    setIsCloning(true);
    setError(null);

    try {
      // 1. Fetch full source plan data
      const source = await api.getPlan(plan.id);

      // 2. Clone to a new independent plan (share status reset to private)
      const cloned = await api.createPlan({
        title: trimmedTitle,
        advertiserName: source.advertiserName,
        settingsRevision: source.settingsRevision,
        payload: source.payload,
      });

      onCloneSuccess(cloned);
      onClose();
    } catch (err: any) {
      console.error("Failed to clone plan:", err);
      setError(err?.message || "Failed to clone the plan. Please try again.");
    } finally {
      setIsCloning(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs font-sans"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden text-left animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
              <Copy className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800">Clone Plan</h3>
              <p className="text-[11px] text-slate-400">Create an independent duplicate of this plan</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isCloning}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleClone} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl text-xs text-rose-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Cloned Plan Name
            </label>
            <input
              ref={inputRef}
              type="text"
              value={cloneTitle}
              onChange={(e) => {
                setCloneTitle(e.target.value);
                if (error) setError(null);
              }}
              disabled={isCloning}
              placeholder="Enter plan name..."
              className="w-full text-xs px-3 py-2 bg-white border border-slate-300 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-hidden focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all"
            />
            <p className="text-[11px] text-slate-400 mt-1.5 flex items-center gap-1">
              Source: <span className="font-semibold text-slate-600 truncate max-w-[260px] inline-block align-bottom">{plan.title}</span>
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-[11px] text-slate-500 leading-relaxed">
            The duplicate will inherit all current strategy inputs, budget allocations, and persona briefs. Sharing links will be reset to private.
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isCloning}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isCloning || !cloneTitle.trim()}
              className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:pointer-events-none rounded-xl transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              {isCloning ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Cloning...
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Clone Plan
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
