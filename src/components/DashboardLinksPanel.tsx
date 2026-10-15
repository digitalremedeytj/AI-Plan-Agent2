import React from "react";
import { Check, Copy, ExternalLink, History, Link2, Loader2, Plus, Save, XCircle } from "lucide-react";
import * as api from "../api/client";
import type { DashboardConfig, DashboardLink } from "../storage/types";

// Settings -> Usage: the admin side of the leadership dashboard. View-only links (named, never
// expiring, turned off one at a time), the test accounts every dashboard number leaves out,
// and the one-time import of history from saved plans.

const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "never");

export function DashboardLinksPanel() {
  const [links, setLinks] = React.useState<DashboardLink[]>([]);
  const [config, setConfig] = React.useState<DashboardConfig | null>(null);
  const [excludedDraft, setExcludedDraft] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>("load");
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [copiedToken, setCopiedToken] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    setBusy("load");
    api.listDashboardLinks()
      .then((result) => {
        setLinks(result.links);
        setConfig(result.config);
        setExcludedDraft(result.config.excludedNames.join("\n"));
      })
      .catch((err) => setError(err?.message || "Dashboard links could not be loaded."))
      .finally(() => setBusy(null));
  }, []);
  React.useEffect(load, [load]);

  const run = async (name: string, action: () => Promise<void>) => {
    setBusy(name);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (err: any) {
      setError(err?.message || "That did not work. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const create = () => run("create", async () => {
    const link = await api.createDashboardLink(label.trim() || "AI Plan Agent Dashboard");
    setLinks((list) => [link, ...list]);
    setLabel("");
    await copy(link.token);
  });

  const revoke = (link: DashboardLink) => {
    if (!confirm(`Turn off "${link.label}"? Anyone using it will lose access immediately. Other links keep working.`)) return;
    void run(`revoke:${link.token}`, async () => {
      const updated = await api.revokeDashboardLink(link.token);
      setLinks((list) => list.map((l) => (l.token === link.token ? updated : l)));
    });
  };

  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(api.dashboardLinkUrl(token));
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2500);
    } catch {
      setError("Your browser blocked copying. Open the dashboard from the link instead.");
    }
  };

  const saveExcluded = () => run("excluded", async () => {
    const excludedNames = excludedDraft.split(/[\n,]/).map((n) => n.trim()).filter(Boolean);
    const saved = await api.saveDashboardConfig({ hoursPerPlan: config?.hoursPerPlan ?? 1, excludedNames });
    setConfig(saved);
    setExcludedDraft(saved.excludedNames.join("\n"));
    setNotice("Excluded names saved.");
  });

  const backfill = () => run("backfill", async () => {
    const result = await api.backfillDashboardHistory();
    setNotice(
      result.generations || result.shares
        ? `Imported ${result.generations} plan${result.generations === 1 ? "" : "s"} and ${result.shares} share link${result.shares === 1 ? "" : "s"} from ${result.plansScanned} saved plans.`
        : `Nothing new to import: all ${result.plansScanned} saved plans are already counted.`,
    );
  });

  const active = links.filter((l) => !l.revoked);
  const revoked = links.filter((l) => l.revoked);

  return (
    <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/70 via-white to-white p-5 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-base font-bold text-slate-900"><Link2 className="h-4 w-4 text-indigo-600" /> AI Plan Agent Dashboard</h3>
          <p className="mt-0.5 max-w-xl text-xs text-slate-500">
            Headline numbers and charts for leadership. Share a view-only link: it needs no sign-in, never expires, and can be
            turned off at any time. It shows people's and advertisers' names.
          </p>
        </div>
        <a
          href="/dashboard"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700"
        >
          Open dashboard <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      {error ? <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800">{error}</p> : null}
      {notice ? <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-800">{notice}</p> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
          placeholder="Link name, e.g. Leadership weekly"
          maxLength={60}
          className="min-w-56 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void create()}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
        >
          {busy === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create &amp; copy link
        </button>
      </div>

      <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {busy === "load" ? (
          <li className="flex justify-center p-4"><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></li>
        ) : active.length === 0 ? (
          <li className="p-4 text-center text-xs text-slate-500">No active links yet.</li>
        ) : (
          active.map((link) => (
            <li key={link.token} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{link.label}</p>
                <p className="text-xs text-slate-500">
                  Created by {link.createdBy} on {fmt(link.createdAt)} · opened {link.viewCount || 0} time{link.viewCount === 1 ? "" : "s"}, last {fmt(link.lastViewedAt)}
                </p>
              </div>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => void copy(link.token)} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50">
                  {copiedToken === link.token ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copiedToken === link.token ? "Copied" : "Copy link"}
                </button>
                <button
                  type="button"
                  onClick={() => revoke(link)}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                >
                  <XCircle className="h-3.5 w-3.5" /> Turn off
                </button>
              </div>
            </li>
          ))
        )}
      </ul>
      {revoked.length ? (
        <p className="mt-2 text-xs text-slate-400">
          Turned off: {revoked.map((l) => `${l.label} (${fmt(l.revokedAt)})`).join(", ")}
        </p>
      ) : null}

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="dashboard-excluded" className="text-xs font-bold text-slate-700">Leave out of the dashboard</label>
          <p className="text-xs text-slate-500">Test or internal accounts, one name per line. Matched however they are capitalised.</p>
          <textarea
            id="dashboard-excluded"
            value={excludedDraft}
            onChange={(e) => setExcludedDraft(e.target.value)}
            rows={3}
            className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void saveExcluded()}
            disabled={busy !== null || !config}
            className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
          >
            {busy === "excluded" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save names
          </button>
        </div>
        <div>
          <p className="text-xs font-bold text-slate-700">History from before tracking</p>
          <p className="text-xs text-slate-500">
            Counts every saved plan as a generated plan, dated and attributed as it was saved, and every shared plan as a share
            link. Safe to run more than once: nothing is counted twice.
          </p>
          <button
            type="button"
            onClick={() => void backfill()}
            disabled={busy !== null}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {busy === "backfill" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <History className="h-3.5 w-3.5" />} Import history from saved plans
          </button>
        </div>
      </div>
    </div>
  );
}
