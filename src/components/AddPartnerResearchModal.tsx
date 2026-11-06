import React from "react";
import { AlertTriangle, ArrowRight, BarChart3, ChevronDown, Database, FileText, Loader2, Scale, ShieldCheck, X } from "lucide-react";
import * as api from "../api/client";
import { formatSpend } from "../research/partnerReinforcement";
import { PartnerLogo } from "./PartnerLogo";
import { PartnerResearchPicker } from "./PartnerResearchPicker";
import { ResearchLibraryModal } from "./ResearchLibraryModal";

// Partner research on a plan that already exists. The planner chooses the research, the server
// prepares everything it would change (Preview changes nothing), and the planner keeps what they
// want. The rewritten prose and the competitive landscape are kept by default: they reinforce the
// plan. Budget moves are not: the plan's mix stays as it is unless the planner ticks one, and a
// move that is applied is shown to the client with the partner figure behind it.

interface Props {
  planId: string;
  advertiserName: string;
  brief: { text: string; geography: string };
  /** The research the plan already uses, ticked to start with. */
  currentDatasetIds: string[];
  /** Saves pending edits, then returns the plan's revision. */
  getRevision: () => Promise<number>;
  onClose: () => void;
  onApplied: (result: { plan: api.StoredPlan; stale: string[]; budgetChanges: number }) => void;
}

type Step = { kind: "choose" } | { kind: "preparing" } | { kind: "review"; preview: api.PartnerResearchPreview; datasetIds: string[] } | { kind: "saving"; preview: api.PartnerResearchPreview; datasetIds: string[] };

export function AddPartnerResearchModal({ planId, advertiserName, brief, currentDatasetIds, getRevision, onClose, onApplied }: Props) {
  const [selection, setSelection] = React.useState<string[] | null>(currentDatasetIds.length ? currentDatasetIds : null);
  const [defaults, setDefaults] = React.useState<string[]>([]);
  const [step, setStep] = React.useState<Step>({ kind: "choose" });
  const [error, setError] = React.useState<string | null>(null);
  const [libraryTarget, setLibraryTarget] = React.useState<string | null | undefined>(undefined);
  const [libraryVersion, setLibraryVersion] = React.useState(0);
  const [keptNarrative, setKeptNarrative] = React.useState<Set<string>>(new Set());
  const [keepCompetitive, setKeepCompetitive] = React.useState(true);
  const [keptProposals, setKeptProposals] = React.useState<Set<string>>(new Set());

  const chosen = selection ?? defaults;

  const prepare = async () => {
    setError(null);
    setStep({ kind: "preparing" });
    try {
      const expectedRevision = await getRevision();
      const preview = await api.previewPartnerResearch(planId, { expectedRevision, datasetIds: chosen });
      setKeptNarrative(new Set(preview.narrative.map((c) => c.path)));
      setKeepCompetitive(Boolean(preview.competitive));
      setKeptProposals(new Set());
      setStep({ kind: "review", preview, datasetIds: chosen });
    } catch (err: any) {
      setError(err?.message || "The partner research could not be prepared.");
      setStep({ kind: "choose" });
    }
  };

  const apply = async () => {
    if (step.kind !== "review") return;
    const { preview, datasetIds } = step;
    setError(null);
    setStep({ kind: "saving", preview, datasetIds });
    try {
      const result = await api.applyPartnerResearch(planId, {
        expectedRevision: preview.revision,
        datasetIds,
        narrative: preview.narrative.filter((c) => keptNarrative.has(c.path)),
        competitive: keepCompetitive ? preview.competitive : null,
        proposals: preview.proposals.filter((p) => keptProposals.has(p.id)),
      });
      onApplied(result);
    } catch (err: any) {
      setError(err?.status === 409 ? "The plan changed while this was being prepared. Prepare it again." : err?.message || "The research could not be added.");
      setStep({ kind: "review", preview, datasetIds });
    }
  };

  const toggle = (set: Set<string>, id: string, write: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    write(next);
  };

  const busy = step.kind === "preparing" || step.kind === "saving";

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm flex items-start md:items-center justify-center p-3 md:p-6 overflow-y-auto">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[92vh]">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2 text-indigo-600 text-xs font-bold uppercase tracking-wider"><Database className="w-4 h-4" /> Partner research</div>
            <h2 className="mt-0.5 text-base font-display font-bold text-slate-900">Back this plan with partner data</h2>
            <p className="text-xs text-slate-500">The plan is rewritten to cite the partners' approved figures. Nothing changes until you apply.</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 cursor-pointer disabled:opacity-40" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1 space-y-4">
          {error && <div className="flex items-start gap-2 rounded-lg bg-rose-50 border border-rose-100 px-3 py-2 text-xs text-rose-700"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{error}</div>}

          {step.kind === "choose" && (
            <PartnerResearchPicker
              advertiserName={advertiserName}
              selection={selection}
              onChange={setSelection}
              onDefaults={setDefaults}
              onManage={(id) => setLibraryTarget(id ?? null)}
              refreshKey={libraryVersion}
              brief={brief}
            />
          )}

          {step.kind === "preparing" && (
            <div className="py-12 flex flex-col items-center gap-2 text-sm text-slate-600">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
              Rewriting the plan with the partner figures…
              <span className="text-xs text-slate-400">This takes a minute or two.</span>
            </div>
          )}

          {(step.kind === "review" || step.kind === "saving") && (
            <Review
              preview={step.preview}
              keptNarrative={keptNarrative}
              onToggleNarrative={(path) => toggle(keptNarrative, path, setKeptNarrative)}
              keepCompetitive={keepCompetitive}
              onToggleCompetitive={() => setKeepCompetitive((v) => !v)}
              keptProposals={keptProposals}
              onToggleProposal={(id) => toggle(keptProposals, id, setKeptProposals)}
            />
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50/60 rounded-b-2xl">
          <p className="flex items-center gap-1 text-[10px] text-slate-400"><ShieldCheck className="w-3 h-3" /> A version is saved in History first, so this can be undone.</p>
          <div className="flex items-center gap-2">
            {step.kind === "review" && (
              <button type="button" onClick={() => setStep({ kind: "choose" })} className="text-xs font-semibold text-slate-600 hover:bg-slate-100 px-3 py-2 rounded-lg cursor-pointer">Back</button>
            )}
            {(step.kind === "choose" || step.kind === "preparing") && (
              <button type="button" onClick={prepare} disabled={busy || chosen.length === 0} className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 px-4 py-2 rounded-lg cursor-pointer disabled:cursor-not-allowed">
                {step.kind === "preparing" && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Prepare changes
              </button>
            )}
            {(step.kind === "review" || step.kind === "saving") && (
              <button type="button" onClick={apply} disabled={busy} className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 px-4 py-2 rounded-lg cursor-pointer disabled:cursor-not-allowed">
                {step.kind === "saving" && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Add to plan
              </button>
            )}
          </div>
        </div>
      </div>

      <ResearchLibraryModal
        isOpen={libraryTarget !== undefined}
        initialDatasetId={libraryTarget ?? null}
        onClose={() => setLibraryTarget(undefined)}
        advertiserName={advertiserName}
        onChanged={() => setLibraryVersion((v) => v + 1)}
      />
    </div>
  );
}

function Review({ preview, keptNarrative, onToggleNarrative, keepCompetitive, onToggleCompetitive, keptProposals, onToggleProposal }: {
  preview: api.PartnerResearchPreview;
  keptNarrative: Set<string>;
  onToggleNarrative: (path: string) => void;
  keepCompetitive: boolean;
  onToggleCompetitive: () => void;
  keptProposals: Set<string>;
  onToggleProposal: (id: string) => void;
}) {
  const { evidence, narrative, competitive, proposals, errors } = preview;
  const credits = [...new Set(evidence.datasets.map((d) => d.providerLabel))];
  return (
    <>
      <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 px-4 py-3 flex flex-wrap items-center gap-3">
        {evidence.providers.map((p) => <PartnerLogo key={p.id} provider={p} size="md" />)}
        <span className="text-xs text-slate-600"><strong className="text-slate-900">{evidence.factCount}</strong> approved figures from {credits.join(", ")}</span>
      </div>

      <Section icon={<FileText className="w-3.5 h-3.5" />} title="Rewritten to cite the partners" note={errors.narrative ? `The narrative could not be rewritten (${errors.narrative}). The rest can still be added.` : narrative.length === 0 ? "The writer found nothing to change in the text." : undefined}>
        <ul className="space-y-1.5">
          {narrative.map((c) => <NarrativeRow key={c.path} change={c} kept={keptNarrative.has(c.path)} onToggle={() => onToggleNarrative(c.path)} />)}
        </ul>
      </Section>

      <Section icon={<BarChart3 className="w-3.5 h-3.5" />} title="Competitive landscape" note={errors.competitive ? `It could not be built (${errors.competitive}).` : !competitive ? "None of the chosen research has enough competitor spend figures for one." : undefined}>
        {competitive && (
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={keepCompetitive} onChange={onToggleCompetitive} className="mt-0.5 h-3.5 w-3.5 accent-indigo-600" />
            <span className="min-w-0 text-xs text-slate-700">
              <span className="font-semibold">Add a "Where competitors are spending" panel</span> from {competitive.providerLabel}
              <span className="block mt-1 text-[11px] text-slate-500">
                {competitive.competitors.slice(0, 4).map((c) => `${c.name} ${formatSpend(c.spend)}`).join(" · ")}
                {competitive.mediaTypes.length > 0 && <><br />{competitive.mediaTypes.slice(0, 4).map((c) => `${c.name} ${formatSpend(c.spend)}`).join(" · ")}</>}
              </span>
              {competitive.highlights.map((h) => <span key={h} className="block mt-0.5 text-[11px] text-slate-500">{h}</span>)}
            </span>
          </label>
        )}
      </Section>

      <Section icon={<Scale className="w-3.5 h-3.5" />} title="Budget moves the data argues for" note={errors.proposals ? `Budget moves could not be considered (${errors.proposals}).` : proposals.length === 0 ? "None. The partner data supports the media mix as it is." : "Left unticked, the media mix stays as it is. A move you add is shown to the client with the figure behind it."}>
        <ul className="space-y-2">
          {proposals.map((p) => (
            <li key={p.id} className={`rounded-xl border px-3 py-2.5 ${keptProposals.has(p.id) ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200"}`}>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={keptProposals.has(p.id)} onChange={() => onToggleProposal(p.id)} className="mt-0.5 h-3.5 w-3.5 accent-emerald-600" />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-slate-800">{p.title}</span>
                  <span className="block text-xs text-slate-600 leading-snug">{p.reason}</span>
                </span>
              </label>
              <div className="mt-2 ml-5 flex flex-wrap gap-1.5">
                {p.changes.map((c) => (
                  <span key={c.label} className="inline-flex items-center gap-1 rounded-md bg-white border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600">
                    {c.label}: {c.before} <ArrowRight className="w-3 h-3" /> <strong className="text-slate-800">{c.after}</strong>
                  </span>
                ))}
              </div>
              <ul className="mt-1.5 ml-5 space-y-0.5">
                {p.evidence.map((e) => <li key={e} className="text-[10px] text-slate-400 leading-snug">Based on: {e}</li>)}
              </ul>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

function Section({ icon, title, note, children }: { icon: React.ReactNode; title: string; note?: string; children?: React.ReactNode }) {
  return (
    <section>
      <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{icon}{title}</h3>
      {note && <p className="text-xs text-slate-500 mb-1.5">{note}</p>}
      {children}
    </section>
  );
}

function NarrativeRow({ change, kept, onToggle }: { change: api.PartnerResearchPreview["narrative"][number]; kept: boolean; onToggle: () => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <li className="rounded-lg border border-slate-200">
      <div className="flex items-center gap-2 px-3 py-2">
        <input type="checkbox" checked={kept} onChange={onToggle} className="h-3.5 w-3.5 accent-indigo-600 cursor-pointer" aria-label={`Keep the new ${change.label}`} />
        <span className="flex-1 text-xs font-semibold text-slate-700">{change.label}</span>
        <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-indigo-700 cursor-pointer">
          {open ? "Hide" : "Compare"} <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      {open && (
        <div className="grid md:grid-cols-2 gap-2 px-3 pb-3">
          <TextBlock label="Now" value={change.before} tone="text-slate-500" />
          <TextBlock label="With partner data" value={change.after} tone="text-slate-800" />
        </div>
      )}
    </li>
  );
}

/** A narrative field as text: a paragraph, or a list of takeaways, recommendations or highlights. */
function TextBlock({ label, value, tone }: { label: string; value: unknown; tone: string }) {
  const items = Array.isArray(value)
    ? value.map((v: any) => (typeof v === "string" ? v : [v?.title || v?.publisher, v?.action || v?.why || v?.highlight || v?.insight].filter(Boolean).join(": ")))
    : [typeof value === "string" ? value : ""];
  return (
    <div className="rounded-md bg-slate-50 px-2.5 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">{label}</div>
      {items.map((t, i) => <p key={i} className={`text-[11px] leading-snug ${tone} ${i ? "mt-1" : ""}`}>{t || "—"}</p>)}
    </div>
  );
}
