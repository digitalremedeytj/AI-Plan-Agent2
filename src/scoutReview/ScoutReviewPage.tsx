import React from "react";
import Markdown from "react-markdown";
import {
  AlertTriangle, ArrowRight, CalendarDays, Check, Clock, Loader2, Lock, MessageSquare, RotateCcw, Search, ShieldCheck, ThumbsDown, ThumbsUp, X,
} from "lucide-react";
import * as api from "../api/client";
import { ApiError } from "../api/client";
import type { ScoutLog } from "../storage/types";
import drIconWhite from "../images/dr-icon-white.png";
import { presetDays, RANGE_PRESETS, rangeFromDates, toDateInput, type RangePreset } from "../dashboard/dashboardFormat";
import {
  conversationOf, EMPTY_FILTERS, filterOptions, filterScoutLogs, formatDuration, KIND_LABELS, summarizeScoutLogs, type ReviewFilters,
} from "./scoutReviewData";

/**
 * The ScoutAI review page at /scout-review: every planner's ScoutAI questions and answers, for
 * admins to judge answer quality and see what planners ask.
 *
 * Its own page rather than a Settings tab: a list beside a whole conversation needs the full
 * window, and admins keep it open in a tab while they work through answers, as with /dashboard.
 * The server decides who may read it (GET /api/scout-logs is requireAdmin); this page only shows
 * what that answer allows.
 */

const PAGE_LIMIT = 1000;

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function Thumb({ rating, label }: { rating: "up" | "down"; label: string }) {
  const Icon = rating === "up" ? ThumbsUp : ThumbsDown;
  return (
    <span
      title={label}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${rating === "up" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function Badges({ log }: { log: ScoutLog }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {!log.ok ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-800"><AlertTriangle className="h-3 w-3" /> Failed</span>
      ) : null}
      {log.feedback ? <Thumb rating={log.feedback.rating} label="Planner" /> : null}
      {log.review ? <Thumb rating={log.review.rating} label="Review" /> : null}
      {log.outcome ? (
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${log.outcome.status === "applied" ? "bg-brand-teal-50 text-brand-teal-700" : "bg-amber-50 text-amber-800"}`}>
          {log.outcome.status === "applied" ? <Check className="h-3 w-3" /> : <RotateCcw className="h-3 w-3" />}
          {log.outcome.status === "applied" ? `Applied ${log.outcome.changes}` : "Undone"}
        </span>
      ) : log.proposal ? (
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{log.proposal.items.length} proposed</span>
      ) : null}
    </div>
  );
}

function Stat({ label, value, footnote }: { label: string; value: string; footnote?: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold tabular-nums text-slate-900">{value}</p>
      {footnote ? <p className="mt-1 text-xs text-slate-500">{footnote}</p> : null}
    </div>
  );
}

function Select<T extends string>({ label, value, onChange, options }: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-medium normal-case tracking-normal text-slate-800 focus:border-brand-purple-400 focus:outline-none"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

/** The reviewer's own thumbs and notes on one answer. Never shown as, or saved over, the planner's. */
function ReviewControls({ log, onSaved }: { log: ScoutLog; onSaved: (log: ScoutLog) => void }) {
  const [rating, setRating] = React.useState<"up" | "down" | null>(log.review?.rating ?? null);
  const [notes, setNotes] = React.useState(log.review?.notes ?? "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    setRating(log.review?.rating ?? null);
    setNotes(log.review?.notes ?? "");
    setError(null);
  }, [log.id, log.review?.rating, log.review?.notes]);

  const dirty = rating !== (log.review?.rating ?? null) || notes.trim() !== (log.review?.notes ?? "");
  const save = async (nextRating: "up" | "down" | null, nextNotes: string) => {
    setSaving(true);
    setError(null);
    try {
      onSaved(await api.reviewScoutAnswer(log.id, nextRating, nextRating ? nextNotes.trim() : undefined));
    } catch (err: any) {
      setError(err?.message || "The review could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-brand-purple-100 bg-brand-purple-50/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-bold text-brand-purple-900"><ShieldCheck className="h-3.5 w-3.5" /> Your review</p>
        {log.review ? <p className="text-[11px] text-slate-500">Last set by {log.review.by}, {formatWhen(log.review.at)}</p> : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {(["up", "down"] as const).map((r) => {
          const Icon = r === "up" ? ThumbsUp : ThumbsDown;
          const active = rating === r;
          return (
            <button
              key={r}
              type="button"
              aria-pressed={active}
              onClick={() => setRating(active ? null : r)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                active
                  ? r === "up" ? "border-emerald-300 bg-emerald-100 text-emerald-800" : "border-rose-300 bg-rose-100 text-rose-800"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {r === "up" ? "Good answer" : "Poor answer"}
            </button>
          );
        })}
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder="Notes: what was wrong or right about this answer (optional)"
        className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 focus:border-brand-purple-400 focus:outline-none"
      />
      {rating === null && notes.trim() ? <p className="mt-1 text-[11px] text-amber-700">Pick good or poor to save notes.</p> : null}
      {error ? <p className="mt-1 text-xs text-rose-700">{error}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={saving || !dirty || (rating === null && !log.review)}
          onClick={() => void save(rating, notes)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-purple-700 disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {rating === null && log.review ? "Clear review" : "Save review"}
        </button>
      </div>
    </div>
  );
}

function Turn({ log, selected, onSaved }: { log: ScoutLog; selected: boolean; onSaved: (log: ScoutLog) => void }) {
  const ref = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);
  return (
    <article ref={ref} className={`space-y-3 rounded-2xl border p-4 ${selected ? "border-brand-purple-300 ring-2 ring-brand-purple-100" : "border-slate-200"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span className="font-semibold text-slate-700">Turn {log.turn} · {log.actor} · {formatWhen(log.at)}</span>
        <span>{log.promptLabel} · {KIND_LABELS[log.kind]}</span>
      </div>
      <div className="rounded-xl bg-brand-purple-600 px-3 py-2 text-sm text-white whitespace-pre-wrap">{log.question}</div>

      {log.reply ? (
        <div className="scout-markdown rounded-xl bg-slate-50 px-3 py-2 text-sm leading-relaxed text-slate-700">
          <Markdown>{log.reply}</Markdown>
        </div>
      ) : null}

      {log.error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          <p className="font-bold">Failed ({log.error.code})</p>
          <p className="mt-0.5 whitespace-pre-wrap">{log.error.message}</p>
        </div>
      ) : null}

      {log.proposal ? (
        <div className="space-y-2 rounded-xl border border-slate-200 p-3">
          <p className="text-xs font-bold text-slate-800">Proposed changes{log.proposal.summary ? `: ${log.proposal.summary}` : ""}</p>
          {log.proposal.items.map((item, i) => (
            <div key={i} className="space-y-1 border-t border-slate-100 pt-2 first:border-0 first:pt-0">
              <p className="text-sm font-semibold text-slate-800">{item.title}</p>
              {item.why ? <p className="text-xs text-slate-600">{item.why}</p> : null}
              {item.evidence ? <p className="text-xs italic text-slate-500">{item.evidence}</p> : null}
              {item.changes.map((c, j) => (
                <div key={j} className="grid gap-1 rounded-lg bg-slate-50 px-2 py-1.5 text-xs sm:grid-cols-[minmax(0,10rem)_1fr]">
                  <span className="font-semibold text-slate-600">{c.label}</span>
                  <span className="flex min-w-0 flex-wrap items-start gap-1.5">
                    <span className="min-w-0 break-words text-slate-400 line-through decoration-slate-300">{c.before || "(empty)"}</span>
                    <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />
                    <span className="min-w-0 break-words font-semibold text-brand-purple-700">{c.after || "(empty)"}</span>
                  </span>
                </div>
              ))}
              {item.unverifiedFigures?.length ? <p className="text-[11px] text-amber-700">Unverified figures: {item.unverifiedFigures.join(", ")}</p> : null}
            </div>
          ))}
        </div>
      ) : null}

      {log.dropped?.length ? (
        <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="font-bold">Left out (the plan could not take these)</p>
          <ul className="mt-1 list-disc pl-4">{log.dropped.map((d, i) => <li key={i}>{d}</li>)}</ul>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> {formatDuration(log.durationMs)}</span>
        {log.model ? <span>{log.model}{log.thinkingLevel ? ` (${log.thinkingLevel} thinking)` : ""}</span> : null}
        {log.depth ? <span>{log.depth === "full" ? "Full campaign data" : "Review summary"}</span> : null}
        <span>Plan r{log.planRevision}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {log.feedback ? (
          <span className="inline-flex flex-wrap items-center gap-1.5 text-slate-600">
            <Thumb rating={log.feedback.rating} label="Planner" />
            {log.feedback.comment ? <span className="italic">“{log.feedback.comment}”</span> : null}
          </span>
        ) : <span className="text-slate-400">The planner did not rate this answer.</span>}
        {log.outcome ? (
          <span className="text-slate-600">
            · {log.outcome.status === "applied" ? `Applied ${log.outcome.changes} change(s)` : "Undone"} by {log.outcome.by}, {formatWhen(log.outcome.at)}
          </span>
        ) : null}
      </div>

      <ReviewControls log={log} onSaved={onSaved} />
    </article>
  );
}

export default function ScoutReviewPage() {
  const [preset, setPreset] = React.useState<RangePreset>("30d");
  const [days, setDays] = React.useState(() => presetDays("30d"));
  const [logs, setLogs] = React.useState<ScoutLog[] | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ready" | "signed-out" | "forbidden" | "error">("loading");
  const [error, setError] = React.useState<string | null>(null);
  const [filters, setFilters] = React.useState<ReviewFilters>(EMPTY_FILTERS);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  React.useEffect(() => { document.title = "ScoutAI Review · AI Plan Agent"; }, []);

  const load = React.useCallback(async () => {
    setStatus((s) => (s === "ready" ? "ready" : "loading"));
    setError(null);
    try {
      const range = rangeFromDates(days.fromDay, days.toDay);
      const span = Math.max(1, Math.ceil((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000));
      const result = await api.listScoutLogs({ days: span, until: range.to, limit: PAGE_LIMIT });
      // The server counts whole days back from `until`; trim to the chosen first day.
      setLogs(result.logs.filter((l) => l.at >= range.from));
      setStatus("ready");
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 401) setStatus("signed-out");
      else if (err instanceof ApiError && err.status === 403) setStatus("forbidden");
      else {
        setError(err?.message || "The ScoutAI log could not be loaded.");
        setStatus("error");
      }
    }
  }, [days]);
  React.useEffect(() => { void load(); }, [load]);

  const visible = React.useMemo(() => filterScoutLogs(logs ?? [], filters), [logs, filters]);
  const summary = React.useMemo(() => summarizeScoutLogs(visible), [visible]);
  const options = React.useMemo(() => filterOptions(logs ?? []), [logs]);
  const selected = React.useMemo(() => (logs ?? []).find((l) => l.id === selectedId) ?? null, [logs, selectedId]);
  // The whole chat comes from every loaded record, not just those the filters let through.
  const conversation = React.useMemo(() => (selected ? conversationOf(logs ?? [], selected) : null), [logs, selected]);

  const setFilter = <K extends keyof ReviewFilters>(key: K, value: ReviewFilters[K]) => setFilters((f) => ({ ...f, [key]: value }));
  const replaceLog = (updated: ScoutLog) => setLogs((current) => (current ?? []).map((l) => (l.id === updated.id ? updated : l)));
  const filtersActive = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);

  if (status === "signed-out" || status === "forbidden") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 font-sans">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand-purple-50 text-brand-purple-600"><Lock className="h-6 w-6" /></div>
          <h1 className="font-display text-xl font-bold text-slate-900">{status === "forbidden" ? "Administrators only" : "Sign in needed"}</h1>
          <p className="text-sm text-slate-500">
            {status === "forbidden"
              ? "ScoutAI review shows every planner's questions, so it is limited to administrators. Sign in with the admin password to open it."
              : "Sign in to AI Plan Agent as an administrator to review ScoutAI answers."}
          </p>
          <a href="/" className="inline-block rounded-xl bg-brand-purple-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-purple-700">Go to AI Plan Agent</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      <header
        className="text-white"
        style={{ background: "radial-gradient(115% 160% at 100% 75%, #006987 0%, #005c76 18%, #00455a 40%, #002b38 66%, #071820 100%)" }}
      >
        <div className="mx-auto max-w-7xl px-4 pb-6 pt-6 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-white/10 p-2 ring-1 ring-white/20">
              <img src={drIconWhite} alt="Digital Remedy" className="h-full w-full object-contain" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-brand-teal-200">AI Plan Agent · Admin</p>
              <h1 className="font-display text-xl font-bold sm:text-2xl">ScoutAI Review</h1>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-1 rounded-xl bg-white/10 p-1 ring-1 ring-white/15" role="group" aria-label="Date range">
              {RANGE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { setPreset(p.id); setDays(presetDays(p.id)); }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${preset === p.id ? "bg-white text-brand-purple-900 shadow-sm" : "text-brand-teal-100 hover:bg-white/10"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-1.5 text-xs ring-1 ring-white/15">
              <CalendarDays className="h-4 w-4 text-brand-teal-200" />
              <input
                type="date"
                value={days.fromDay}
                max={days.toDay}
                onChange={(e) => { if (e.target.value) { setPreset("custom"); setDays((d) => ({ ...d, fromDay: e.target.value })); } }}
                className="bg-transparent font-semibold text-white [color-scheme:dark] focus:outline-none"
                aria-label="Start date"
              />
              <span className="text-brand-teal-200">to</span>
              <input
                type="date"
                value={days.toDay}
                min={days.fromDay}
                max={toDateInput(new Date())}
                onChange={(e) => { if (e.target.value) { setPreset("custom"); setDays((d) => ({ ...d, toDay: e.target.value })); } }}
                className="bg-transparent font-semibold text-white [color-scheme:dark] focus:outline-none"
                aria-label="End date"
              />
            </div>
            {status === "loading" ? <Loader2 className="h-4 w-4 animate-spin text-brand-teal-200" /> : null}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-6 lg:px-8">
        {error ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            {error}
            <button type="button" onClick={() => void load()} className="rounded-lg bg-white px-3 py-1 text-xs font-semibold ring-1 ring-rose-200">Try again</button>
          </div>
        ) : null}

        {logs === null ? (
          status === "loading" ? <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-brand-purple-600" /></div> : null
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Stat label="Questions" value={summary.questions.toLocaleString("en-US")} footnote={`${summary.people} ${summary.people === 1 ? "person" : "people"}${filtersActive ? " · filtered" : ""}`} />
              <Stat label="Thumbs up" value={summary.upPct === null ? "—" : `${summary.upPct}%`} footnote={`of ${summary.rated} rated by planners`} />
              <Stat label="Thumbs down" value={summary.downPct === null ? "—" : `${summary.downPct}%`} footnote={`${summary.down} answer${summary.down === 1 ? "" : "s"}`} />
              <Stat label="Failure rate" value={summary.failurePct === null ? "—" : `${summary.failurePct}%`} footnote={`${summary.failed} failed`} />
              <div className="col-span-2 min-w-0 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm lg:col-span-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Top prompts</p>
                {summary.topPrompts.length ? (
                  <ol className="mt-1.5 space-y-1 text-xs">
                    {summary.topPrompts.map((p) => (
                      <li key={p.promptId} className="flex justify-between gap-2">
                        <button type="button" onClick={() => setFilter("promptId", p.promptId)} className="min-w-0 truncate text-left text-slate-700 hover:text-brand-purple-700 hover:underline">{p.label}</button>
                        <span className="shrink-0 font-semibold tabular-nums text-slate-900">{p.count}</span>
                      </li>
                    ))}
                  </ol>
                ) : <p className="mt-1.5 text-xs text-slate-400">None yet</p>}
              </div>
            </div>

            <section className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm sm:grid-cols-3 lg:grid-cols-8">
              <label className="col-span-2 flex min-w-0 flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 sm:col-span-3 lg:col-span-2">
                Search
                <span className="relative">
                  <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-slate-400" />
                  <input
                    type="search"
                    value={filters.search}
                    onChange={(e) => setFilter("search", e.target.value)}
                    placeholder="Question or advertiser"
                    className="w-full rounded-lg border border-slate-200 py-1.5 pl-7 pr-2 text-sm font-medium normal-case tracking-normal text-slate-800 focus:border-brand-purple-400 focus:outline-none"
                  />
                </span>
              </label>
              <Select label="Person" value={filters.person} onChange={(v) => setFilter("person", v)} options={[{ value: "", label: "Everyone" }, ...options.people.map((p) => ({ value: p, label: p }))]} />
              <Select label="Prompt" value={filters.promptId} onChange={(v) => setFilter("promptId", v)} options={[{ value: "", label: "All prompts" }, ...options.prompts.map((p) => ({ value: p.promptId, label: p.label }))]} />
              <Select
                label="Type"
                value={filters.kind}
                onChange={(v) => setFilter("kind", v)}
                options={[{ value: "", label: "All types" }, ...(Object.keys(KIND_LABELS) as ScoutLog["kind"][]).map((k) => ({ value: k, label: KIND_LABELS[k] }))]}
              />
              <Select
                label="Planner rating"
                value={filters.rating}
                onChange={(v) => setFilter("rating", v)}
                options={[{ value: "all", label: "Any" }, { value: "up", label: "Thumbs up" }, { value: "down", label: "Thumbs down" }, { value: "unrated", label: "Not rated" }]}
              />
              <Select
                label="Outcome"
                value={filters.status}
                onChange={(v) => setFilter("status", v)}
                options={[{ value: "all", label: "Any" }, { value: "failed", label: "Failed" }, { value: "proposed", label: "Proposed changes" }, { value: "applied", label: "Applied" }, { value: "reverted", label: "Undone" }]}
              />
              <Select
                label="Your review"
                value={filters.reviewed}
                onChange={(v) => setFilter("reviewed", v)}
                options={[{ value: "all", label: "Any" }, { value: "unreviewed", label: "Not reviewed" }, { value: "reviewed", label: "Reviewed" }]}
              />
              {filtersActive ? (
                <button type="button" onClick={() => setFilters(EMPTY_FILTERS)} className="col-span-2 inline-flex items-center gap-1 justify-self-start text-xs font-semibold text-brand-purple-700 hover:underline sm:col-span-3 lg:col-span-8">
                  <X className="h-3.5 w-3.5" /> Clear filters
                </button>
              ) : null}
            </section>

            {logs.length >= PAGE_LIMIT ? (
              <p className="text-xs text-amber-700">Showing the newest {PAGE_LIMIT.toLocaleString("en-US")} questions in this range. Narrow the dates to see older ones.</p>
            ) : null}

            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <section aria-label="Questions" className="min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
                {visible.length === 0 ? (
                  <p className="p-8 text-center text-sm text-slate-500">{logs.length ? "No questions match these filters." : "No ScoutAI questions in this date range."}</p>
                ) : (
                  <ul className="divide-y divide-slate-100 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
                    {visible.map((log) => {
                      const active = conversation?.turns.some((t) => t.id === log.id) ?? false;
                      return (
                        <li key={log.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedId(log.id)}
                            aria-current={selectedId === log.id}
                            className={`block w-full space-y-1.5 px-4 py-3 text-left transition ${selectedId === log.id ? "bg-brand-purple-50" : active ? "bg-brand-purple-50/40" : "hover:bg-slate-50"}`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-x-2 text-xs text-slate-500">
                              <span className="font-semibold text-slate-700">{log.actor}</span>
                              <span>{formatWhen(log.at)}</span>
                            </div>
                            <p className="line-clamp-2 text-sm text-slate-900">{log.question}</p>
                            <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                              {log.advertiserName ? <span className="font-semibold text-slate-600">{log.advertiserName}</span> : null}
                              <span>{log.promptLabel}</span>
                              <span>· {KIND_LABELS[log.kind]}</span>
                              {log.turn > 1 ? <span>· turn {log.turn}</span> : null}
                            </div>
                            <Badges log={log} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section aria-label="Conversation" className="min-w-0 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
                {!selected || !conversation ? (
                  <div className="flex h-48 flex-col items-center justify-center gap-2 text-sm text-slate-500">
                    <MessageSquare className="h-6 w-6 text-slate-300" />
                    Pick a question to read the whole conversation.
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h2 className="font-display text-base font-bold text-slate-900">{selected.advertiserName || "Untitled plan"}</h2>
                      <p className="text-xs text-slate-500">
                        {conversation.turns.length} question{conversation.turns.length === 1 ? "" : "s"} · plan {selected.planId}
                      </p>
                    </div>
                    {conversation.missingEarlier ? (
                      <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">This chat started before the selected dates; widen the range to see its earlier questions.</p>
                    ) : null}
                    {conversation.turns.map((t) => <Turn key={t.id} log={t} selected={t.id === selected.id} onSaved={replaceLog} />)}
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
