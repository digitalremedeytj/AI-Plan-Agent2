import React from "react";
import { Loader2, Plus, Save, Trash2, Users, X } from "lucide-react";
import * as api from "../api/client";
import { parsePeopleList } from "../people/people";
import { toPersonKey } from "../usage/usageSummary";

// Settings -> People (admins): everyone who has signed in with Google or been added ahead of
// their first sign-in, and the names recorded before Google sign-in, which an admin gives to the
// right person. Adding people ahead of time means their old plans are already theirs the first
// time they sign in. Giving a name to someone merges
// their plans, usage and dashboard numbers under them; taking it away splits them back out. Stored
// records are never changed (src/people/people.ts).

const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

export function PeoplePanel() {
  const [directory, setDirectory] = React.useState<api.PeopleDirectory | null>(null);
  const [draft, setDraft] = React.useState<api.DirectoryPerson[]>([]);
  const [busy, setBusy] = React.useState<"load" | "save" | null>("load");
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [pasted, setPasted] = React.useState("");

  const load = React.useCallback(() => {
    setBusy("load");
    setError(null);
    api.fetchPeople()
      .then((result) => {
        setDirectory(result);
        setDraft(result.people);
      })
      .catch((err) => setError(err?.message || "People could not be loaded."))
      .finally(() => setBusy(null));
  }, []);
  React.useEffect(load, [load]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(directory?.people ?? []);
  const claimed = new Map<string, string>();
  for (const person of draft) for (const name of [person.displayName, ...person.aliases]) claimed.set(toPersonKey(name), person.email);
  const unassigned = (directory?.names ?? [])
    .filter((n) => !claimed.has(toPersonKey(n.name)))
    .sort((a, b) => b.plans - a.plans || a.name.localeCompare(b.name));
  const plansFor = (name: string) => directory?.names?.find((n) => toPersonKey(n.name) === toPersonKey(name))?.plans ?? 0;

  const update = (email: string, change: (p: api.DirectoryPerson) => api.DirectoryPerson) => {
    setNotice(null);
    setDraft((list) => list.map((p) => (p.email === email ? change(p) : p)));
  };
  const giveName = (name: string, email: string) => update(email, (p) => ({ ...p, aliases: [...p.aliases, name] }));
  const takeName = (email: string, name: string) => update(email, (p) => ({ ...p, aliases: p.aliases.filter((a) => a !== name) }));
  const removePerson = (email: string) => {
    setNotice(null);
    setDraft((list) => list.filter((p) => p.email !== email));
  };

  const addPasted = () => {
    const { people, invalid } = parsePeopleList(pasted);
    const known = new Set(draft.map((p) => p.email));
    const added = people.filter((p) => !known.has(p.email) && (known.add(p.email), true));
    setDraft((list) => [...list, ...added.map((p) => ({ ...p, aliases: [] }))]);
    setPasted(invalid.join("\n"));
    setError(invalid.length ? `No email address found on ${invalid.length === 1 ? "this line" : "these lines"}; they are left in the box.` : null);
    setNotice(added.length ? `Added ${added.length} ${added.length === 1 ? "person" : "people"}${people.length > added.length ? ` (${people.length - added.length} already listed)` : ""}. Link their old names, then save.` : null);
  };

  const save = async () => {
    setBusy("save");
    setError(null);
    setNotice(null);
    try {
      const saved = await api.savePeople(draft, directory?.revision ?? 0);
      setDirectory((d) => ({ ...saved, names: d?.names }));
      setDraft(saved.people);
      setNotice("Saved. Plans, usage and the dashboard now count these names under each person.");
    } catch (err: any) {
      setError(err?.message || "People could not be saved.");
    } finally {
      setBusy(null);
    }
  };

  const sortedPeople = [...draft].sort((a, b) => a.displayName.localeCompare(b.displayName));

  return (
    <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/70 via-white to-white p-5 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-base font-bold text-slate-900"><Users className="h-4 w-4 text-indigo-600" /> People</h3>
          <p className="mt-0.5 max-w-2xl text-xs text-slate-500">
            Everyone who has signed in with Google, or been added ahead of time. Give each person the names they used before
            Google sign-in, and their plans, usage and dashboard numbers are counted under them. Nothing saved is changed:
            remove a name to undo.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save changes
        </button>
      </div>

      {error ? <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800">{error}</p> : null}
      {notice ? <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-800">{notice}</p> : null}

      {busy === "load" ? (
        <div className="flex justify-center p-6"><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></div>
      ) : (
        <>
          <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {sortedPeople.length === 0 ? (
              <li className="p-4 text-center text-xs text-slate-500">Nobody has signed in with Google or been added yet.</li>
            ) : (
              sortedPeople.map((person) => (
                <li key={person.email} className="space-y-2 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={person.displayName}
                      onChange={(e) => update(person.email, (p) => ({ ...p, displayName: e.target.value }))}
                      maxLength={60}
                      aria-label={`Display name for ${person.email}`}
                      className="w-56 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-slate-900 focus:border-indigo-400 focus:outline-none"
                    />
                    <span className="text-xs text-slate-500">{person.email}</span>
                    {person.firstSignInAt ? (
                      <span className="text-[11px] text-slate-400">since {fmt(person.firstSignInAt)}</span>
                    ) : (
                      <>
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Not signed in yet</span>
                        <button type="button" onClick={() => removePerson(person.email)} aria-label={`Remove ${person.email}`} className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50">
                          <Trash2 className="h-3 w-3" /> Remove
                        </button>
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-slate-500">Also recorded as:</span>
                    {person.aliases.length === 0 ? <span className="text-[11px] text-slate-400">no other names</span> : null}
                    {person.aliases.map((alias) => (
                      <span key={alias} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-800">
                        {alias}
                        <span className="font-normal text-indigo-500">{plansFor(alias)} plans</span>
                        <button type="button" onClick={() => takeName(person.email, alias)} aria-label={`Remove ${alias} from ${person.displayName}`} className="rounded-full p-0.5 hover:bg-indigo-100">
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </li>
              ))
            )}
          </ul>

          <div className="mt-4">
            <label htmlFor="people-paste" className="text-xs font-bold text-slate-700">Add people before they sign in</label>
            <p className="text-xs text-slate-500">
              One per line: <span className="font-mono">Jane Doe, jane@digitalremedy.com</span>. Their first Google sign-in uses the name and
              links you set here.
            </p>
            <textarea
              id="people-paste"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={3}
              placeholder={"Jane Doe, jane@digitalremedy.com\nChris Lee <chris@digitalremedy.com>"}
              className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs focus:border-indigo-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={addPasted}
              disabled={!pasted.trim() || busy !== null}
              className="mt-1 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Add to list
            </button>
          </div>

          <div className="mt-5">
            <p className="text-xs font-bold text-slate-700">Names not given to anyone yet</p>
            <p className="text-xs text-slate-500">Typed at the team-password sign-in. Pick who each one belongs to.</p>
            <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {unassigned.length === 0 ? (
                <li className="p-4 text-center text-xs text-slate-500">Every recorded name belongs to someone.</li>
              ) : (
                unassigned.map((n) => (
                  <li key={n.name} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                    <div className="min-w-0">
                      <span className="text-sm font-semibold text-slate-900">{n.name}</span>
                      <span className="ml-2 text-xs text-slate-500">{n.plans} plan{n.plans === 1 ? "" : "s"} · last seen {fmt(n.lastSeenAt)}</span>
                    </div>
                    <select
                      value=""
                      onChange={(e) => e.target.value && giveName(n.name, e.target.value)}
                      disabled={sortedPeople.length === 0}
                      aria-label={`Give ${n.name} to`}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:border-indigo-400 focus:outline-none disabled:opacity-50"
                    >
                      <option value="">Give to…</option>
                      {sortedPeople.map((p) => (
                        <option key={p.email} value={p.email}>{p.displayName} ({p.email})</option>
                      ))}
                    </select>
                  </li>
                ))
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
