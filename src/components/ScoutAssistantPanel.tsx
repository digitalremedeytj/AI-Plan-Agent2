import React from "react";
import Markdown from "react-markdown";
import { AlertTriangle, ArrowRight, BarChart3, Check, ChevronDown, Eye, EyeOff, FileText, Loader2, RotateCcw, Send, Sparkles, Trash2, X } from "lucide-react";
import * as api from "../api/client";
import { ApiError, type AssistantOp, type ChatTurn, type FollowUp, type ProposalChange, type ScoutProposal } from "../api/client";
import type { AudienceProfile } from "../types";
import { PlanText } from "./PlanText";
import { PastPerformanceModal } from "./PastPerformanceModal";

// The ScoutAI chat in the plan's left column. The conversation lives for the browser session
// only (sessionStorage, per plan): it is a working aid, not part of the plan. Everything that
// changes the plan goes through a proposal card, and nothing is saved until the planner applies it.
// A proposal holds one or more recommendations; the planner keeps the ones they want.

type ProposalStatus = "pending" | "applying" | "applied" | "dismissed" | "reverting" | "reverted" | "failed";

interface ProposalState extends ScoutProposal {
  status: ProposalStatus;
  /** Item ids the planner has kept. */
  selected: string[];
  /** The combined dry run for `selected`, when it is not every item. */
  selection?: { key: string; changes: ProposalChange[]; rejected: string[] } | null;
  selectionLoading?: boolean;
  error?: string;
  errorReasons?: string[];
  /** Set once applied: what was saved, and the operations that undo it while the plan is still at `appliedRevision`. */
  appliedChanges?: ProposalChange[];
  revertOps?: AssistantOp[];
  appliedRevision?: number;
  followUps?: FollowUp[];
  doneFollowUps?: string[];
}

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  proposal?: ProposalState;
  /** A suggested executive summary rewrite, which runs the summary's own generator. */
  summaryRewrite?: { instructions: string; status: "pending" | "started" | "dismissed" };
  isError?: boolean;
}

export interface ScoutPreview {
  proposalId: string;
  changes: ProposalChange[];
}

/** Follow-ups the plan view carries out. */
export type ScoutFollowUpAction = "executive_summary" | "qa_audit" | "regenerate_plan";

interface Props {
  planId: string;
  /** The plan's advertiser, whose library of past campaigns can be linked to it. */
  advertiserName: string;
  profile: AudienceProfile;
  /** The revision on screen. Proposals made against another revision cannot be applied. */
  revision: number | null;
  /**
   * A save that changed nothing ScoutAI proposes against (a new headshot), from one revision to
   * the next. Proposals and reverts at `from` stay valid at `to`.
   */
  revisionBump: { from: number; to: number } | null;
  /** The workspace has edits that are not saved yet; ScoutAI reads and edits the saved plan. */
  hasUnsavedChanges: boolean;
  isVisible: boolean;
  isBriefStale: boolean;
  hasAudit: boolean;
  onApplied: (plan: api.StoredPlan) => void;
  onFollowUp: (action: ScoutFollowUpAction, instructions?: string) => void;
  onUnread: (unread: boolean) => void;
  preview: ScoutPreview | null;
  onPreview: (preview: ScoutPreview | null) => void;
}

const storageKey = (planId: string) => `scoutai_chat_${planId}`;
const newId = () => Math.random().toString(36).slice(2, 10);
const MAX_INPUT_LINES = 4;

function loadMessages(planId: string): Message[] {
  try {
    const raw = sessionStorage.getItem(storageKey(planId));
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    // Proposals saved before recommendation sets have no items and cannot be applied; an apply
    // or revert interrupted by a reload did not finish from this page's point of view.
    return parsed.map((m: Message) => {
      if (!m.proposal) return m;
      if (!Array.isArray(m.proposal.items)) return { ...m, proposal: undefined };
      const status = m.proposal.status === "applying" ? "pending" : m.proposal.status === "reverting" ? "applied" : m.proposal.status;
      return { ...m, proposal: { ...m.proposal, status, selectionLoading: false } };
    });
  } catch {
    return [];
  }
}

function saveMessages(planId: string, messages: Message[]) {
  try {
    sessionStorage.setItem(storageKey(planId), JSON.stringify(messages.slice(-40)));
  } catch {
    // Storage full or blocked: the chat still works, it just won't survive a reload.
  }
}

const TURN_STATUS: Record<ProposalStatus, NonNullable<ChatTurn["proposal"]>["status"]> = {
  pending: "pending", applying: "pending", applied: "applied", dismissed: "dismissed",
  reverting: "applied", reverted: "reverted", failed: "failed",
};

function toTurns(messages: Message[]): ChatTurn[] {
  return messages.filter((m) => !m.isError).map((m) => {
    if (m.summaryRewrite) {
      const status = m.summaryRewrite.status === "started" ? "applied" : m.summaryRewrite.status;
      return { role: m.role, text: m.text, proposal: { summary: `Rewrite the executive summary: ${m.summaryRewrite.instructions}`, status } };
    }
    if (!m.proposal) return { role: m.role, text: m.text };
    const p = m.proposal;
    const kept = p.items.filter((item) => p.selected.includes(item.id)).map((item) => item.title);
    const summary = p.items.length > 1 && p.status === "applied" ? `${p.summary} (applied only: ${kept.join("; ")})` : p.summary;
    return { role: m.role, text: m.text, proposal: { summary, status: TURN_STATUS[p.status] } };
  });
}

/** "Live · day 30 of 50 · 47% spent · CPA $23.72 vs $30 target" */
function liveSummary(p: api.PlanVsActual): string {
  const money = (v: number) => (v < 100 ? `$${v.toFixed(2)}` : `$${Math.round(v).toLocaleString("en-US")}`);
  const kpi = p.target?.metric === "roas"
    ? `ROAS ${p.actual.roas !== null ? `${p.actual.roas.toFixed(2)}x` : "n/a"} vs ${p.target.value.toFixed(2)}x target`
    : `CPA ${p.actual.cpa !== null ? money(p.actual.cpa) : "n/a"}${p.target ? ` vs ${money(p.target.value)} target` : ""}`;
  return [`Live`, p.daysElapsed !== null && p.flight ? `day ${p.daysElapsed} of ${p.flight.days}` : "", `${Math.round(p.spendShare * 100)}% spent`, kpi].filter(Boolean).join(" · ");
}

function suggestedPrompts(profile: AudienceProfile, pastPerformance: "none" | "reference" | "own", hasLive = false): string[] {
  const channels = profile.channelStrategy?.mediaPlan?.channels || [];
  const largest = [...channels].sort((a, b) => b.allocationPercent - a.allocationPercent)[0];
  const openFindings = (profile.auditResult?.findings || []).filter((f) => f.status !== "resolved").length;
  return [
    hasLive ? "How is the live campaign tracking against the plan, and what should we change?" : "",
    pastPerformance !== "none" && !hasLive ? "Analyse our past campaign: what worked, what didn't, and what should this plan change?" : "",
    pastPerformance === "own" && !(profile.performanceLearnings || []).length ? "Draft the client-facing learnings from our past campaign" : "",
    "What would you change to improve performance toward our KPIs?",
    "Does this plan deliver what the brief asked for?",
    largest ? `Why does ${largest.channelName} get ${Math.round(largest.allocationPercent)}% of the budget?` : "",
    openFindings > 0 ? `How should we handle the ${openFindings} open QA finding${openFindings === 1 ? "" : "s"}?` : "Which persona fits the brief least well, and what would you replace it with?",
  ].filter(Boolean).slice(0, 4);
}

const selectionKey = (ids: string[]) => [...ids].sort().join("|");

const KIND_TAG: Partial<Record<ProposalChange["kind"], string>> = {
  channel_added: "Added", channel_removed: "Removed", budget: "Budget", lock: "Lock", publisher: "Publisher",
  persona_added: "New persona", persona_removed: "Removed", segment_added: "New segment", segment_removed: "Removed",
};

function ChangeRow({ change }: { change: ProposalChange }) {
  const [expanded, setExpanded] = React.useState(false);
  const tag = KIND_TAG[change.kind] && <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wide text-slate-400">{KIND_TAG[change.kind]}</span>;
  // Long values (text, persona narratives, brief fields) read better stacked than side by side.
  if (change.before.length > 26 || change.after.length > 26) {
    const removed = change.kind.endsWith("_removed");
    const added = change.kind.endsWith("_added");
    return (
      <li className="py-2 first:pt-0 last:pb-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-slate-700">{change.label}{tag}</span>
          {!added && !removed && (
            <button onClick={() => setExpanded((v) => !v)} className="shrink-0 text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer">
              {expanded ? "Less" : "Compare"}
            </button>
          )}
        </div>
        <PlanText
          text={removed ? change.before : change.after}
          className={`mt-1 text-[11px] leading-relaxed rounded-md px-2 py-1 ${removed ? "text-rose-800 bg-rose-50/70" : "text-emerald-800 bg-emerald-50/70"} ${expanded ? "" : "line-clamp-3"}`}
        />
        {expanded && <PlanText text={change.before} className="mt-1 text-[11px] leading-relaxed text-slate-500 line-through decoration-slate-300 bg-slate-50 rounded-md px-2 py-1" />}
      </li>
    );
  }
  return (
    <li className="py-1.5 first:pt-0 last:pb-0 flex items-center gap-2 text-[11px]">
      <span className="min-w-0 flex-1 truncate font-semibold text-slate-700" title={change.label}>{change.label}{tag}</span>
      <span className="shrink-0 text-slate-400 line-through decoration-slate-300 tabular-nums">{change.before}</span>
      <ArrowRight className="w-3 h-3 shrink-0 text-slate-300" />
      <span className="shrink-0 font-semibold text-indigo-700 tabular-nums">{change.after}</span>
    </li>
  );
}

function ChangeList({ changes }: { changes: ProposalChange[] }) {
  return <ul className="divide-y divide-slate-100">{changes.map((change, i) => <ChangeRow key={`${change.label}-${i}`} change={change} />)}</ul>;
}

function Notice({ tone = "amber", children }: { tone?: "amber" | "rose"; children: React.ReactNode }) {
  return <div className={`text-[10px] leading-snug rounded-md px-2 py-1 ${tone === "rose" ? "text-rose-700 bg-rose-50" : "text-amber-800 bg-amber-50"}`}>{children}</div>;
}

interface FollowUpRow {
  key: string;
  label: string;
  actionLabel: string;
  run: () => void;
}

function ProposalCard({
  proposal, isStale, hasUnsavedChanges, canRevert, isPreviewing, followUps,
  onToggleItem, onApply, onDismiss, onRevert, onPreview, onRepropose,
}: {
  proposal: ProposalState;
  isStale: boolean;
  hasUnsavedChanges: boolean;
  canRevert: boolean;
  isPreviewing: boolean;
  followUps: FollowUpRow[];
  onToggleItem: (id: string) => void;
  onApply: () => void;
  onDismiss: () => void;
  onRevert: () => void;
  onPreview: () => void;
  onRepropose: () => void;
}) {
  const [openItems, setOpenItems] = React.useState<string[]>([]);
  const [showCombined, setShowCombined] = React.useState(false);
  const { status, items } = proposal;
  const multi = items.length > 1;
  const open = status === "pending" || status === "failed";
  const combined = proposal.selected.length === items.length
    ? { changes: proposal.changes, rejected: proposal.rejected }
    : proposal.selection?.key === selectionKey(proposal.selected) ? proposal.selection : null;
  const blocked = !open || isStale || hasUnsavedChanges || proposal.selected.length === 0 || Boolean(proposal.selectionLoading);
  const canPreview = (combined?.changes || []).some((c) => c.channelId || c.kind === "budget");
  const settled = status === "applied" || status === "reverted" || status === "reverting";

  return (
    <div className={`mt-2 rounded-xl border bg-white shadow-xs overflow-hidden ${status === "applied" ? "border-emerald-200" : status === "dismissed" || status === "reverted" ? "border-slate-200 opacity-70" : "border-indigo-200"}`}>
      <div className={`px-3 py-2 flex items-start gap-1.5 border-b ${status === "applied" ? "bg-emerald-50/70 border-emerald-100" : "bg-indigo-50/60 border-indigo-100"}`}>
        {status === "applied" ? <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-px" /> : <Sparkles className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-px" />}
        <span className="text-[11px] font-bold text-slate-800 leading-snug">{proposal.summary}</span>
      </div>

      {settled ? (
        <div className="px-3 py-2"><ChangeList changes={proposal.appliedChanges || proposal.changes} /></div>
      ) : multi ? (
        <ul className="px-3 py-2 space-y-2">
          {items.map((item, index) => {
            const checked = proposal.selected.includes(item.id);
            const expanded = openItems.includes(item.id);
            return (
              <li key={item.id} className={`rounded-lg border px-2.5 py-2 transition-colors ${checked ? "border-indigo-200 bg-indigo-50/30" : "border-slate-100 bg-white"}`}>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!open}
                    onChange={() => onToggleItem(item.id)}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-indigo-600 cursor-pointer"
                  />
                  <span className="min-w-0">
                    <span className="block text-[11px] font-bold text-slate-800 leading-snug">{index + 1}. {item.title}</span>
                    {item.why && <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-600">{item.why}</span>}
                    {item.evidence && (
                      <span className="mt-1 flex items-start gap-1 rounded-md bg-indigo-50/70 border border-indigo-100 px-1.5 py-1 text-[10px] leading-snug text-indigo-900">
                        <BarChart3 className="w-3 h-3 shrink-0 mt-px text-indigo-500" /> <span><span className="font-bold">From the campaign data:</span> {item.evidence}</span>
                      </span>
                    )}
                    {item.unverifiedFigures && item.unverifiedFigures.length > 0 && (
                      <span className="mt-1 flex items-start gap-1 rounded-md bg-amber-50 border border-amber-200 px-1.5 py-1 text-[10px] leading-snug text-amber-900">
                        <AlertTriangle className="w-3 h-3 shrink-0 mt-px text-amber-600" />
                        <span>Not in the campaign data or the plan: {item.unverifiedFigures.join(", ")}. Check before applying.</span>
                      </span>
                    )}
                  </span>
                </label>
                <button
                  onClick={() => setOpenItems((prev) => (expanded ? prev.filter((id) => id !== item.id) : [...prev, item.id]))}
                  className="mt-1 ml-5 flex items-center gap-0.5 text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                >
                  <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
                  {item.changes.length} change{item.changes.length === 1 ? "" : "s"}
                </button>
                {expanded && <div className="mt-1.5 ml-5"><ChangeList changes={item.changes} /></div>}
                {expanded && item.rejected.length > 0 && <div className="mt-1.5 ml-5"><Notice>Not included: {item.rejected.join("; ")}</Notice></div>}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="px-3 py-2">
          {items[0]?.why && <p className="mb-2 text-[11px] leading-relaxed text-slate-600">{items[0].why}</p>}
          <ChangeList changes={items[0]?.changes || []} />
        </div>
      )}

      <div className="px-3 pb-2 space-y-1.5 empty:hidden">
        {multi && open && proposal.selected.length > 0 && (
          <div className="rounded-lg bg-slate-50 px-2.5 py-2">
            <button onClick={() => setShowCombined((v) => !v)} className="flex w-full items-center justify-between text-[10px] font-bold text-slate-600 cursor-pointer">
              <span>
                {proposal.selectionLoading
                  ? "Working out the combined result…"
                  : combined ? `What Apply will save: ${combined.changes.length} change${combined.changes.length === 1 ? "" : "s"}` : "What Apply will save"}
              </span>
              <ChevronDown className={`w-3 h-3 transition-transform ${showCombined ? "rotate-180" : ""}`} />
            </button>
            {showCombined && combined && <div className="mt-1.5"><ChangeList changes={combined.changes} /></div>}
          </div>
        )}
        {open && combined && combined.rejected.length > 0 && !multi && <Notice>Not included: {combined.rejected.join("; ")}</Notice>}
        {status === "failed" && proposal.error && (
          <Notice tone="rose">
            {proposal.error}
            {proposal.errorReasons?.length ? <span className="block mt-0.5">{proposal.errorReasons.join("; ")}</span> : null}
          </Notice>
        )}
        {open && isStale && (
          <Notice>
            The plan has changed since this was proposed.{" "}
            <button onClick={onRepropose} className="font-bold underline cursor-pointer">Ask ScoutAI to propose it again</button>
          </Notice>
        )}
        {open && !isStale && hasUnsavedChanges && <Notice>Save your other changes to the plan before applying this one.</Notice>}
      </div>

      <div className="px-3 pb-3 flex items-center gap-1.5">
        {open && (
          <>
            <button
              onClick={onApply}
              disabled={blocked}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white text-[11px] font-bold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              <Check className="w-3 h-3" /> {multi ? `Apply ${proposal.selected.length} & save` : "Apply & save"}
            </button>
            {canPreview && (
              <button
                onClick={onPreview}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold cursor-pointer transition-colors ${isPreviewing ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
              >
                {isPreviewing ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />} {isPreviewing ? "Hide" : "Preview"}
              </button>
            )}
            <button onClick={onDismiss} className="ml-auto flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-50 cursor-pointer">
              <X className="w-3 h-3" /> Dismiss
            </button>
          </>
        )}
        {(status === "applying" || status === "reverting") && (
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-700">
            <Loader2 className="w-3 h-3 animate-spin" /> {status === "applying" ? "Applying and saving…" : "Reverting…"}
          </span>
        )}
        {status === "applied" && (
          <>
            <span className="text-[11px] font-semibold text-emerald-700">
              {multi ? `Applied ${proposal.selected.length} of ${items.length} and saved` : "Applied and saved"}
            </span>
            {canRevert ? (
              <button onClick={onRevert} className="ml-auto flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-50 cursor-pointer">
                <RotateCcw className="w-3 h-3" /> Revert
              </button>
            ) : (
              <span className="ml-auto text-[10px] text-slate-400" title="The plan has changed since, so this can no longer be reverted on its own.">Can't revert now</span>
            )}
          </>
        )}
        {status === "dismissed" && <span className="text-[11px] font-semibold text-slate-400">Dismissed</span>}
        {status === "reverted" && <span className="text-[11px] font-semibold text-slate-400">Reverted</span>}
      </div>

      {status === "applied" && followUps.length > 0 && (
        <div className="border-t border-amber-100 bg-amber-50/50 px-3 py-2">
          <div className="text-[10px] font-bold uppercase tracking-wide text-amber-800">Now out of date</div>
          <ul className="mt-1 space-y-1.5">
            {followUps.map((f) => (
              <li key={f.key} className="flex items-start justify-between gap-2">
                <span className="text-[11px] leading-snug text-slate-700">{f.label}</span>
                <button onClick={f.run} className="shrink-0 rounded-md border border-amber-200 bg-white px-2 py-0.5 text-[10px] font-bold text-amber-800 hover:bg-amber-50 cursor-pointer">
                  {f.actionLabel}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ScoutAssistantPanel({
  planId, advertiserName, profile, revision, revisionBump, hasUnsavedChanges, isVisible, isBriefStale, hasAudit,
  onApplied, onFollowUp, onUnread, preview, onPreview,
}: Props) {
  const [messages, setMessages] = React.useState<Message[]>(() => loadMessages(planId));
  const [draft, setDraft] = React.useState("");
  const [isThinking, setIsThinking] = React.useState(false);
  const [thought, setThought] = React.useState<string | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const visibleRef = React.useRef(isVisible);
  visibleRef.current = isVisible;
  const [pastCampaigns, setPastCampaigns] = React.useState<api.PerformanceCampaignSummary[]>([]);
  const [live, setLive] = React.useState<api.PlanVsActual | null>(null);
  const [showPastPerformance, setShowPastPerformance] = React.useState(false);
  const loadPastCampaigns = React.useCallback(() => {
    api.listPerformanceCampaigns({ planId }).then(setPastCampaigns).catch(() => setPastCampaigns([]));
    api.getPlanLive(planId).then((l) => setLive(l?.comparison ?? null)).catch(() => setLive(null));
  }, [planId]);
  React.useEffect(loadPastCampaigns, [loadPastCampaigns]);

  React.useEffect(() => saveMessages(planId, messages), [planId, messages]);
  React.useEffect(() => () => abortRef.current?.abort(), []);
  React.useEffect(() => {
    if (isVisible) {
      onUnread(false);
      inputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible]);
  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, thought, isThinking]);

  // Grow the input with its wrapped content, one line at a time, then scroll past MAX_INPUT_LINES.
  const fitInput = React.useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const cs = getComputedStyle(el);
    const max = parseFloat(cs.lineHeight) * MAX_INPUT_LINES + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, []);
  React.useLayoutEffect(fitInput, [draft, fitInput]);
  // Re-wrap when the panel width changes (column resize, or the panel becoming visible).
  React.useEffect(() => {
    const el = inputRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fitInput();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fitInput]);

  // A headshot save moved the revision without touching anything a proposal or revert reads.
  React.useEffect(() => {
    if (!revisionBump) return;
    setMessages((prev) => prev.map((m) => {
      if (!m.proposal) return m;
      const p = m.proposal;
      const baseRevision = p.baseRevision === revisionBump.from && (p.status === "pending" || p.status === "failed") ? revisionBump.to : p.baseRevision;
      const appliedRevision = p.appliedRevision === revisionBump.from ? revisionBump.to : p.appliedRevision;
      return baseRevision === p.baseRevision && appliedRevision === p.appliedRevision ? m : { ...m, proposal: { ...p, baseRevision, appliedRevision } };
    }));
  }, [revisionBump]);

  const updateProposal = (messageId: string, patch: Partial<ProposalState> | ((p: ProposalState) => Partial<ProposalState>)) => {
    setMessages((prev) => prev.map((m) => (m.id === messageId && m.proposal
      ? { ...m, proposal: { ...m.proposal, ...(typeof patch === "function" ? patch(m.proposal) : patch) } }
      : m)));
  };

  const selectedOps = (p: ProposalState) => p.items.filter((item) => p.selected.includes(item.id)).flatMap((item) => item.ops);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || isThinking) return;
    const userMessage: Message = { id: newId(), role: "user", text: content };
    const history = [...messages, userMessage];
    setMessages(history);
    setDraft("");
    setIsThinking(true);
    setThought(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await api.askScout(planId, toTurns(history), (line) => setThought(line), controller.signal);
      setMessages((prev) => [...prev, {
        id: newId(),
        role: "assistant",
        text: result.reply,
        ...(result.proposal ? { proposal: { ...result.proposal, status: "pending" as const, selected: result.proposal.items.map((item) => item.id) } } : {}),
        ...(result.executiveSummaryInstructions ? { summaryRewrite: { instructions: result.executiveSummaryInstructions, status: "pending" as const } } : {}),
      }]);
      if (!visibleRef.current) onUnread(true);
    } catch (err: any) {
      if (controller.signal.aborted) return;
      setMessages((prev) => [...prev, { id: newId(), role: "assistant", text: err?.message || "ScoutAI couldn't answer just now. Please try again.", isError: true }]);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setIsThinking(false);
      setThought(null);
    }
  };

  const toggleItem = async (message: Message, itemId: string) => {
    const p = message.proposal!;
    const selected = p.selected.includes(itemId) ? p.selected.filter((id) => id !== itemId) : [...p.selected, itemId];
    const key = selectionKey(selected);
    const needsDryRun = selected.length > 0 && selected.length < p.items.length && p.selection?.key !== key;
    updateProposal(message.id, { selected, selectionLoading: needsDryRun });
    if (preview?.proposalId === message.id) onPreview(null);
    if (!needsDryRun) return;
    try {
      const ops = p.items.filter((item) => selected.includes(item.id)).flatMap((item) => item.ops);
      const result = await api.previewScoutChange(planId, { ops, baseRevision: p.baseRevision });
      // Only keep the answer if the planner has not changed the selection again meanwhile.
      updateProposal(message.id, (current) => (selectionKey(current.selected) === key ? { selection: { key, ...result }, selectionLoading: false } : {}));
    } catch {
      updateProposal(message.id, (current) => (selectionKey(current.selected) === key ? { selectionLoading: false, selection: null } : {}));
    }
  };

  const apply = async (message: Message) => {
    const proposal = message.proposal;
    if (!proposal) return;
    updateProposal(message.id, { status: "applying", error: undefined, errorReasons: undefined });
    try {
      const result = await api.applyScoutChange(planId, { ops: selectedOps(proposal), baseRevision: proposal.baseRevision });
      if (preview?.proposalId === message.id) onPreview(null);
      // The saved result is authoritative; show what the server applied.
      updateProposal(message.id, {
        status: "applied",
        appliedChanges: result.changes,
        revertOps: result.revertOps,
        appliedRevision: result.plan.revision,
        followUps: result.followUps,
        doneFollowUps: [],
      });
      onApplied(result.plan);
    } catch (err: any) {
      updateProposal(message.id, {
        status: "failed",
        error: err instanceof ApiError && err.isConflict ? "The plan changed after this was proposed, so nothing was saved." : err?.message || "The change could not be applied.",
        errorReasons: err instanceof ApiError ? err.reasons : undefined,
      });
    }
  };

  const revert = async (message: Message) => {
    const proposal = message.proposal;
    if (!proposal?.revertOps?.length || proposal.appliedRevision == null) return;
    updateProposal(message.id, { status: "reverting" });
    try {
      const result = await api.applyScoutChange(planId, { ops: proposal.revertOps, baseRevision: proposal.appliedRevision, revert: true });
      updateProposal(message.id, { status: "reverted", revertOps: undefined, followUps: [] });
      onApplied(result.plan);
    } catch (err: any) {
      updateProposal(message.id, { status: "applied" });
      setMessages((prev) => [...prev, {
        id: newId(),
        role: "assistant",
        isError: true,
        text: err instanceof ApiError && err.isConflict
          ? "That change can't be reverted on its own any more: the plan has changed since it was applied."
          : `The revert didn't go through: ${err?.message || err}`,
      }]);
    }
  };

  const clearChat = () => {
    abortRef.current?.abort();
    onPreview(null);
    setMessages([]);
    setIsThinking(false);
    setThought(null);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send(draft);
    }
  };

  // Only the most recent applied change can be reverted, and only while nothing has been saved since.
  const lastAppliedId = [...messages].reverse().find((m) => m.proposal?.status === "applied")?.id;

  const followUpRows = (message: Message): FollowUpRow[] => {
    const p = message.proposal!;
    const done = new Set(p.doneFollowUps || []);
    const markDone = (key: string) => updateProposal(message.id, (current) => ({ doneFollowUps: [...(current.doneFollowUps || []), key] }));
    const rows: FollowUpRow[] = (p.followUps || []).map((f, i) => {
      const key = `${f.kind}-${i}`;
      return f.kind === "regenerate_plan"
        ? { key, label: `${f.label}. Regenerating rebuilds them from the current version.`, actionLabel: "Regenerate plan", run: () => { markDone(key); onFollowUp("regenerate_plan"); } }
        : { key, label: f.label, actionLabel: "Ask ScoutAI", run: () => { markDone(key); send(f.prompt || f.label); } };
    });
    // The executive summary and QA score matter only for the change that made them stale: the latest.
    if (message.id === lastAppliedId) {
      if (isBriefStale) rows.push({ key: "executive_summary", label: "The executive summary describes the plan before this change", actionLabel: "Regenerate", run: () => { markDone("executive_summary"); onFollowUp("executive_summary"); } });
      if (hasAudit) rows.push({ key: "qa_audit", label: "The QA score was given before this change", actionLabel: "Re-run QA", run: () => { markDone("qa_audit"); onFollowUp("qa_audit"); } });
    }
    return rows.filter((row) => !done.has(row.key));
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 flex items-center gap-2 border-b border-slate-100 px-4 py-2 bg-slate-50/60">
        <BarChart3 className={`w-3.5 h-3.5 shrink-0 ${live ? "text-emerald-600" : "text-indigo-500"}`} />
        <span className="flex-1 min-w-0 truncate text-[11px] text-slate-600" title={pastCampaigns.map((c) => c.name).join(", ")}>
          {live
            ? liveSummary(live)
            : pastCampaigns.length === 0
              ? "No past campaign data linked"
              : `Past performance: ${pastCampaigns.length === 1 ? pastCampaigns[0].name : `${pastCampaigns.length} campaigns`}`}
        </span>
        <button onClick={() => setShowPastPerformance(true)} className="shrink-0 text-[11px] font-bold text-indigo-700 hover:text-indigo-900 cursor-pointer">
          {pastCampaigns.length === 0 ? "Add reports" : "Manage"}
        </button>
      </div>
      <PastPerformanceModal
        isOpen={showPastPerformance}
        onClose={() => setShowPastPerformance(false)}
        planId={planId}
        advertiserName={advertiserName}
        onChanged={loadPastCampaigns}
      />
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-4 py-3 space-y-3">
        {messages.length === 0 && !isThinking ? (
          <div className="pt-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-indigo-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-800">Ask ScoutAI about this plan</p>
                <p className="text-[11px] text-slate-500">It has read the plan, the Brief of Record, the research{pastCampaigns.length ? ", the linked past campaign data" : ""} and what you asked for.</p>
              </div>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
              Ask why the plan looks the way it does, check it against the brief, or ask for changes and recommendations: channels, budget, personas, segments, the brief and the plan's text. Nothing is saved until you apply it.
            </p>
            <div className="mt-4 flex flex-col gap-1.5">
              {suggestedPrompts(profile, pastCampaigns.length === 0 ? "none" : pastCampaigns.some((c) => c.advertiserKey === advertiserName.trim().toLowerCase().replace(/\s+/g, " ")) ? "own" : "reference", Boolean(live)).map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => send(prompt)}
                  className="text-left text-[11px] font-medium text-slate-700 bg-slate-50 hover:bg-indigo-50 hover:text-indigo-800 border border-slate-100 hover:border-indigo-200 rounded-lg px-3 py-2 cursor-pointer transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => message.role === "user" ? (
            <div key={message.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-indigo-600 text-white text-xs leading-relaxed px-3 py-2 whitespace-pre-wrap break-words">
                {message.text}
              </div>
            </div>
          ) : (
            <div key={message.id} className="max-w-full">
              {message.isError ? (
                <div className="flex items-start gap-1.5 text-[11px] leading-relaxed text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> <span>{message.text}</span>
                </div>
              ) : (
                <div className="scout-markdown text-xs leading-relaxed text-slate-700">
                  <Markdown>{message.text}</Markdown>
                </div>
              )}
              {message.summaryRewrite && (
                <div className={`mt-2 rounded-xl border bg-white shadow-xs px-3 py-2.5 ${message.summaryRewrite.status === "pending" ? "border-indigo-200" : "border-slate-200 opacity-70"}`}>
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-800">
                    <FileText className="w-3.5 h-3.5 text-indigo-500" /> Rewrite the executive summary
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-600">{message.summaryRewrite.instructions}</p>
                  {message.summaryRewrite.status === "pending" ? (
                    <div className="mt-2 flex items-center gap-1.5">
                      <button
                        onClick={() => {
                          onFollowUp("executive_summary", message.summaryRewrite!.instructions);
                          setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, summaryRewrite: { ...m.summaryRewrite!, status: "started" } } : m)));
                        }}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white text-[11px] font-bold hover:bg-indigo-700 cursor-pointer"
                      >
                        <Sparkles className="w-3 h-3" /> Rewrite summary
                      </button>
                      <button
                        onClick={() => setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, summaryRewrite: { ...m.summaryRewrite!, status: "dismissed" } } : m)))}
                        className="ml-auto flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-50 cursor-pointer"
                      >
                        <X className="w-3 h-3" /> Dismiss
                      </button>
                    </div>
                  ) : (
                    <p className="mt-1.5 text-[10px] font-semibold text-slate-400">
                      {message.summaryRewrite.status === "started" ? "Rewriting in the Executive Summary section. Its Undo restores the previous version." : "Dismissed"}
                    </p>
                  )}
                </div>
              )}
              {message.proposal && (
                <ProposalCard
                  proposal={message.proposal}
                  isStale={revision !== null && message.proposal.baseRevision !== revision}
                  hasUnsavedChanges={hasUnsavedChanges}
                  canRevert={message.id === lastAppliedId && message.proposal.appliedRevision === revision && Boolean(message.proposal.revertOps?.length)}
                  isPreviewing={preview?.proposalId === message.id}
                  followUps={message.proposal.status === "applied" ? followUpRows(message) : []}
                  onToggleItem={(id) => toggleItem(message, id)}
                  onApply={() => apply(message)}
                  onDismiss={() => {
                    if (preview?.proposalId === message.id) onPreview(null);
                    updateProposal(message.id, { status: "dismissed" });
                  }}
                  onRevert={() => revert(message)}
                  onPreview={() => {
                    const p = message.proposal!;
                    const changes = p.selected.length === p.items.length ? p.changes : p.selection?.changes || [];
                    onPreview(preview?.proposalId === message.id ? null : { proposalId: message.id, changes });
                  }}
                  onRepropose={() => send(`The plan has changed since your last proposal ("${message.proposal!.summary}"). Please propose it again against the current plan.`)}
                />
              )}
            </div>
          ))
        )}
        {isThinking && (
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500 shrink-0" />
            <span className="truncate">{thought || "Reading the plan…"}</span>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-slate-100 p-3 bg-white">
        {hasUnsavedChanges && (
          <p className="mb-2 text-[10px] leading-snug text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5">
            You have unsaved changes. ScoutAI reads the last saved version of this plan.
          </p>
        )}
        <div className="flex items-end gap-2 rounded-xl border border-slate-200 focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100 bg-white px-2.5 py-2 transition-all">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Ask about or change this plan…"
            className="flex-1 resize-none overflow-y-hidden bg-transparent text-xs leading-snug text-slate-800 placeholder:text-slate-400 outline-none"
          />
          <button
            onClick={() => send(draft)}
            disabled={!draft.trim() || isThinking}
            aria-label="Send"
            className="w-7 h-7 shrink-0 flex items-center justify-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-[10px] text-slate-400">ScoutAI can make mistakes. Review every change.</span>
          {messages.length > 0 && (
            <button onClick={clearChat} className="flex items-center gap-1 text-[10px] font-semibold text-slate-400 hover:text-slate-700 cursor-pointer">
              <Trash2 className="w-3 h-3" /> Clear chat
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
