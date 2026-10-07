import React from "react";
import { trendHighlights, type RecapKpi, type RecapRanking, type RecapTrend } from "../performance/recapKpi";
import type { RecapCampaign, RecapMixRow } from "../performance/recap";
import { compactMoney, kpiValueText, roasText, singular } from "./recapFormat";

// The Campaign Recap's charts as plain SVG with inline attributes, so the plan and the 16:9 slide
// capture draw the same picture without depending on the page's Tailwind build.

const INK = "#0f172a";
const BODY = "#475569";
const MUTED = "#64748b";
const FAINT = "#94a3b8";
const GOOD = "#059669";
const GOOD_SOFT = "#10b981";
const ACCENT = "#4f46e5";
const ACCENT_SOFT = "#a5b4fc";
const THIN = "#d97706";

// ---- Media type quadrant ----

export interface QuadrantPoint {
  name: string;
  spendShare: number;
  conversionShare: number;
  conversions: number;
  /** The row's KPI against the campaign's: 2 is twice as good, 0.5 half as good. */
  index: number | null;
  value: number | null;
  thin: boolean;
  isCtv: boolean;
}

/** Each mix row read on the KPI's measure: ROAS when the KPI is ROAS and the rows carry revenue. */
export function quadrantPoints(campaign: Pick<RecapCampaign, "mix" | "kpi" | "kpiValues">): { points: QuadrantPoint[]; metric: "roas" | "cpa"; average: number } | null {
  const rows: RecapMixRow[] = campaign.mix?.rows ?? [];
  const useRoas = campaign.kpi?.metric === "roas" && rows.some((r) => (r.roas ?? 0) > 0) && (campaign.kpiValues?.roas ?? 0) > 0;
  const average = useRoas ? campaign.kpiValues?.roas : campaign.kpiValues?.cpa;
  if (!rows.length || !average) return null;
  const points = rows.map((r) => {
    const value = useRoas ? r.roas ?? null : r.cpa;
    const index = value && value > 0 ? (useRoas ? value / average : average / value) : null;
    return { name: r.name, spendShare: r.spendShare, conversionShare: r.conversionShare, conversions: r.conversions, index, value, thin: r.lowSample, isCtv: r.isCtv };
  });
  return points.filter((p) => p.index !== null).length >= 2 ? { points, metric: useRoas ? "roas" : "cpa", average } : null;
}

const W = 560;
const H = 330;
const PLOT = { left: 64, right: 540, top: 24, bottom: 282 };

export function QuadrantChart({ campaign, conversionLabel }: { campaign: Pick<RecapCampaign, "mix" | "kpi" | "kpiValues">; conversionLabel: string }) {
  const data = quadrantPoints(campaign);
  if (!data) return null;
  const style = campaign.kpi?.roasStyle ?? "percent";
  const plotted = data.points.filter((p) => p.index !== null);
  const logs = plotted.map((p) => Math.log2(p.index as number));
  // Headroom above and below, so the biggest bubbles clear the zone captions.
  const lo = Math.max(-4, Math.min(-1, Math.floor(Math.min(...logs) - 0.6)));
  const hi = Math.min(4, Math.max(1, Math.ceil(Math.max(...logs) + 0.6)));
  const xMax = Math.min(1, Math.max(0.4, Math.ceil(Math.max(...plotted.map((p) => p.spendShare)) * 5 + 0.25) / 5));
  const x = (share: number) => PLOT.left + (share / xMax) * (PLOT.right - PLOT.left);
  const y = (index: number) => PLOT.bottom - ((Math.min(hi, Math.max(lo, Math.log2(index))) - lo) / (hi - lo)) * (PLOT.bottom - PLOT.top);
  const avgY = y(1);
  const maxConv = Math.max(...plotted.map((p) => p.conversions), 1);
  const radius = (c: number) => 8 + Math.sqrt(c / maxConv) * 20;
  const unit = singular(conversionLabel);
  const valueText = (p: QuadrantPoint) => (p.value === null ? "" : data.metric === "roas" ? `${roasText(p.value, style)} ROAS` : `${compactMoney(p.value)} per ${unit}`);
  const ticks = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const xTicks = Array.from({ length: Math.round(xMax * 5) + 1 }, (_, i) => i / 5);

  // Each label takes the first spot beside its bubble (right, left, below, above) that stays in the
  // plot and clear of the other bubbles and the labels already placed.
  const bubbles = plotted.map((p) => ({ p, cx: x(p.spendShare), cy: y(p.index as number), r: radius(p.conversions) }));
  type Box = { x0: number; x1: number; y0: number; y1: number };
  const placed: Box[] = [];
  const hits = (b: Box, self: QuadrantPoint) =>
    bubbles.some((o) => o.p !== self && o.cx + o.r > b.x0 && o.cx - o.r < b.x1 && o.cy + o.r > b.y0 && o.cy - o.r < b.y1)
    || placed.some((o) => o.x1 > b.x0 && o.x0 < b.x1 && o.y1 > b.y0 && o.y0 < b.y1)
    || b.x0 < PLOT.left || b.x1 > PLOT.right || b.y0 < PLOT.top || b.y1 > PLOT.bottom + 4;
  const labels = [...bubbles].sort((a, z) => z.r - a.r).map((b) => {
    const name = b.p.name.length > 26 ? `${b.p.name.slice(0, 25)}…` : b.p.name;
    const w = Math.max(name.length * 6.6, valueText(b.p).length * 5.6) + 4;
    // Below and above start under the bubble but stay inside the plot, so a bubble on the axis has them too.
    const under = Math.min(Math.max(PLOT.left + 2, b.cx - w / 2), PLOT.right - w);
    const spots = [
      { left: false, lx: b.cx + b.r + 6, ly: b.cy - 3 },
      { left: true, lx: b.cx - b.r - 6, ly: b.cy - 3 },
      { left: false, lx: under, ly: b.cy + b.r + 13 },
      { left: false, lx: under, ly: b.cy - b.r - 20 },
      { left: false, lx: b.cx + b.r + 6, ly: b.cy + b.r + 10 },
    ];
    const box = (s: (typeof spots)[number]): Box => ({ x0: s.left ? s.lx - w : s.lx, x1: s.left ? s.lx : s.lx + w, y0: s.ly - 11, y1: s.ly + 16 });
    const spot = spots.find((s) => !hits(box(s), b.p)) ?? spots[b.cx > (PLOT.left + PLOT.right) / 2 ? 1 : 0];
    placed.push(box(spot));
    return { ...b, ...spot, name };
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Each media type's result against the campaign average, by its share of spend" style={{ display: "block", fontFamily: "Inter, system-ui, sans-serif" }}>
      <rect x={PLOT.left} y={PLOT.top} width={PLOT.right - PLOT.left} height={avgY - PLOT.top} fill="#ecfdf5" opacity={0.6} />
      <rect x={PLOT.left} y={avgY} width={PLOT.right - PLOT.left} height={PLOT.bottom - avgY} fill="#f8fafc" />
      <line x1={PLOT.left} y1={avgY} x2={PLOT.right} y2={avgY} stroke={FAINT} strokeDasharray="4 4" />
      <text x={PLOT.right - 4} y={avgY - 6} textAnchor="end" fontSize={10} fill={MUTED}>Campaign average ({data.metric === "roas" ? roasText(data.average, style) : compactMoney(data.average)})</text>
      <text x={PLOT.left + 6} y={PLOT.top + 14} fontSize={10} fontWeight={700} fill="#047857">ABOVE AVERAGE: ROOM TO GROW</text>
      <text x={PLOT.left + 6} y={PLOT.bottom - 8} fontSize={10} fontWeight={700} fill={MUTED}>BELOW AVERAGE: SHARPEN</text>
      <line x1={PLOT.left} y1={PLOT.bottom} x2={PLOT.right} y2={PLOT.bottom} stroke="#cbd5e1" />
      <line x1={PLOT.left} y1={PLOT.top} x2={PLOT.left} y2={PLOT.bottom} stroke="#cbd5e1" />
      {xTicks.map((t) => <text key={t} x={x(t)} y={PLOT.bottom + 15} textAnchor="middle" fontSize={10} fill={FAINT}>{Math.round(t * 100)}%</text>)}
      {ticks.map((t) => <text key={t} x={PLOT.left - 6} y={y(2 ** t) + 3} textAnchor="end" fontSize={10} fill={FAINT}>{t === 0 ? "avg" : t > 0 ? `${2 ** t}×` : `1/${2 ** -t}×`}</text>)}
      <text x={(PLOT.left + PLOT.right) / 2} y={H - 6} textAnchor="middle" fontSize={11} fill={MUTED}>Share of spend →</text>
      <text x={16} y={(PLOT.top + PLOT.bottom) / 2} textAnchor="middle" fontSize={11} fill={MUTED} transform={`rotate(-90 16 ${(PLOT.top + PLOT.bottom) / 2})`}>{data.metric === "roas" ? "ROAS" : `Cost per ${unit}`} vs average →</text>
      {labels.map(({ p, cx, cy, r }) => {
        const above = (p.index as number) >= 1;
        return p.thin
          ? <circle key={p.name} cx={cx} cy={cy} r={r} fill="#fffbeb" stroke={THIN} strokeWidth={1.5} strokeDasharray="3 3" />
          : <circle key={p.name} cx={cx} cy={cy} r={r} fill={above ? GOOD : ACCENT_SOFT} fillOpacity={above ? 0.85 : 0.9} stroke={above ? GOOD : ACCENT} strokeWidth={1.5} />;
      })}
      {labels.map(({ p, lx, ly, left, name }) => (
        <g key={p.name}>
          <text x={lx} y={ly} textAnchor={left ? "end" : "start"} fontSize={11} fontWeight={700} fill={INK}>{name}</text>
          <text x={lx} y={ly + 13} textAnchor={left ? "end" : "start"} fontSize={10} fill={BODY}>{valueText(p)}{p.thin ? " · small sample" : ""}</text>
        </g>
      ))}
    </svg>
  );
}

// ---- Flight trend ----

export function TrendChart({ trend, conversionLabel }: { trend: RecapTrend; conversionLabel: string }) {
  const best = trendHighlights(trend)?.best ?? -1;
  const values = trend.weeks.map((w) => w.cpa ?? 0);
  // A thin last week can cost many times the average; it is capped so the full weeks stay readable.
  const cap = trend.averageCpa * 2.5;
  const max = Math.max(trend.averageCpa * 1.2, ...values.map((v) => Math.min(v, cap)));
  const n = trend.weeks.length;
  const left = 30;
  // The average's label sits in the right margin, clear of the bars.
  const right = 410;
  const top = 34;
  const bottom = 186;
  const slot = (right - left) / n;
  const bar = Math.min(56, slot * 0.66);
  const y = (v: number) => bottom - (Math.min(v, cap) / max) * (bottom - top);
  const avgY = y(trend.averageCpa);
  return (
    <svg viewBox="0 0 470 220" width="100%" role="img" aria-label={`Cost per ${singular(conversionLabel)} by week`} style={{ display: "block", fontFamily: "Inter, system-ui, sans-serif" }}>
      <line x1={left} y1={bottom} x2={right} y2={bottom} stroke="#cbd5e1" />
      {trend.weeks.map((w, i) => {
        const cx = left + slot * i + slot / 2;
        const partial = w.days < 7;
        const v = w.cpa;
        const fill = v === null ? "#e2e8f0" : i === best ? GOOD : partial ? "#e2e8f0" : v <= trend.averageCpa ? ACCENT : "#c7d2fe";
        return (
          <g key={w.start}>
            {v !== null && <rect x={cx - bar / 2} y={y(v)} width={bar} height={bottom - y(v)} rx={6} fill={fill} />}
            {v !== null && <text x={cx} y={y(v) - 7} textAnchor="middle" fontSize={11} fontWeight={700} fill={i === best ? "#047857" : partial ? MUTED : INK}>{compactMoney(v)}{v > cap ? "+" : ""}</text>}
            <text x={cx} y={bottom + 16} textAnchor="middle" fontSize={10} fill={MUTED}>{partial ? `${w.days} day${w.days === 1 ? "" : "s"}` : `Wk ${i + 1}${i === best ? " · best" : ""}`}</text>
          </g>
        );
      })}
      <line x1={left} y1={avgY} x2={right} y2={avgY} stroke={FAINT} strokeDasharray="4 4" />
      <text x={right + 6} y={avgY - 2} fontSize={10} fill={MUTED}>Average</text>
      <text x={right + 6} y={avgY + 10} fontSize={10} fontWeight={700} fill={MUTED}>{compactMoney(trend.averageCpa)}</text>
    </svg>
  );
}

/** The trend's caption: its best week and how many weeks ran below average, never a decline. */
export function trendCaption(trend: RecapTrend, conversionLabel: string): string | null {
  const h = trendHighlights(trend);
  if (!h) return null;
  const parts = [`Best week: week ${h.best + 1} at ${compactMoney(h.bestCpa)} per ${singular(conversionLabel)}${h.bestGap >= 0.01 ? `, ${Math.round(h.bestGap * 100)}% below the campaign average` : ""}.`];
  if (h.below > 1) parts.push(`${h.below} of ${h.full} full weeks ran below average.`);
  return parts.join(" ");
}

// ---- Ranked rows (publishers, audiences, creative) ----

export const RANKING_TITLES: Record<RecapRanking["key"], string> = { publisher: "Publishers", audience: "Audiences", creative: "Creative" };

export function rankingSubtitle(ranking: RecapRanking, conversionLabel: string, kpi: RecapKpi | null | undefined): string {
  const measure = ranking.metric === "roas" ? "ROAS" : `Cost per ${singular(conversionLabel)}`;
  return `${measure} against their average (${ranking.metric === "roas" ? roasText(ranking.average, kpi?.roasStyle) : compactMoney(ranking.average)})`;
}

/**
 * Each row's bar grows out of the average line: right and green when it beat the average, left
 * when it did not, so a cheaper cost per conversion and a higher ROAS both read as "right is
 * better". Length is how many times better or worse (log scale, so 2x better and 2x worse are
 * the same length). Thin rows never set the scale; a row past it is drawn to the edge.
 */
export function rankingGeometry(ranking: RecapRanking) {
  const index = (value: number) => (ranking.metric === "roas" ? value / ranking.average : ranking.average / value);
  const logOf = (value: number) => (value > 0 ? Math.log2(index(value)) : 0);
  const firm = ranking.rows.filter((r) => !r.thin);
  const scale = Math.min(3, Math.max(1, ...(firm.length ? firm : ranking.rows).map((r) => Math.abs(logOf(r.value)))));
  return {
    averageAt: 0.5,
    rows: ranking.rows.map((r) => {
      const log = logOf(r.value);
      return {
        ...r,
        side: log >= 0 ? ("right" as const) : ("left" as const),
        /** Share of the whole track, at most half. */
        width: Math.max(0.015, (Math.min(Math.abs(log), scale) / scale) * 0.5),
        capped: Math.abs(log) > scale,
        better: !r.thin && log >= 0,
      };
    }),
  };
}

/** What the chart shows and leaves out: "Top 30 publishers by spend; 4 more not shown." */
export function rankingFootnote(ranking: RecapRanking, shown = ranking.rows.length): string | null {
  const unit = ranking.key === "creative" ? (ranking.combinedFrom ? "concept" : "creative") : ranking.key;
  const more = (ranking.omitted ?? 0) + (ranking.rows.length - shown);
  const parts: string[] = [];
  // Recaps built while creative sizes were combined say so until they are rebuilt.
  if (ranking.combinedFrom) parts.push(`${ranking.combinedFrom} creatives combined into concepts, sizes added together.`);
  if (more > 0) parts.push(`Top ${shown} ${unit}s by spend; ${more} more not shown.`);
  return parts.length ? parts.join(" ") : null;
}

/** The rows a slide has room for: the most spend first, in the ranking's own order. */
export function slideRanking(ranking: RecapRanking, max = 10): RecapRanking {
  if (ranking.rows.length <= max) return ranking;
  const keep = new Set([...ranking.rows].sort((a, z) => z.spendShare - a.spendShare).slice(0, max));
  return { ...ranking, rows: ranking.rows.filter((r) => keep.has(r)) };
}

export const rankingValue = (ranking: RecapRanking, value: number, kpi: RecapKpi | null | undefined) =>
  ranking.metric === "roas" ? roasText(value, kpi?.roasStyle) : kpiValueText("cpa", value);

export const CHART_COLORS = { INK, BODY, MUTED, FAINT, GOOD, GOOD_SOFT, ACCENT, ACCENT_SOFT, THIN };
