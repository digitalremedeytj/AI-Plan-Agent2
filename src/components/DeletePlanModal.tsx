import React, { useState } from "react";
import { Trash2, X, AlertTriangle, Loader2 } from "lucide-react";
import * as api from "../api/client";

interface DeletePlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  plan: { id: string; title: string } | null;
  onDeleteSuccess: (planId: string) => void;
}

export const DeletePlanModal: React.FC<DeletePlanModalProps> = ({
  isOpen,
  onClose,
  plan,
  onDeleteSuccess,
}) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !plan) return null;

  const handleDelete = async () => {
    setIsDeleting(true);
    setError(null);

    try {
      await api.archivePlan(plan.id);
      onDeleteSuccess(plan.id);
      onClose();
    } catch (err: any) {
      console.error("Failed to delete plan:", err);
      setError(err?.message || "Failed to delete the plan. Please try again.");
    } finally {
      setIsDeleting(false);
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
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-rose-50/40">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-rose-100 border border-rose-200 flex items-center justify-center text-rose-600 shrink-0">
              <Trash2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800">Delete Plan</h3>
              <p className="text-[11px] text-slate-400">Confirm permanent deletion</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl text-xs text-rose-700 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <p className="text-xs text-slate-600 mb-2">
              Are you sure you want to delete this shared plan?
            </p>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
              <p className="text-xs font-bold text-slate-800 break-words">{plan.title}</p>
            </div>
          </div>

          <div className="bg-rose-50 border border-rose-100 rounded-xl p-3 flex items-start gap-2.5 text-xs text-rose-800 leading-relaxed">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">This is a permanent action.</span>
              <p className="text-[11px] text-rose-700 mt-0.5">
                The plan and its saved parameters will be permanently removed from the shared list for all team members.
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isDeleting}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:pointer-events-none rounded-xl transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Plan
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
