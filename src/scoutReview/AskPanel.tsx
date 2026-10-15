import React from "react";
import { Loader2, RotateCcw, Send, Sparkles } from "lucide-react";
import * as api from "../api/client";
import type { ScoutLog } from "../storage/types";
import type { AskBlock } from "./scoutAsk";
import { AskBlocks } from "./AskBlocks";
import { formatDuration } from "./scoutReviewData";

/**
 * Ask on the ScoutAI review page: questions about the questions in scope, the same ones the list
 * shows. The chat lives in this tab only (nothing about it is stored but a usage count), so a
 * reload starts afresh.
 */

const STARTERS = [
  "What do planners ask about most, and how is that changing over time?",
  "Which answers get thumbs down, and what do they have in common?",
  "Which prompts fail or time out most?",
  "Which proposals do planners undo, and why might that be?",
  "What do planners keep typing that should be a library prompt? Draft the best one.",
  "Who uses ScoutAI most, and who has gone quiet?",
];

type Message =
  | { role: "admin"; text: string }
  | { role: "assistant"; text: string; blocks: AskBlock[]; basedOn: api.ScoutAskResponse["basedOn"]; durationMs: number; scope: string }
  | { role: "error"; text: string };

export function AskPanel({ scope, inScope, logsById, onOpenQuestion }: {
  scope: api.ScoutReviewScope & { scope: string };
  /** Questions the list shows, which is what the server will read. */
  inScope: number;
  logsById: Map<string, ScoutLog>;
  onOpenQuestion: (id: string) => void;
}) {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [input, setInput] = React.useState("");
  const [busySince, setBusySince] = React.useState<number | null>(null);
  const [now, setNow] = React.useState(Date.now());
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (busySince === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [busySince]);
  React.useEffect(() => { endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [messages.length, busySince]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busySince !== null) return;
    const history = [...messages, { role: "admin" as const, text: question }];
    setMessages(history);
    setInput("");
    setBusySince(Date.now());
    setNow(Date.now());
    try {
      const turns = history.flatMap((m) => (m.role === "error" ? [] : [{ role: m.role, text: m.text }]));
      const answer = await api.askScoutLogs(scope, turns);
      setMessages((list) => [...list, { role: "assistant", text: answer.text, blocks: answer.blocks, basedOn: answer.basedOn, durationMs: answer.durationMs, scope: scope.scope }]);
    } catch (err: any) {
      setMessages((list) => [...list, { role: "error", text: err?.message || "The question could not be answered just now." }]);
    } finally {
      setBusySince(null);
    }
  };

  return (
    <section aria-label="Ask about ScoutAI questions" className="flex min-w-0 flex-col rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <p className="text-xs text-slate-500">
          Asks about the <span className="font-semibold text-slate-700">{inScope.toLocaleString("en-US")} question{inScope === 1 ? "" : "s"}</span> the dates and filters select ({scope.scope}). Counts are worked out by the app, not the AI.
        </p>
        {messages.length ? (
          <button type="button" onClick={() => setMessages([])} disabled={busySince !== null} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-purple-700 hover:underline disabled:opacity-40">
            <RotateCcw className="h-3.5 w-3.5" /> New chat
          </button>
        ) : null}
      </div>

      <div className="space-y-4 px-4 py-4">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800"><Sparkles className="h-4 w-4 text-brand-purple-500" /> Ask what planners ask, and how well ScoutAI answers</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {STARTERS.map((s) => (
                <button key={s} type="button" disabled={inScope === 0} onClick={() => void send(s)} className="rounded-xl border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 hover:border-brand-purple-200 hover:bg-brand-purple-50 disabled:opacity-40">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((m, i) => {
          if (m.role === "admin") return <div key={i} className="ml-auto max-w-[85%] rounded-xl bg-brand-purple-600 px-3 py-2 text-sm text-white whitespace-pre-wrap">{m.text}</div>;
          if (m.role === "error") return <p key={i} className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{m.text}</p>;
          return (
            <div key={i} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
              <AskBlocks blocks={m.blocks} logsById={logsById} onOpenQuestion={onOpenQuestion} />
              <p className="border-t border-slate-200 pt-2 text-[11px] text-slate-400">
                Based on {m.basedOn.total.toLocaleString("en-US")} question{m.basedOn.total === 1 ? "" : "s"} ({m.scope})
                {m.basedOn.listed < m.basedOn.total ? `; the AI read the newest ${m.basedOn.listed} word for word, and the counts cover all of them` : ""}
                {m.basedOn.capped ? "; the range holds more than the newest 1,000, so narrow the dates for older ones" : ""}
                {` · ${formatDuration(m.durationMs)}`}
              </p>
            </div>
          );
        })}

        {busySince !== null ? (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin text-brand-purple-600" /> Reading the questions… {Math.round((now - busySince) / 1000)}s
            <span className="text-xs text-slate-400">(this can take a minute or two)</span>
          </p>
        ) : null}
        <div ref={endRef} />
      </div>

      <form
        className="flex items-end gap-2 border-t border-slate-100 p-3"
        onSubmit={(e) => { e.preventDefault(); void send(input); }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }}
          rows={2}
          maxLength={2000}
          disabled={inScope === 0}
          placeholder={inScope === 0 ? "No questions match the dates and filters." : "Ask about these questions…"}
          className="min-w-0 flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-purple-400 focus:outline-none disabled:bg-slate-50"
        />
        <button type="submit" disabled={!input.trim() || busySince !== null || inScope === 0} className="inline-flex items-center gap-1.5 rounded-xl bg-brand-purple-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-purple-700 disabled:opacity-40">
          <Send className="h-4 w-4" /> Send
        </button>
      </form>
    </section>
  );
}
