import React from "react";
import { ArrowRight, History } from "lucide-react";
import { SectionVisibilityButton } from "./SectionVisibilityButton";

// "Built on your campaign history": what the client's own past campaign showed, and what this
// plan does about it. Entries are added through ScoutAI and checked against the campaign's data
// (see src/assistant/learningOps); the section starts hidden from the client until the planner
// shows it.

export interface PerformanceLearningView {
  campaignName: string;
  learning: string;
  action: string;
}

interface Props {
  learnings: PerformanceLearningView[];
  isHidden: boolean;
  isShareView: boolean;
  onToggle: (sectionKey: string, inactive: boolean) => void;
}

export function PerformanceLearningsSection({ learnings, isHidden, isShareView, onToggle }: Props) {
  if (learnings.length === 0 || (isShareView && isHidden)) return null;
  const campaigns = [...new Set(learnings.map((l) => l.campaignName).filter(Boolean))];
  return (
    <div
      className={`group relative rounded-2xl border shadow-xs overflow-hidden transition-all duration-200 ${
        isHidden ? "border-dashed border-slate-300 bg-slate-100/70 opacity-60 hover:opacity-90" : "border-slate-100 bg-white hover:border-slate-200"
      }`}
    >
      <div className="p-4 md:p-5 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
            <History className="w-4 h-4" />
          </div>
          <div>
            <div className="text-indigo-600 text-[11px] font-bold uppercase tracking-wider">Built on your campaign history</div>
            <h3 className="text-base font-display font-bold text-slate-800">What your last campaign taught us</h3>
            {campaigns.length > 0 && <p className="text-[11px] text-slate-500">From {campaigns.join(" and ")}</p>}
          </div>
        </div>
        {!isShareView && (
          <SectionVisibilityButton
            sectionKey="performanceLearnings"
            isInactive={isHidden}
            onToggle={onToggle}
            badgeLabel="Hidden from the client until you show it"
          />
        )}
      </div>
      <ul className="px-4 md:px-5 pb-5 grid gap-2.5 md:grid-cols-2">
        {learnings.map((l, i) => (
          <li key={i} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5">
            <p className="text-sm leading-relaxed text-slate-700">{l.learning}</p>
            <p className="mt-2 flex items-start gap-1.5 text-sm font-semibold leading-relaxed text-indigo-800">
              <ArrowRight className="w-4 h-4 shrink-0 mt-0.5" /> <span>{l.action}</span>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
