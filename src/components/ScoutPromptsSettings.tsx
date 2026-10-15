import React from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Loader2, Plus, RotateCcw, Save, Star, Trash2 } from "lucide-react";
import * as api from "../api/client";
import {
  DEFAULT_SCOUT_PROMPTS, MODE_LABELS, NEED_LABELS, PROMPT_MODES, PROMPT_NEEDS, PROMPT_VARIABLES, VARIABLE_LABELS,
  validatePromptLibrary, type PromptMode, type PromptNeed, type ScoutPrompt,
} from "../assistant/promptLibrary";
import { takePromptDraft } from "../scoutReview/promptHandoff";

// Settings tab for the ScoutAI prompt library. It saves on its own (its own record and revision,
// separate from planning settings), and is read-only for anyone who is not an admin: the
// drawer's fieldset disables every control, and the server refuses the save regardless.

const newId = () => `custom-${Math.random().toString(36).slice(2, 8)}`;
const same = (a: ScoutPrompt, b: ScoutPrompt) =>
  a.title === b.title && a.category === b.category && a.text === b.text && a.mode === b.mode && a.featured === b.featured
  && a.enabled === b.enabled && [...a.needs].sort().join() === [...b.needs].sort().join();

export function ScoutPromptsSettings({ readOnly }: { readOnly: boolean }) {
  const [saved, setSaved] = React.useState<api.ScoutPromptLibrary | null>(null);
  const [draft, setDraft] = React.useState<ScoutPrompt[]>([]);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<"loading" | "idle" | "saving">("loading");
  const [error, setError] = React.useState<string | null>(null);
  const [reasons, setReasons] = React.useState<string[]>([]);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [handedOff, setHandedOff] = React.useState(false);

  const load = React.useCallback(() => {
    setStatus("loading");
    api.getScoutPrompts()
      .then((library) => { setSaved(library); setDraft(library.prompts); setError(null); setReasons([]); })
      .catch((err) => setError(err?.message || "The prompt library could not be loaded."))
      .finally(() => setStatus("idle"));
  }, []);
  React.useEffect(load, [load]);

  // A prompt drafted on the ScoutAI review page (src/scoutReview/promptHandoff.ts) arrives as a
  // new, unsaved prompt, opened for editing. Saving it is still the admin's own Save.
  React.useEffect(() => {
    if (readOnly || !saved) return;
    let incoming = null;
    try { incoming = takePromptDraft(window.localStorage); } catch { /* storage may be blocked */ }
    if (!incoming) return;
    const prompt: ScoutPrompt = { id: newId(), ...incoming, needs: [], featured: false, enabled: true, builtIn: false };
    setDraft((list) => [...list, prompt]);
    setOpenId(prompt.id);
    setHandedOff(true);
    setTimeout(() => document.getElementById(`scout-prompt-${prompt.id}`)?.scrollIntoView({ block: "center" }), 200);
  }, [readOnly, saved]);

  const dirty = saved !== null && JSON.stringify(saved.prompts) !== JSON.stringify(draft);
  const validation = React.useMemo(() => validatePromptLibrary(draft), [draft]);
  const categories = [...new Set(draft.map((p) => p.category))];

  const update = (id: string, patch: Partial<ScoutPrompt>) => setDraft((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const move = (id: string, by: number) => setDraft((list) => {
    const index = list.findIndex((p) => p.id === id);
    const target = index + by;
    if (index < 0 || target < 0 || target >= list.length) return list;
    const next = [...list];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const add = () => {
    const prompt: ScoutPrompt = { id: newId(), title: "New prompt", category: categories[0] || "Plan review", text: "", needs: [], mode: "plan", featured: false, enabled: true, builtIn: false };
    setDraft((list) => [...list, prompt]);
    setOpenId(prompt.id);
  };

  const run = async (action: () => Promise<api.ScoutPromptLibrary>, done: string) => {
    setStatus("saving");
    setError(null);
    setReasons([]);
    setNotice(null);
    try {
      const library = await action();
      setSaved(library);
      setDraft(library.prompts);
      setNotice(done);
    } catch (err: any) {
      setError(err instanceof api.ApiError && err.isConflict ? "Someone else changed the prompt library while you were editing. Reload it, then make your change again." : err?.message || "The prompt library could not be saved.");
      setReasons(err instanceof api.ApiError ? err.reasons ?? [] : []);
    } finally {
      setStatus("idle");
    }
  };
  const save = () => run(() => api.saveScoutPrompts(draft, saved?.revision ?? 0), "Prompt library saved. Planners see it the next time they open ScoutAI.");
  const resetAll = () => {
    if (!window.confirm("Reset the whole prompt library to the built-in prompts? Your edits and custom prompts will be removed.")) return;
    void run(() => api.resetScoutPrompts(saved?.revision ?? 0), "Prompt library reset to the built-in prompts.");
  };

  if (status === "loading" && !saved) {
    return <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading the prompt library…</p>;
  }

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-5">
        <h3 className="text-sm font-bold text-slate-900">ScoutAI prompt library</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-600">
          Ready-made questions planners pick from the ScoutAI panel. Choosing one fills the message box so the planner can adjust it before sending.
          Starred prompts are also shown as quick suggestions when the plan has what they need. Prompts that need something the plan lacks are shown greyed out with the reason.
        </p>
        <p className="mt-2 text-[11px] text-slate-500">
          Variables: {PROMPT_VARIABLES.map((v) => <code key={v} className="mr-1.5 rounded bg-white px-1 py-0.5 text-[10px] text-indigo-700" title={VARIABLE_LABELS[v]}>{`{${v}}`}</code>)}
        </p>
        <p className="mt-2 text-[11px] text-slate-500">Keep each prompt to one area. A prompt that asks ScoutAI to review everything at once is slow and more likely to run out of time.</p>
      </div>

      {handedOff && dirty && (
        <p className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-900">
          A prompt drafted on the ScoutAI review page is added at the bottom, open for editing. Check it, then press Save to add it to the library.
        </p>
      )}

      <ul className="space-y-2">
        {draft.map((prompt, index) => {
          const open = openId === prompt.id;
          const original = DEFAULT_SCOUT_PROMPTS.find((d) => d.id === prompt.id);
          const edited = Boolean(original && !same(original, prompt));
          return (
            <li key={prompt.id} id={`scout-prompt-${prompt.id}`} className={`rounded-xl border bg-white ${prompt.enabled ? "border-slate-200" : "border-dashed border-slate-300 opacity-70"}`}>
              <div className="flex items-center gap-2 px-3 py-2.5">
                <button type="button" onClick={() => setOpenId(open ? null : prompt.id)} className="text-slate-400 hover:text-slate-700 cursor-pointer" aria-label={open ? "Collapse" : "Edit"}>
                  {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
                <button type="button" onClick={() => setOpenId(open ? null : prompt.id)} className="min-w-0 flex-1 text-left cursor-pointer">
                  <span className="text-sm font-semibold text-slate-800">{prompt.title || "Untitled prompt"}</span>
                  <span className="ml-2 text-[11px] text-slate-500">{prompt.category} · {MODE_LABELS[prompt.mode]}{prompt.needs.length ? ` · needs ${prompt.needs.map((n) => NEED_LABELS[n].replace(/ (linked to|in) this plan$/, "")).join(", ")}` : ""}</span>
                  {edited && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">Edited</span>}
                  {!prompt.builtIn && <span className="ml-2 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">Custom</span>}
                </button>
                <button type="button" onClick={() => update(prompt.id, { featured: !prompt.featured })} title={prompt.featured ? "Shown as a quick suggestion" : "Not a quick suggestion"} className="cursor-pointer disabled:cursor-default">
                  <Star className={`w-4 h-4 ${prompt.featured ? "fill-amber-400 text-amber-500" : "text-slate-300"}`} />
                </button>
                <label className="flex items-center gap-1 text-[11px] text-slate-600">
                  <input type="checkbox" checked={prompt.enabled} onChange={(e) => update(prompt.id, { enabled: e.target.checked })} /> On
                </label>
                <button type="button" onClick={() => move(prompt.id, -1)} disabled={index === 0} className="text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer" aria-label="Move up"><ArrowUp className="w-3.5 h-3.5" /></button>
                <button type="button" onClick={() => move(prompt.id, 1)} disabled={index === draft.length - 1} className="text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer" aria-label="Move down"><ArrowDown className="w-3.5 h-3.5" /></button>
              </div>
              {open && (
                <div className="space-y-3 border-t border-slate-100 px-4 py-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-[11px] font-semibold text-slate-600">Title
                      <input value={prompt.title} maxLength={80} onChange={(e) => update(prompt.id, { title: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm" />
                    </label>
                    <label className="block text-[11px] font-semibold text-slate-600">Category
                      <input value={prompt.category} maxLength={40} list="scout-prompt-categories" onChange={(e) => update(prompt.id, { category: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm" />
                    </label>
                  </div>
                  <label className="block text-[11px] font-semibold text-slate-600">Prompt
                    <textarea value={prompt.text} maxLength={1500} rows={4} onChange={(e) => update(prompt.id, { text: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm leading-relaxed" />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-[11px] font-semibold text-slate-600">Kind of question
                      <select value={prompt.mode} onChange={(e) => update(prompt.id, { mode: e.target.value as PromptMode })} className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm">
                        {PROMPT_MODES.map((m) => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
                      </select>
                      <span className="mt-1 block font-normal text-slate-500">Past-performance analysis reads the campaign data and gets more time; use it only for prompts about past or live campaigns.</span>
                    </label>
                    <fieldset className="text-[11px] font-semibold text-slate-600">Only available when the plan has
                      <div className="mt-1 space-y-1 font-normal">
                        {PROMPT_NEEDS.map((n: PromptNeed) => (
                          <label key={n} className="flex items-center gap-1.5 text-slate-700">
                            <input
                              type="checkbox"
                              checked={prompt.needs.includes(n)}
                              onChange={(e) => update(prompt.id, { needs: e.target.checked ? [...prompt.needs, n] : prompt.needs.filter((x) => x !== n) })}
                            /> {NEED_LABELS[n]}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </div>
                  <div className="flex justify-end gap-2">
                    {edited && original && (
                      <button type="button" onClick={() => update(prompt.id, { ...original })} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer">
                        <RotateCcw className="w-3.5 h-3.5" /> Reset to default
                      </button>
                    )}
                    {!prompt.builtIn && (
                      <button type="button" onClick={() => setDraft((list) => list.filter((p) => p.id !== prompt.id))} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 cursor-pointer">
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <datalist id="scout-prompt-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={add} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white cursor-pointer">
          <Plus className="w-3.5 h-3.5" /> Add a prompt
        </button>
        <div className="flex items-center gap-2">
          <button type="button" onClick={resetAll} disabled={status === "saving"} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer">
            <RotateCcw className="w-3.5 h-3.5" /> Reset all to built-in
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || !validation.valid || status === "saving"}
            title={readOnly ? "Only administrators can change the prompt library." : undefined}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300 cursor-pointer disabled:cursor-not-allowed"
          >
            {status === "saving" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save prompt library
          </button>
        </div>
      </div>

      {dirty && !validation.valid && (
        <ul className="list-disc space-y-0.5 rounded-xl border border-amber-200 bg-amber-50 py-2 pl-7 pr-3 text-xs text-amber-900">
          {validation.errors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          <p>{error}</p>
          {reasons.length > 0 && <ul className="mt-1 list-disc pl-5">{reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
          {error.startsWith("Someone else") && <button type="button" onClick={load} className="mt-1.5 font-bold underline cursor-pointer">Reload</button>}
        </div>
      )}
      {notice && !dirty && <p className="text-xs text-emerald-700">{notice}</p>}
      {saved?.updatedBy && <p className="text-[11px] text-slate-400">Last saved by {saved.updatedBy}{saved.updatedAt ? ` on ${new Date(saved.updatedAt).toLocaleString()}` : ""}.</p>}
    </section>
  );
}
