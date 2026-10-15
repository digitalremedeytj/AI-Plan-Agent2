import React from "react";
import Markdown from "react-markdown";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AlertTriangle, BookPlus, ExternalLink } from "lucide-react";
import type { ScoutLog } from "../storage/types";
import { MODE_LABELS } from "../assistant/promptLibrary";
import { formatCell, type AskBlock, type AskColumn } from "./scoutAsk";
import { KIND_LABELS } from "./scoutReviewData";
import { PROMPT_EDITOR_URL, stashPromptDraft } from "./promptHandoff";

// Draws an Ask answer's blocks. Tables and charts arrive with their rows already filled in by the
// server from counted data (src/scoutReview/scoutAsk.ts), so this only formats them.

// The dashboard's brand purple and teal, then their lighter shades, for series and slices.
const SERIES = ["#5856fd", "#006987", "#8584fe", "#3fa3bd", "#3836b8", "#a9a8fe", "#00455a", "#c9c8fe"];
const GRID = "#e2e8f0";
const AXIS = "#64748b";

const formatTick = (value: unknown, column: AskColumn) => formatCell(value as number, column.kind);
const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// Recharts wraps a long category name onto two lines that run into the next bar; one truncated
// line, with the full name in the tooltip, reads better.
function CategoryTick({ x, y, payload }: any) {
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fontSize={11} fill="#334155">
      <title>{String(payload?.value ?? "")}</title>
      {truncate(String(payload?.value ?? ""), 24)}
    </text>
  );
}

function ChartTooltip({ active, payload, label, columns }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      {label ? <p className="mb-1 font-semibold text-slate-900">{label}</p> : null}
      {payload.map((entry: any) => {
        const column = (columns as AskColumn[]).find((c) => c.key === entry.dataKey) ?? columns[0];
        return (
          <p key={entry.dataKey ?? entry.name} className="flex items-center gap-1.5 text-slate-600">
            <span className="h-2 w-2 rounded-full" style={{ background: entry.color || entry.payload?.fill }} />
            {entry.name}: <span className="font-semibold text-slate-900">{formatCell(entry.value, column.kind)}</span>
          </p>
        );
      })}
    </div>
  );
}

function ChartBlock({ block }: { block: Extract<AskBlock, { type: "chart" }> }) {
  const { x, y, data } = block;
  const multi = y.length > 1;
  if (block.chart === "pie") {
    const series = y[0];
    return (
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie data={data} dataKey={series.key} nameKey={x.key} innerRadius={55} outerRadius={95} paddingAngle={1} stroke="#fff">
            {data.map((_, i) => <Cell key={i} fill={SERIES[i % SERIES.length]} />)}
          </Pie>
          <Tooltip content={<ChartTooltip columns={y} />} />
          <Legend formatter={(value) => <span className="text-xs text-slate-600">{truncate(String(value), 32)}</span>} />
        </PieChart>
      </ResponsiveContainer>
    );
  }
  if (block.chart === "line") {
    return (
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey={x.key} tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={16} />
          <YAxis tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} allowDecimals={false} tickFormatter={(v) => formatTick(v, y[0])} />
          <Tooltip content={<ChartTooltip columns={y} />} />
          {multi ? <Legend formatter={(value) => <span className="text-xs text-slate-600">{value}</span>} /> : null}
          {y.map((series, i) => <Line key={series.key} type="monotone" dataKey={series.key} name={series.label} stroke={SERIES[i % SERIES.length]} strokeWidth={2} dot={data.length <= 31} />)}
        </LineChart>
      </ResponsiveContainer>
    );
  }
  // Categories (topics, prompts, people) have long names, so bars run sideways with the names on the left.
  const height = Math.max(160, data.length * (multi ? 34 : 26) + 40);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 4 }}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} allowDecimals={false} tickFormatter={(v) => formatTick(v, y[0])} />
        <YAxis type="category" dataKey={x.key} width={150} tick={<CategoryTick />} tickLine={false} axisLine={false} interval={0} />
        <Tooltip cursor={{ fill: "#f1f5f9" }} content={<ChartTooltip columns={y} />} />
        {multi ? <Legend formatter={(value) => <span className="text-xs text-slate-600">{value}</span>} /> : null}
        {y.map((series, i) => <Bar key={series.key} dataKey={series.key} name={series.label} fill={SERIES[i % SERIES.length]} radius={[0, 4, 4, 0]} maxBarSize={22} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

function TableBlock({ block }: { block: Extract<AskBlock, { type: "table" }> }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-max border-collapse text-left text-xs">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            {block.columns.map((c) => (
              <th key={c.key} scope="col" className={`px-3 py-2 font-semibold ${c.kind === "text" ? "" : "text-right"}`}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {block.rows.map((row, i) => (
            <tr key={i} className="align-top">
              {block.columns.map((c, j) => (
                <td key={c.key} className={`px-3 py-2 ${c.kind === "text" ? "max-w-md whitespace-normal text-slate-700" : "text-right font-semibold tabular-nums text-slate-900"} ${j === 0 ? "font-semibold text-slate-900" : ""}`}>
                  {formatCell(row[j], c.kind)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Titled({ title, source, children }: { title?: string; source?: string; children: React.ReactNode }) {
  return (
    <figure className="space-y-2">
      {title ? <figcaption className="text-sm font-bold text-slate-900">{title}</figcaption> : null}
      {children}
      {source ? <p className="text-[11px] text-slate-400">Counted by the app from {source.toLowerCase()}.</p> : null}
    </figure>
  );
}

function PromptDraftBlock({ block }: { block: Extract<AskBlock, { type: "prompt_draft" }> }) {
  const [error, setError] = React.useState<string | null>(null);
  const open = () => {
    try {
      stashPromptDraft(block.prompt, window.localStorage);
      window.open(PROMPT_EDITOR_URL, "_blank", "noopener");
    } catch {
      setError("Your browser blocked handing the draft to Settings. Copy the text into a new prompt instead.");
    }
  };
  return (
    <div className="space-y-2 rounded-xl border border-brand-purple-200 bg-brand-purple-50/50 p-3">
      <p className="flex items-center gap-1.5 text-xs font-bold text-brand-purple-900"><BookPlus className="h-3.5 w-3.5" /> Library prompt draft</p>
      {block.text ? <p className="text-xs text-slate-600">{block.text}</p> : null}
      <div className="rounded-lg bg-white p-2.5 text-sm">
        <p className="font-semibold text-slate-900">{block.prompt.title}</p>
        <p className="text-[11px] text-slate-500">{block.prompt.category} · {MODE_LABELS[block.prompt.mode]}</p>
        <p className="mt-1.5 whitespace-pre-wrap text-slate-700">{block.prompt.text}</p>
      </div>
      <button type="button" onClick={open} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-purple-700">
        Open in the prompt library <ExternalLink className="h-3 w-3" />
      </button>
      <p className="text-[11px] text-slate-500">Opens Settings in a new tab with this as a new prompt. Nothing changes until you save it there.</p>
      {error ? <p className="text-xs text-rose-700">{error}</p> : null}
    </div>
  );
}

function ExamplesBlock({ block, logsById, onOpen }: { block: Extract<AskBlock, { type: "examples" }>; logsById: Map<string, ScoutLog>; onOpen: (id: string) => void }) {
  const found = block.ids.map((id) => logsById.get(id)).filter((l): l is ScoutLog => Boolean(l));
  if (!found.length) return null;
  return (
    <div className="space-y-1.5">
      {block.text ? <p className="text-xs font-semibold text-slate-600">{block.text}</p> : null}
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
        {found.map((l) => (
          <li key={l.id}>
            <button type="button" onClick={() => onOpen(l.id)} className="block w-full px-3 py-2 text-left hover:bg-brand-purple-50">
              <p className="line-clamp-2 text-xs text-slate-900">{l.question}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {l.actor} · {new Date(l.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {l.advertiserName || "No advertiser"} · {KIND_LABELS[l.kind]}
                {l.feedback ? ` · thumbs ${l.feedback.rating}` : ""}{!l.ok ? " · failed" : ""}
              </p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AskBlocks({ blocks, logsById, onOpenQuestion }: { blocks: AskBlock[]; logsById: Map<string, ScoutLog>; onOpenQuestion: (id: string) => void }) {
  return (
    <div className="space-y-4">
      {blocks.map((block, i) => {
        if (block.type === "markdown") return <div key={i} className="scout-markdown text-sm leading-relaxed text-slate-700"><Markdown>{block.text}</Markdown></div>;
        if (block.type === "table") return <Titled key={i} title={block.title} source={block.source}><TableBlock block={block} /></Titled>;
        if (block.type === "chart") return <Titled key={i} title={block.title} source={block.source}><ChartBlock block={block} /></Titled>;
        if (block.type === "examples") return <ExamplesBlock key={i} block={block} logsById={logsById} onOpen={onOpenQuestion} />;
        if (block.type === "prompt_draft") return <PromptDraftBlock key={i} block={block} />;
        return (
          <p key={i} className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {block.text}
          </p>
        );
      })}
    </div>
  );
}
