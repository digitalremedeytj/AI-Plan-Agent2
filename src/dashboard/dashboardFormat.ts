import type { DashboardData, Kpi } from "../usage/dashboard";

// Formatting and date-range helpers for the leadership dashboard, kept free of React so the
// weekly summary text (which leadership reads in an email) is covered by tests.

export type RangePreset = "7d" | "30d" | "90d" | "qtd" | "ytd" | "custom";

export const RANGE_PRESETS: Array<{ id: Exclude<RangePreset, "custom">; label: string }> = [
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
  { id: "qtd", label: "Quarter to date" },
  { id: "ytd", label: "Year to date" },
];

/** YYYY-MM-DD in the viewer's own timezone, for <input type="date">. */
export function toDateInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Whole local days, start of the first through end of the last, as ISO instants. */
export function rangeFromDates(fromDay: string, toDay: string): { from: string; to: string } {
  const [fy, fm, fd] = fromDay.split("-").map(Number);
  const [ty, tm, td] = toDay.split("-").map(Number);
  return { from: new Date(fy, fm - 1, fd, 0, 0, 0, 0).toISOString(), to: new Date(ty, tm - 1, td, 23, 59, 59, 999).toISOString() };
}

/** The local days a preset covers, ending today. */
export function presetDays(preset: Exclude<RangePreset, "custom">, today = new Date()): { fromDay: string; toDay: string } {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (preset === "qtd") start.setMonth(Math.floor(today.getMonth() / 3) * 3, 1);
  else if (preset === "ytd") start.setMonth(0, 1);
  else start.setDate(start.getDate() - (({ "7d": 7, "30d": 30, "90d": 90 } as const)[preset] - 1));
  return { fromDay: toDateInput(start), toDay: toDateInput(today) };
}

export const isPreset = (value: unknown): value is Exclude<RangePreset, "custom"> =>
  typeof value === "string" && RANGE_PRESETS.some((p) => p.id === value);

export function formatMoney(value: number, compact = true): string {
  if (!compact || Math.abs(value) < 10_000) return `$${Math.round(value).toLocaleString("en-US")}`;
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  return `$${Math.round(value / 1000)}K`;
}

export const formatNumber = (value: number) => Math.round(value).toLocaleString("en-US");

export function formatHours(value: number): string {
  return value >= 100 ? formatNumber(value) : String(Math.round(value * 10) / 10);
}

/** The change against the previous period: a percentage, "new" from zero, or none. */
export function kpiChange(kpi: Kpi): { label: string; direction: "up" | "down" | "flat" } | null {
  if (kpi.previous === 0) return kpi.value === 0 ? null : { label: "New", direction: "up" };
  const pct = ((kpi.value - kpi.previous) / kpi.previous) * 100;
  if (Math.abs(pct) < 0.5) return { label: "0%", direction: "flat" };
  return { label: `${pct > 0 ? "+" : ""}${Math.round(pct)}%`, direction: pct > 0 ? "up" : "down" };
}

export function formatRange(fromIso: string, toIso: string): string {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const sameYear = from.getFullYear() === to.getFullYear();
  const day = (d: Date, withYear: boolean) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });
  return `${day(from, !sameYear)} – ${day(to, true)}`;
}

const withChange = (kpi: Kpi) => {
  const change = kpiChange(kpi);
  return change && change.label !== "New" ? ` (${change.label} vs prior period)` : "";
};

/** Plain text for the weekly email: the headline numbers, then the link. */
export function weeklySummaryText(data: DashboardData, hoursPerPlan: number, link: string | null): string {
  const { kpis } = data;
  const top = data.users[0];
  const topChannel = data.channels[0];
  const lines = [
    `AI Plan Agent update: ${formatRange(data.from, data.to)}${data.selectedUsers ? ` (${data.selectedUsers.join(", ")} only)` : ""}`,
    "",
    `• ${formatNumber(kpis.plans.value)} plan${kpis.plans.value === 1 ? "" : "s"} generated${withChange(kpis.plans)} by ${formatNumber(kpis.activeUsers.value)} ${kpis.activeUsers.value === 1 ? "person" : "people"}`,
    `• ${formatMoney(kpis.budget.value)} in media budget planned${withChange(kpis.budget)} across ${formatNumber(kpis.advertisers.value)} advertiser${kpis.advertisers.value === 1 ? "" : "s"}`,
    `• ${formatNumber(kpis.shareLinks.value)} plan${kpis.shareLinks.value === 1 ? "" : "s"} shared with clients; clients opened shared plans ${formatNumber(kpis.shareViews.value)} time${kpis.shareViews.value === 1 ? "" : "s"}`,
    `• About ${formatHours(kpis.plans.value * hoursPerPlan)} hour${kpis.plans.value * hoursPerPlan === 1 ? "" : "s"} of planning time saved (at ${hoursPerPlan} h per plan)`,
  ];
  if (topChannel) lines.push(`• Largest media type: ${topChannel.name} (${formatMoney(topChannel.budget)})`);
  if (top && top.plans > 0) lines.push(`• Top planner: ${top.name} (${formatNumber(top.plans)} plan${top.plans === 1 ? "" : "s"})`);
  if (link) lines.push("", `Full dashboard: ${link}`);
  return lines.join("\n");
}
