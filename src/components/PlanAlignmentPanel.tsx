import React from 'react';
import { AlertTriangle, Tv, Users } from 'lucide-react';
import type { PlanAlignment } from '../planning/planAlignment';

/**
 * "How this plan reaches your audience", for a client's plan used as is. The client sees each
 * persona with the channels and publishers that reach them, and the funnel stages the plan covers;
 * personas and stages with nothing to show are left out rather than shown as gaps. Planners also
 * see the gaps and the channels the research rates weakly (src/planning/planAlignment.ts).
 */

const chip = 'rounded-full border px-2 py-0.5 text-[11px] font-semibold';

export const PlanAlignmentPanel: React.FC<{ alignment: PlanAlignment; readOnly: boolean }> = ({ alignment, readOnly }) => {
  const personas = alignment.personas.filter((persona) => persona.channels.length > 0 || persona.publishers.length > 0);
  const stages = readOnly ? alignment.funnel.filter((stage) => stage.channels.length > 0) : alignment.funnel;
  if (personas.length === 0 && stages.length === 0) return null;

  return (
    <section aria-labelledby="plan-alignment-title" className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 md:px-5">
        <h3 id="plan-alignment-title" className="flex items-center gap-1.5 text-sm font-extrabold text-slate-900">
          <Users className="h-4 w-4 text-indigo-600" /> How this plan reaches your audience
        </h3>
        <p className="mt-1 text-xs text-slate-600">Your media plan, matched to the audiences this plan's research identified.</p>
      </div>

      {personas.length > 0 && (
        <div className="grid gap-3 p-4 sm:grid-cols-2 md:p-5">
          {personas.map((persona) => (
            <article key={persona.name} className="rounded-xl border border-slate-200 p-3">
              <h4 className="text-sm font-extrabold text-slate-900">{persona.name}</h4>
              {persona.channels.length > 0 && (
                <div className="mt-2">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Reached with</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {persona.channels.map((name) => <span key={name} className={`${chip} border-indigo-200 bg-indigo-50 text-indigo-800`}>{name}</span>)}
                  </div>
                </div>
              )}
              {persona.publishers.length > 0 && (
                <div className="mt-2">
                  <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500"><Tv className="h-3 w-3" /> Watches, and in this plan</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {persona.publishers.map((name) => <span key={name} className={`${chip} border-slate-200 bg-slate-50 text-slate-700`}>{name}</span>)}
                  </div>
                </div>
              )}
              {persona.because.length > 0 && (
                <p className="mt-2 text-[11px] leading-4 text-slate-600">{persona.because.slice(0, 2).join(' · ')}</p>
              )}
            </article>
          ))}
        </div>
      )}

      {stages.length > 0 && (
        <div className="border-t border-slate-100 px-4 py-3 md:px-5">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">Across the funnel</div>
          <div className={`grid gap-3 ${stages.length === 3 ? 'sm:grid-cols-3' : stages.length === 2 ? 'sm:grid-cols-2' : ''}`}>
            {stages.map((stage) => (
              <div key={stage.stage} className={`rounded-xl border p-3 ${stage.channels.length ? 'border-slate-200' : 'border-amber-200 bg-amber-50'}`}>
                <div className="text-xs font-extrabold text-slate-900">{stage.label}</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {stage.channels.length
                    ? stage.channels.map((name) => <span key={name} className={`${chip} border-slate-200 bg-white text-slate-700`}>{name}</span>)
                    : <span className="text-[11px] font-semibold text-amber-800">Not covered by this plan</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!readOnly && alignment.cautions.length > 0 && (
        <div className="border-t border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 md:px-5">
          <div className="mb-1 flex items-center gap-1.5 font-bold"><AlertTriangle className="h-3.5 w-3.5" /> For you, not the client</div>
          <ul className="list-disc space-y-1 pl-5">{alignment.cautions.map((caution) => <li key={caution}>{caution}</li>)}</ul>
        </div>
      )}
    </section>
  );
};
