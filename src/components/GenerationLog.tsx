import React, { useState } from "react";
import { ChevronDown, ExternalLink, ListTree } from "lucide-react";
import type { GenerationLogEntry } from "../types";

/** A readable chip label for a source: its domain, unless that is a Google grounding redirect. */
function sourceLabel(src: { title: string; uri: string }, index: number): string {
  try {
    const host = new URL(src.uri).hostname.replace(/^www\./, "");
    if (host && !/google|vertexai|googleapis/.test(host)) return host;
  } catch {
    // Not a URL; fall through to the title.
  }
  if (src.title && !/http|google|vertex/.test(src.title)) return src.title;
  return `Grounded Link ${index + 1}`;
}

function elapsed(fromMs: number, at: string): string {
  const seconds = Math.max(0, Math.round((Date.parse(at) - fromMs) / 1000));
  return `+${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * The steps the live console showed while this plan was generated, collapsed by default. Plans
 * generated before the log was saved have none, and show nothing.
 */
export function GenerationLog({ entries }: { entries?: GenerationLogEntry[] }) {
  const [open, setOpen] = useState(false);
  if (!entries || entries.length === 0) return null;
  const startedAt = Date.parse(entries[0].at);

  return (
    <div className="border border-slate-200 rounded-xl">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left cursor-pointer group"
      >
        <span className="flex items-center gap-1.5 text-slate-800">
          <ListTree className="w-4 h-4 text-indigo-500" />
          <span className="text-xs font-bold uppercase tracking-wider group-hover:text-indigo-600 transition-colors">
            Generation Process Log
          </span>
          <span className="text-[11px] text-slate-500 font-medium normal-case">
            ({entries.length} step{entries.length === 1 ? "" : "s"}
            {Number.isFinite(startedAt) ? `, ${new Date(startedAt).toLocaleString()}` : ""})
          </span>
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-400 group-hover:text-slate-600 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <ol className="border-t border-slate-100 px-4 py-3 space-y-3 max-h-[480px] overflow-y-auto custom-scrollbar">
          {entries.map((entry, i) => (
            <li key={i} className="text-xs space-y-1.5 border-b border-slate-100 pb-3 last:border-0 last:pb-0">
              <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono">
                <span>{new Date(entry.at).toLocaleTimeString()}</span>
                {Number.isFinite(startedAt) && <span>{elapsed(startedAt, entry.at)}</span>}
                <span className="uppercase font-bold px-1.5 py-0.5 rounded-sm bg-slate-100 text-slate-500">
                  {entry.type === "research_result" ? `Grounding: ${entry.label}` : "Status"}
                </span>
              </div>

              {entry.type === "status" && (
                <p className="text-slate-700 leading-relaxed pl-3 border-l-2 border-indigo-200">{entry.message}</p>
              )}

              {entry.type === "research_result" && (
                <div className={`pl-3 border-l-2 space-y-1.5 ${entry.failed ? "border-rose-300" : "border-emerald-300"}`}>
                  <p className={`font-semibold ${entry.failed ? "text-rose-600" : "text-emerald-700"}`}>
                    {entry.failed ? `Research failed for: ${entry.label}` : `Research complete for: ${entry.label}`}
                  </p>
                  {entry.sources && entry.sources.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {entry.sources.map((src, idx) => (
                        <a
                          key={idx}
                          href={src.uri}
                          target="_blank"
                          referrerPolicy="no-referrer"
                          rel="noopener noreferrer"
                          title={src.title || src.uri}
                          className="inline-flex items-center gap-1 bg-slate-50 hover:bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] border border-slate-200 max-w-[200px]"
                        >
                          <span className="truncate">{sourceLabel(src, idx)}</span>
                          <ExternalLink className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                        </a>
                      ))}
                    </div>
                  )}
                  {entry.blurb && <p className="text-slate-500 italic leading-relaxed">"{entry.blurb}"</p>}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
