import React from "react";
import { AlertTriangle, Check, Wrench } from "lucide-react";
import type { AuditResult, AuditFindingRecord } from "../types";

const OWNER_LABEL: Record<AuditFindingRecord["owner"], string> = {
  narrative: "Text",
  personas: "Persona text",
  publisherRationale: "Publisher rationale",
  channelRationale: "Channel rationale",
  chart: "Chart - needs a planner",
  channelStrategy: "Channel plan - needs a planner",
  planner: "Planner decision",
};

const SEVERITY_STYLE: Record<AuditFindingRecord["severity"], string> = {
  critical: "bg-rose-100 text-rose-700",
  major: "bg-amber-100 text-amber-800",
  minor: "bg-slate-100 text-slate-600",
};

const rank = { critical: 0, major: 1, minor: 2 } as const;

/**
 * What QA found and what happened to it. Open findings come first, labelled with who has to act:
 * the text fixer can only change prose, so an issue in the channel plan or a chart stays open
 * until a planner deals with it. Plans saved before structured findings existed fall back to
 * their red-flag list.
 */
export function QaFindings({ audit }: { audit: AuditResult }) {
  const findings = audit.findings ?? [];
  const open = findings.filter((f) => f.status !== "resolved").sort((a, b) => rank[a.severity] - rank[b.severity]);
  const resolved = findings.filter((f) => f.status === "resolved");
  const legacyFlags = findings.length === 0
    ? (audit.criticalRedFlags || []).filter((flag) => !/^Clean\b/.test(flag))
    : [];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h5 className="text-[11px] font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
          Open issues ({open.length || legacyFlags.length})
        </h5>
        {open.length === 0 && legacyFlags.length === 0 && (
          <p className="text-xs text-slate-500 italic pl-1">No open issues.</p>
        )}
        <ul className="space-y-2.5 max-h-[260px] overflow-y-auto custom-scrollbar">
          {open.map((f) => (
            <li key={f.id} className="text-xs border-b border-slate-100 pb-2.5 last:border-0 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide ${SEVERITY_STYLE[f.severity]}`}>{f.severity}</span>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-indigo-50 text-indigo-700">{OWNER_LABEL[f.owner]}</span>
                {f.status === "partially_resolved" && <span className="text-[9px] font-semibold text-slate-500">partly fixed</span>}
              </div>
              <p className="text-slate-800 font-semibold leading-snug">{f.issue}</p>
              {f.fix && <p className="text-slate-500 leading-normal"><strong>Suggested:</strong> {f.fix}</p>}
              {f.verifyNote && <p className="text-slate-400 leading-normal italic">{f.verifyNote}</p>}
            </li>
          ))}
          {legacyFlags.map((flag, i) => (
            <li key={`flag-${i}`} className="text-xs text-slate-700 leading-snug">{flag}</li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <h5 className="text-[11px] font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
          <Wrench className="w-3.5 h-3.5 text-indigo-500" />
          Fixes applied ({audit.autoFixes?.length ?? 0})
        </h5>
        {(audit.autoFixes?.length ?? 0) === 0 ? (
          <p className="text-xs text-slate-500 italic pl-1">No automatic fixes were applied.</p>
        ) : (
          <ul className="space-y-2.5 max-h-[200px] overflow-y-auto custom-scrollbar">
            {audit.autoFixes.map((fix, i) => (
              <li key={i} className="text-xs space-y-0.5">
                <p className="text-indigo-900 font-semibold leading-snug">{fix.issue}</p>
                <p className="text-slate-600 leading-normal">{fix.resolution}</p>
              </li>
            ))}
          </ul>
        )}
        {resolved.length > 0 && (
          <p className="text-[11px] text-emerald-700 flex items-center gap-1 pl-1">
            <Check className="w-3.5 h-3.5" />
            {resolved.length} finding{resolved.length === 1 ? "" : "s"} confirmed resolved on re-review.
          </p>
        )}
      </div>
    </div>
  );
}
