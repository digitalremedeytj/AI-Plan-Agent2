import React from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  ArrowDownRight, ArrowUpRight, Building2, CalendarDays, Check, Clock, ClipboardCopy, DollarSign, Eye, FileText,
  Link2, Loader2, Lock, Minus, Printer, Sparkles, Users,
} from "lucide-react";
import * as api from "../api/client";
import { ApiError } from "../api/client";
import { identifyDashboardViewer, identifyUser, track, trackScreen } from "../analytics";
import type { DashboardData, Kpi } from "../usage/dashboard";
import drIconWhite from "../images/dr-icon-white.png";
import {
  formatHours, formatMoney, formatNumber, formatRange, isPreset, kpiChange, presetDays, RANGE_PRESETS, rangeFromDates,
  toDateInput, weeklySummaryText, type RangePreset,
} from "./dashboardFormat";

/**
 * The leadership dashboard at /dashboard.
 *
 * Two ways in: an admin session, or a view-only link (/dashboard#key=dash_...). The key lives
 * after "#" so the browser never sends it to the server in the address, and GA never sees it
 * (src/analytics.ts reports a synthetic location). An optional "range" in the same fragment
 * (#key=...&range=7d) picks the opening date range, for links in a weekly email.
 */

const COLORS = {
  plans: "#4f46e5",
  users: "#0d9488",
  views: "#f59e0b",
  grid: "#e2e8f0",
  axis: "#64748b",
};
const CHANNEL_SHADES = ["#4338ca", "#4f46e5", "#6366f1", "#818cf8", "#a5b4fc", "#c7d2fe"];

function readHash(): { key: string | null; range: Exclude<RangePreset, "custom"> | null } {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const range = params.get("range");
  return { key: params.get("key"), range: isPreset(range) ? range : null };
}

const shortDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function Delta({ kpi, invert = false }: { kpi: Kpi; invert?: boolean }) {
  const change = kpiChange(kpi);
  if (!change) return <span className="text-xs text-slate-400">No prior activity</span>;
  const good = change.direction === "flat" ? null : (change.direction === "up") !== invert;
  const Icon = change.direction === "up" ? ArrowUpRight : change.direction === "down" ? ArrowDownRight : Minus;
  const tone = good === null ? "bg-slate-100 text-slate-600" : good ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700";
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>
      <Icon className="h-3 w-3" />
      {change.label}
    </span>
  );
}

function KpiCard({ icon: Icon, label, value, kpi, footnote, accent, children }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  kpi?: Kpi;
  footnote?: React.ReactNode;
  accent: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="relative min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm break-inside-avoid sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 sm:text-xs">{label}</p>
        <span className={`rounded-lg p-1.5 ${accent}`}><Icon className="h-4 w-4" /></span>
      </div>
      <p className="mt-2 font-display text-2xl font-bold tabular-nums tracking-tight text-slate-900 sm:text-3xl">{value}</p>
      <div className="mt-2 flex min-h-6 flex-wrap items-center gap-2">
        {kpi ? <Delta kpi={kpi} /> : null}
        {footnote ? <span className="text-xs text-slate-500">{footnote}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Card({ title, subtitle, children, className = "" }: { title: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm break-inside-avoid ${className}`}>
      <h2 className="font-display text-base font-bold text-slate-900">{title}</h2>
      {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex h-40 items-center justify-center rounded-xl bg-slate-50 text-sm text-slate-500">{children}</div>;
}

function ChartTooltip({ active, payload, label, money }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      {label ? <p className="mb-1 font-semibold text-slate-900">{label}</p> : null}
      {payload.map((entry: any) => (
        <p key={entry.dataKey} className="flex items-center gap-1.5 text-slate-600">
          <span className="h-2 w-2 rounded-full" style={{ background: entry.color || entry.payload?.fill }} />
          {entry.name}: <span className="font-semibold text-slate-900">{money ? formatMoney(entry.value, false) : formatNumber(entry.value)}</span>
        </p>
      ))}
    </div>
  );
}

function Funnel({ funnel }: { funnel: DashboardData["funnel"] }) {
  const steps = [
    { label: "Plans generated", value: funnel.generated, color: "bg-indigo-600" },
    { label: "Shared with a client", value: funnel.shared, color: "bg-indigo-400" },
    { label: "Opened by the client", value: funnel.viewed, color: "bg-amber-400" },
  ];
  if (funnel.generated === 0) return <Empty>No plans generated in this period.</Empty>;
  return (
    <div className="space-y-4">
      {steps.map((step, i) => {
        const pctOfFirst = (step.value / funnel.generated) * 100;
        const prev = i > 0 ? steps[i - 1].value : null;
        return (
          <div key={step.label}>
            <div className="mb-1.5 flex items-baseline justify-between text-sm">
              <span className="font-medium text-slate-700">{step.label}</span>
              <span className="tabular-nums">
                <span className="font-display text-lg font-bold text-slate-900">{formatNumber(step.value)}</span>
                {prev !== null ? (
                  <span className="ml-2 text-xs text-slate-500">{prev ? Math.round((step.value / prev) * 100) : 0}% of previous step</span>
                ) : null}
              </span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${step.color}`} style={{ width: `${Math.max(step.value ? 2 : 0, pctOfFirst)}%` }} />
            </div>
          </div>
        );
      })}
      <p className="text-xs text-slate-500">Follows the plans generated in this period, whenever they were shared or opened.</p>
    </div>
  );
}

function HoursEditor({ value, onChange, canSave }: { value: number; onChange: (v: number) => void; canSave: boolean }) {
  const [draft, setDraft] = React.useState(String(value));
  React.useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n) && n > 0 && n <= 200) onChange(Math.round(n * 100) / 100);
    else setDraft(String(value));
  };
  return (
    <label className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3 text-xs text-slate-500 print:hidden">
      <span>Hours per plan</span>
      <input
        type="number"
        min={0.25}
        max={200}
        step={0.25}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="w-16 rounded-md border border-slate-200 px-1.5 py-0.5 text-right font-semibold text-slate-900 tabular-nums focus:border-indigo-400 focus:outline-none"
        aria-label="Manual hours one plan replaces"
      />
      <span className="text-[11px]">{canSave ? "saved for everyone" : "for your view only"}</span>
    </label>
  );
}

export default function DashboardPage() {
  const initial = React.useMemo(readHash, []);
  const [key] = React.useState<string | null>(initial.key);
  const [preset, setPreset] = React.useState<RangePreset>(initial.range ?? "30d");
  const [days, setDays] = React.useState(() => presetDays(initial.range ?? "30d"));
  const [data, setData] = React.useState<DashboardData | null>(null);
  const [viewer, setViewer] = React.useState<api.DashboardViewer | null>(null);
  const [hoursPerPlan, setHoursPerPlan] = React.useState<number | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ready" | "denied" | "error">("loading");
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [shareLinkForSummary, setShareLinkForSummary] = React.useState<string | null>(null);
  const firstLoad = React.useRef(true);

  // Take the key out of the visible address once read, so a screenshot or screen-share of the
  // page does not show it. A reload still works for the rest of the browser session.
  React.useEffect(() => {
    document.title = "AI Plan Agent · Leadership Dashboard";
    if (key) {
      try { sessionStorage.setItem("apa_dashboard_key", key); } catch { /* storage may be blocked */ }
      window.history.replaceState(null, "", "/dashboard");
    }
  }, [key]);
  const effectiveKey = React.useMemo(() => {
    if (key) return key;
    try { return sessionStorage.getItem("apa_dashboard_key"); } catch { return null; }
  }, [key]);

  const load = React.useCallback(async () => {
    setStatus((s) => (s === "ready" ? "ready" : "loading"));
    setError(null);
    try {
      const range = rangeFromDates(days.fromDay, days.toDay);
      const result = await api.getDashboardData(range, { key: effectiveKey, firstLoad: firstLoad.current });
      if (firstLoad.current) {
        firstLoad.current = false;
        if (result.viewer.via === "link") identifyDashboardViewer();
        trackScreen("dashboard");
      }
      setData(result.data);
      setViewer(result.viewer);
      setHoursPerPlan((h) => h ?? result.data.hoursPerPlan);
      setStatus("ready");
    } catch (err: any) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setStatus("denied");
      } else {
        setError(err?.message || "The dashboard could not be loaded.");
        setStatus("error");
      }
    }
  }, [days, effectiveKey]);
  React.useEffect(() => { void load(); }, [load]);

  // Signed-in admins: attribute GA hits to them, and offer their newest active link in the summary.
  React.useEffect(() => {
    if (viewer?.via !== "admin") return;
    api.fetchSession().then((session) => identifyUser(session)).catch(() => undefined);
    api.listDashboardLinks()
      .then(({ links }) => {
        const active = links.find((l) => !l.revoked);
        setShareLinkForSummary(active ? active.token : null);
      })
      .catch(() => undefined);
  }, [viewer?.via]);

  const choosePreset = (id: Exclude<RangePreset, "custom">) => {
    setPreset(id);
    setDays(presetDays(id));
    track("dashboard_range", { range: id });
  };

  const isAdmin = viewer?.via === "admin";
  const hours = hoursPerPlan ?? data?.hoursPerPlan ?? 1;
  const changeHours = (value: number) => {
    setHoursPerPlan(value);
    if (!isAdmin) return;
    api.listDashboardLinks()
      .then(({ config }) => api.saveDashboardConfig({ hoursPerPlan: value, excludedNames: config.excludedNames }))
      .catch((err) => setError(err?.message || "The hours per plan could not be saved."));
  };

  const copySummary = async () => {
    if (!data) return;
    // The link opens on the range being summarised, so "last 7 days" in the email is what they see.
    const token = effectiveKey ?? shareLinkForSummary;
    const link = token ? api.dashboardLinkUrl(token, preset === "custom" ? undefined : preset) : null;
    try {
      await navigator.clipboard.writeText(weeklySummaryText(data, hours, link));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      track("dashboard_copy_summary");
    } catch {
      setError("Your browser blocked copying. Select the numbers and copy them manually.");
    }
  };

  if (status === "denied") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 font-sans">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><Lock className="h-6 w-6" /></div>
          <h1 className="font-display text-xl font-bold text-slate-900">Dashboard access needed</h1>
          <p className="text-sm text-slate-500">
            {effectiveKey
              ? "This dashboard link is not valid or has been turned off. Ask the person who sent it for a new one."
              : "Sign in to AI Plan Agent with the administrator password to see the dashboard, or open the dashboard link you were sent."}
          </p>
          {!effectiveKey ? (
            <a href="/" className="inline-block rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">Go to sign in</a>
          ) : null}
        </div>
      </div>
    );
  }

  const kpis = data?.kpis;
  const series = (data?.series ?? []).map((p) => ({ ...p, label: shortDay(p.start) }));
  const channelTotal = (data?.channels ?? []).reduce((n, c) => n + c.budget, 0);
  const maxUserPlans = Math.max(1, ...(data?.users ?? []).map((u) => u.plans));
  const adoptionMax = Math.max(1, ...(data?.adoption ?? []).map((a) => a.people));

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 print:bg-white">
      <header className="bg-gradient-to-br from-slate-950 via-indigo-950 to-indigo-800 text-white print:bg-none print:text-slate-900">
        <div className="mx-auto max-w-7xl px-4 pb-24 pt-6 sm:px-6 lg:px-8 print:pb-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-white/10 p-2 ring-1 ring-white/20 print:bg-indigo-600">
                <img src={drIconWhite} alt="Digital Remedy" className="h-full w-full object-contain" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-indigo-200 print:text-indigo-700">AI Plan Agent</p>
                <h1 className="font-display text-xl font-bold sm:text-2xl">Leadership Dashboard</h1>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 print:hidden">
              <button
                type="button"
                onClick={copySummary}
                disabled={!data}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-sm font-semibold text-indigo-900 shadow-sm hover:bg-indigo-50 disabled:opacity-50"
              >
                {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <ClipboardCopy className="h-4 w-4" />}
                {copied ? "Copied" : "Copy weekly summary"}
              </button>
              <button
                type="button"
                onClick={() => { track("dashboard_print"); window.print(); }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3.5 py-2 text-sm font-semibold text-white ring-1 ring-white/20 hover:bg-white/20"
              >
                <Printer className="h-4 w-4" /> Print / PDF
              </button>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-1 rounded-xl bg-white/10 p-1 ring-1 ring-white/15 print:hidden" role="group" aria-label="Date range">
              {RANGE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => choosePreset(p.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${preset === p.id ? "bg-white text-indigo-900 shadow-sm" : "text-indigo-100 hover:bg-white/10"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-1.5 text-xs ring-1 ring-white/15 print:hidden">
              <CalendarDays className="h-4 w-4 text-indigo-200" />
              <input
                type="date"
                value={days.fromDay}
                max={days.toDay}
                onChange={(e) => { if (e.target.value) { setPreset("custom"); setDays((d) => ({ ...d, fromDay: e.target.value })); } }}
                className="bg-transparent font-semibold text-white [color-scheme:dark] focus:outline-none"
                aria-label="Start date"
              />
              <span className="text-indigo-200">to</span>
              <input
                type="date"
                value={days.toDay}
                min={days.fromDay}
                max={toDateInput(new Date())}
                onChange={(e) => { if (e.target.value) { setPreset("custom"); setDays((d) => ({ ...d, toDay: e.target.value })); } }}
                className="bg-transparent font-semibold text-white [color-scheme:dark] focus:outline-none"
                aria-label="End date"
              />
            </div>
            {data ? (
              <p className="text-sm text-indigo-100 print:text-slate-600">
                {formatRange(data.from, data.to)} <span className="text-indigo-300 print:text-slate-400">· compared with the {Math.round((Date.parse(data.to) - Date.parse(data.from)) / 86_400_000)} days before</span>
              </p>
            ) : null}
            {status === "loading" && data ? <Loader2 className="h-4 w-4 animate-spin text-indigo-200" /> : null}
          </div>
        </div>
      </header>

      <main className="mx-auto -mt-16 max-w-7xl space-y-5 px-4 pb-12 sm:px-6 lg:px-8 print:mt-4">
        {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p> : null}

        {!data ? (
          <div className="flex h-64 items-center justify-center rounded-2xl bg-white shadow-sm">
            {status === "error" ? (
              <button type="button" onClick={() => void load()} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">Try again</button>
            ) : (
              <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <KpiCard icon={FileText} label="Plans generated" value={formatNumber(kpis!.plans.value)} kpi={kpis!.plans} accent="bg-indigo-50 text-indigo-600" />
              <KpiCard
                icon={DollarSign}
                label="Media budget planned"
                value={formatMoney(kpis!.budget.value)}
                kpi={kpis!.budget}
                accent="bg-emerald-50 text-emerald-600"
              />
              <KpiCard icon={Users} label="Active users" value={formatNumber(kpis!.activeUsers.value)} kpi={kpis!.activeUsers} footnote={`of ${formatNumber(data.totalUsers)} total`} accent="bg-teal-50 text-teal-600" />
              <KpiCard
                icon={Clock}
                label="Time saved (est.)"
                value={`${formatHours(kpis!.plans.value * hours)} h`}
                kpi={{ value: kpis!.plans.value * hours, previous: kpis!.plans.previous * hours }}
                accent="bg-violet-50 text-violet-600"
              >
                <HoursEditor value={hours} onChange={changeHours} canSave={isAdmin} />
              </KpiCard>
              <KpiCard icon={Building2} label="Advertisers served" value={formatNumber(kpis!.advertisers.value)} kpi={kpis!.advertisers} accent="bg-sky-50 text-sky-600" />
              <KpiCard icon={Link2} label="Share links created" value={formatNumber(kpis!.shareLinks.value)} kpi={kpis!.shareLinks} accent="bg-indigo-50 text-indigo-600" />
              <KpiCard icon={Eye} label="Client views" value={formatNumber(kpis!.shareViews.value)} kpi={kpis!.shareViews} footnote="shared plans opened" accent="bg-amber-50 text-amber-600" />
              <KpiCard
                icon={Sparkles}
                label="Generation success"
                value={data.reliability.successRate === null ? "–" : `${Math.round(data.reliability.successRate * 100)}%`}
                footnote={data.reliability.medianMinutes !== null ? `median ${data.reliability.medianMinutes} min per plan` : undefined}
                accent="bg-rose-50 text-rose-600"
              />
            </div>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
              <Card title="Plans generated over time" subtitle={`Per ${data.bucket}, with active users`} className="lg:col-span-2">
                {series.every((p) => p.plans === 0 && p.activeUsers === 0) ? (
                  <Empty>No activity in this period.</Empty>
                ) : (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                        <CartesianGrid stroke={COLORS.grid} vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: COLORS.axis }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: COLORS.axis }} tickLine={false} axisLine={false} />
                        <Tooltip content={<ChartTooltip />} cursor={{ fill: "#eef2ff" }} />
                        <Bar dataKey="plans" name="Plans" fill={COLORS.plans} radius={[4, 4, 0, 0]} maxBarSize={28} />
                        <Line dataKey="activeUsers" name="Active users" stroke={COLORS.users} strokeWidth={2.5} dot={false} type="monotone" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <div className="mt-3 flex gap-4 text-xs text-slate-500">
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLORS.plans }} />Plans</span>
                  <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: COLORS.users }} />Active users</span>
                </div>
              </Card>
              <Card title="From plan to client" subtitle="How many plans reach a client">
                <Funnel funnel={data.funnel} />
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <Card title="Media budget by channel" subtitle={channelTotal ? `${formatMoney(channelTotal)} across ${data.channels.length} media types` : undefined}>
                {data.channels.length === 0 ? (
                  <Empty>No channel plans in this period.</Empty>
                ) : (
                  <div style={{ height: Math.max(180, data.channels.length * 36) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.channels} layout="vertical" margin={{ top: 0, right: 56, bottom: 0, left: 8 }}>
                        <XAxis type="number" hide />
                        <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12, fill: "#334155" }} tickLine={false} axisLine={false} />
                        <Tooltip content={<ChartTooltip money />} cursor={{ fill: "#f8fafc" }} />
                        <Bar
                          dataKey="budget"
                          name="Budget"
                          radius={[0, 6, 6, 0]}
                          barSize={20}
                          label={{ position: "right", fontSize: 11, fill: "#475569", formatter: (v: any) => formatMoney(Number(v)) }}
                        >
                          {data.channels.map((c, i) => <Cell key={c.name} fill={CHANNEL_SHADES[Math.min(i, CHANNEL_SHADES.length - 1)]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Card>

              <Card title="Top advertisers" subtitle="By plans generated">
                {data.advertisers.length === 0 ? (
                  <Empty>No advertisers in this period.</Empty>
                ) : (
                  <ul className="space-y-3">
                    {data.advertisers.slice(0, 8).map((a) => (
                      <li key={a.name}>
                        <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                          <span className="truncate font-medium text-slate-800">{a.name}</span>
                          <span className="shrink-0 tabular-nums text-slate-500">
                            <span className="font-semibold text-slate-900">{a.plans}</span> plan{a.plans === 1 ? "" : "s"}
                            {a.budget ? <span className="ml-2">· {formatMoney(a.budget)}</span> : null}
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-sky-500" style={{ width: `${(a.plans / data.advertisers[0].plans) * 100}%` }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
              <Card title="Top users" subtitle="Ranked by plans generated" className="lg:col-span-2">
                {data.users.length === 0 ? (
                  <Empty>No activity in this period.</Empty>
                ) : (
                  <div className="-mx-5 overflow-x-auto">
                    <table className="w-full min-w-[560px] text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                          <th className="w-10 px-5 py-2">#</th>
                          <th className="py-2">Name</th>
                          <th className="w-48 py-2">Plans generated</th>
                          <th className="px-3 py-2 text-right">Share links</th>
                          <th className="px-3 py-2 text-right">Client views</th>
                          <th className="px-5 py-2 text-right">Budget planned</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.users.slice(0, 10).map((u, i) => (
                          <tr key={u.name.toLowerCase()} className="hover:bg-slate-50/60">
                            <td className="px-5 py-2.5">
                              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${i === 0 ? "bg-amber-100 text-amber-800" : i === 1 ? "bg-slate-200 text-slate-700" : i === 2 ? "bg-orange-100 text-orange-800" : "text-slate-400"}`}>{i + 1}</span>
                            </td>
                            <td className="py-2.5 font-medium text-slate-900">{u.name}</td>
                            <td className="py-2.5">
                              <div className="flex items-center gap-2">
                                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                                  <div className="h-full rounded-full bg-indigo-500" style={{ width: `${(u.plans / maxUserPlans) * 100}%` }} />
                                </div>
                                <span className="w-8 text-right font-semibold tabular-nums">{u.plans}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{u.shareLinks}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{u.shareViews}</td>
                            <td className="px-5 py-2.5 text-right tabular-nums text-slate-600">{u.budget ? formatMoney(u.budget) : "–"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <Card title="Feature adoption" subtitle="People who used each feature">
                {data.adoption.every((a) => a.uses === 0) ? (
                  <Empty>No feature use recorded yet.</Empty>
                ) : (
                  <ul className="space-y-3">
                    {data.adoption.map((a) => (
                      <li key={a.action}>
                        <div className="mb-1 flex items-baseline justify-between text-sm">
                          <span className="font-medium text-slate-700">{a.label}</span>
                          <span className="tabular-nums text-xs text-slate-500">
                            <span className="text-sm font-semibold text-slate-900">{a.people}</span> {a.people === 1 ? "person" : "people"} · {formatNumber(a.uses)} uses
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-teal-500" style={{ width: `${(a.people / adoptionMax) * 100}%` }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            <footer className="space-y-1 pt-2 text-xs text-slate-500">
              <p>
                Media budget counts each brief once: the same person re-running the same advertiser and budget within a day is
                treated as one plan's budget. Time saved is plans generated × hours per plan, an estimate.
              </p>
              {data.includesBackfill ? (
                <p>Includes history imported from saved plans. Share-link dates for that history are approximate, and client views were not recorded before October 2026.</p>
              ) : null}
              <p className="pt-1 text-slate-400">
                {viewer?.via === "link" ? `View-only link "${viewer.label}" shared by ${viewer.sharedBy}.` : viewer?.via === "admin" ? `Signed in as ${viewer.name}.` : null}
              </p>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
