import React from "react";
import { Download, Loader2, RefreshCw } from "lucide-react";
import * as api from "../api/client";
import type { UsageSummary } from "../usage/usageSummary";
import { DashboardLinksPanel } from "./DashboardLinksPanel";

// Settings tab: who is using the app and how, read from the server-side usage log. Admin-only,
// like the rest of Settings' writable tabs, because it names people. Google Analytics carries
// the same activity without names; this is the per-person view leadership asks for.

const RANGES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "12 months" },
];

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadPeopleCsv(summary: UsageSummary, days: number) {
  const header = ["Name", "Plans generated", "Failed runs", "Share links", "Exports", "Active days", "Total actions", "Last active"];
  const rows = summary.people.map((p) => [p.name, p.generated, p.failedGenerations, p.shared, p.exports, p.activeDays, p.total, p.lastActiveAt]);
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = href;
  link.download = `ai_plan_agent_usage_${days}d.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

function Tile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function UsageReport() {
  const [days, setDays] = React.useState(30);
  const [summary, setSummary] = React.useState<UsageSummary | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    setLoading(true);
    setError(null);
    api.getUsageSummary(days)
      .then(setSummary)
      .catch((err) => setError(err?.message || "Usage could not be loaded."))
      .finally(() => setLoading(false));
  }, [days]);
  React.useEffect(load, [load]);

  const totals = summary?.totals ?? {};
  const generation = summary?.generation;
  const maxWeekly = Math.max(1, ...(summary?.weeks ?? []).map((w) => w.generated));

  return (
    <section className="space-y-5">
      <DashboardLinksPanel />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-900">Usage</h3>
          <p className="text-xs text-slate-500">
            Recorded by the server as people use the app. Names are as typed at sign-in; different capitalisations are grouped together.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label="Date range">
            {RANGES.map((range) => (
              <button
                key={range.days}
                type="button"
                onClick={() => setDays(range.days)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold ${days === range.days ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {range.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={load} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Refresh usage">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p> : null}

      {summary ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Active people" value={summary.activePeople} />
            <Tile
              label="Plans generated"
              value={(generation?.count ?? 0) - (generation?.failed ?? 0)}
              hint={generation?.failed ? `${generation.failed} failed or abandoned` : undefined}
            />
            <Tile label="Median run" value={generation?.medianMinutes != null ? `${generation.medianMinutes} min` : "–"} />
            <Tile label="Share links created" value={totals.share_create ?? 0} />
            <Tile label="Share link views" value={totals.share_view ?? 0} hint="Includes planners previewing their own links" />
            <Tile label="Exports" value={totals.export ?? 0} />
            <Tile label="ScoutAI questions" value={totals.scout_chat ?? 0} />
            <Tile label="Slides generated" value={totals.slide_generate ?? 0} />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h4 className="text-sm font-bold text-slate-900">By person</h4>
              <button
                type="button"
                onClick={() => downloadPeopleCsv(summary, days)}
                disabled={summary.people.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" /> CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Name</th>
                    <th className="px-3 py-2 text-right">Plans</th>
                    <th className="px-3 py-2 text-right">Shared</th>
                    <th className="px-3 py-2 text-right">Exports</th>
                    <th className="px-3 py-2 text-right">Active days</th>
                    <th className="px-4 py-2 text-right">Last active</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.people.map((person) => (
                    <tr key={person.name.toLowerCase()}>
                      <td className="px-4 py-2 font-medium text-slate-900">{person.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {person.generated}
                        {person.failedGenerations ? <span className="ml-1 text-xs text-rose-600">({person.failedGenerations} failed)</span> : null}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{person.shared}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{person.exports}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{person.activeDays}</td>
                      <td className="px-4 py-2 text-right text-slate-500">{fmtDate(person.lastActiveAt)}</td>
                    </tr>
                  ))}
                  {summary.people.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">No activity in this period.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white shadow-xs">
              <h4 className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">By advertiser</h4>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Advertiser</th>
                    <th className="px-3 py-2 text-right">Plans</th>
                    <th className="px-4 py-2 text-right">Share views</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.advertisers.slice(0, 25).map((advertiser) => (
                    <tr key={advertiser.name.toLowerCase()}>
                      <td className="px-4 py-2">
                        <span className="font-medium text-slate-900">{advertiser.name}</span>
                        {advertiser.people.length ? <span className="block text-xs text-slate-500">{advertiser.people.join(", ")}</span> : null}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{advertiser.generated}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{advertiser.shareViews}</td>
                    </tr>
                  ))}
                  {summary.advertisers.length === 0 ? (
                    <tr><td colSpan={3} className="px-4 py-6 text-center text-slate-500">No plans in this period.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white shadow-xs">
              <h4 className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">By week</h4>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Week of</th>
                    <th className="px-3 py-2">Plans generated</th>
                    <th className="px-3 py-2 text-right">People</th>
                    <th className="px-4 py-2 text-right">Share views</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.weeks.map((week) => (
                    <tr key={week.weekStart}>
                      <td className="px-4 py-2 text-slate-600">{fmtDate(`${week.weekStart}T12:00:00Z`)}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-2 rounded-full bg-indigo-500" style={{ width: `${Math.max(2, (week.generated / maxWeekly) * 100)}px` }} />
                          <span className="tabular-nums">{week.generated}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{week.activePeople}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{week.shareViews}</td>
                    </tr>
                  ))}
                  {summary.weeks.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-500">No activity in this period.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
