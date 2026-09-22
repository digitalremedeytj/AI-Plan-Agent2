import React, { useState } from "react";
import {
  Share2,
  X,
  Copy,
  Check,
  Shield,
  AlertTriangle,
  RefreshCw,
  Loader2,
  ExternalLink,
  Lock
} from "lucide-react";
import * as api from "../api/client";

interface SharePlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  planId: string;
  planTitle: string;
  isShared?: boolean;
  shareToken?: string | null;
  onShareStatusChanged: (isShared: boolean, shareToken: string | null) => void;
}

export const SharePlanModal: React.FC<SharePlanModalProps> = ({
  isOpen,
  onClose,
  planId,
  planTitle,
  isShared: initialIsShared = false,
  shareToken: initialShareToken = null,
  onShareStatusChanged,
}) => {
  const [isShared, setIsShared] = useState<boolean>(Boolean(initialIsShared && initialShareToken));
  const [shareToken, setShareToken] = useState<string | null>(initialShareToken);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreateOrEnable = async (regenerate = false) => {
    if (!planId) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.enablePlanShare(planId, regenerate);
      setIsShared(Boolean(res.isShared));
      setShareToken(res.shareToken);
      onShareStatusChanged(Boolean(res.isShared), res.shareToken);
    } catch (err: any) {
      setError(err?.message || "Failed to create shareable link.");
    } finally {
      setIsLoading(false);
    }
  };

  // Sync state if props change when opening, and auto-generate if not shared yet
  React.useEffect(() => {
    if (!isOpen) return;
    const hasActiveShare = Boolean(initialIsShared && initialShareToken);
    setIsShared(hasActiveShare);
    setShareToken(initialShareToken || null);
    setError(null);
    setCopied(false);

    // If opening an unshared plan, auto-generate the share link immediately so the user doesn't have to wait or see a disabled screen
    if (!hasActiveShare && planId) {
      void handleCreateOrEnable(false);
    }
  }, [initialIsShared, initialShareToken, isOpen, planId]);

  if (!isOpen) return null;

  const shareUrl = shareToken
    ? `${window.location.origin}${window.location.pathname}?share=${encodeURIComponent(shareToken)}`
    : "";

  const handleCopy = async () => {
    if (!shareUrl) return;
    let success = false;
    try {
      await navigator.clipboard.writeText(shareUrl);
      success = true;
    } catch {
      // Fallback for sandboxed iframes or browsers blocking clipboard API
      try {
        const textArea = document.createElement("textarea");
        textArea.value = shareUrl;
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        success = document.execCommand("copy");
        document.body.removeChild(textArea);
      } catch {
        success = false;
      }
    }

    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } else {
      setError("Unable to copy automatically. Please select and copy the link text manually.");
    }
  };

  const handleRevoke = async () => {
    if (
      !confirm(
        "Are you sure you want to turn off link sharing? Anyone currently using the link will immediately lose access.",
      )
    ) {
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      await api.revokePlanShare(planId);
      setIsShared(false);
      setShareToken(null);
      onShareStatusChanged(false, null);
    } catch (err: any) {
      setError(err?.message || "Failed to revoke shareable link.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs font-sans"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden text-left"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/10 text-indigo-600 flex items-center justify-center">
              <Share2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-display font-bold text-slate-900">Share Media Plan</h3>
              <p className="text-[11px] text-slate-500 truncate max-w-xs">{planTitle}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl text-xs text-rose-700 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <p className="text-xs text-slate-600 leading-relaxed">
            Create a unique, unguessable link to share this media plan blueprint. Anyone with this link can view the complete plan and overview without logging in.
          </p>

          {/* Privacy & Safeguards note */}
          <div className="p-3 bg-indigo-50/50 border border-indigo-100 rounded-xl space-y-1.5 text-[11px] text-slate-600">
            <div className="flex items-center gap-1.5 font-bold text-indigo-900">
              <Shield className="w-3.5 h-3.5 text-indigo-600" />
              <span>Privacy & Security Safeguards</span>
            </div>
            <ul className="list-disc list-inside space-y-0.5 text-slate-500 pl-1 text-[10px] leading-normal">
              <li>Protected by a 256-bit cryptographically secure URL token.</li>
              <li>Tagged with <code className="text-[9px] bg-white px-1 py-0.5 rounded border border-indigo-200">noindex, nofollow</code> to prevent search engine indexing.</li>
              <li>Strictly read-only: viewers cannot edit, delete, overwrite, or access other plans.</li>
            </ul>
          </div>

          {/* Loading state while auto-generating link */}
          {isLoading && !shareToken ? (
            <div className="py-8 text-center space-y-3">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-600 mx-auto" />
              <p className="text-xs font-semibold text-slate-700">Generating secure shareable link...</p>
              <p className="text-[11px] text-slate-500">Creating a unique 256-bit link for this plan.</p>
            </div>
          ) : isShared && shareToken ? (
            <div className="space-y-4 pt-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700">Shareable Unique Link</span>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  Active & Accessible
                </span>
              </div>

              {/* Link Box */}
              <div className="flex items-center gap-2">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    readOnly
                    value={shareUrl}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono text-slate-800 pr-8 focus:outline-hidden focus:border-indigo-400 focus:bg-white"
                  />
                  <a
                    href={shareUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-indigo-600"
                    title="Open in new tab to test"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
                <button
                  onClick={handleCopy}
                  className={`inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer shadow-xs ${
                    copied
                      ? "bg-emerald-600 text-white"
                      : "bg-indigo-600 hover:bg-indigo-700 text-white"
                  }`}
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? "Copied!" : "Copy"}</span>
                </button>
              </div>

              {/* Actions row: Regenerate / Revoke */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3 text-xs">
                <button
                  onClick={() => handleCreateOrEnable(true)}
                  disabled={isLoading}
                  className="inline-flex items-center gap-1.5 text-slate-600 hover:text-indigo-700 font-medium cursor-pointer disabled:opacity-50"
                  title="Generate a new token. The previous link will stop working immediately."
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
                  <span>Regenerate Link</span>
                </button>

                <button
                  onClick={handleRevoke}
                  disabled={isLoading}
                  className="inline-flex items-center gap-1.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50 px-2.5 py-1.5 rounded-lg transition-colors font-semibold cursor-pointer disabled:opacity-50"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Turn Off Sharing</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 pt-2">
              <div className="p-5 rounded-xl bg-slate-50 border border-slate-200 text-center space-y-3">
                <div className="w-10 h-10 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center mx-auto">
                  <Lock className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-800">Link Sharing is Off</h4>
                  <p className="text-[11px] text-slate-500 mt-1 max-w-sm mx-auto">
                    This plan is currently private to logged-in team members. Turn on link sharing to generate an unguessable, read-only link for clients or partners.
                  </p>
                </div>
                <button
                  onClick={() => handleCreateOrEnable(false)}
                  disabled={isLoading}
                  className="inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-semibold px-4 py-2 rounded-xl text-xs shadow-xs transition-colors cursor-pointer"
                >
                  {isLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Share2 className="w-3.5 h-3.5" />
                  )}
                  <span>Enable Link Sharing</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
