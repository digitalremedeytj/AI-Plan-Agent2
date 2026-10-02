import React from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Download, Loader2, Search, AlertCircle } from "lucide-react";
import type { FileEntry } from "../performance/campaign";
import type { TouchSummary } from "../performance/touches";
import { buildDatasetTable, filterRows, nextSort, ROW_PAGE, sortRows, type ColumnRole, type DatasetSort } from "../performance/datasetTable";

// One uploaded report, opened from the campaign's file list: the export's rows as they were
// exported, sortable and filterable, with each column marked by what the analysis read it as.
// A touch-level export has no rows to show (only the browser's summary was uploaded), so its
// summary is shown instead.

interface Props {
  entry: FileEntry;
  /** The export's text; absent for a touch-level export. */
  loadText: (() => Promise<string>) | null;
  touch?: TouchSummary;
}

const ROLE_STYLE: Record<ColumnRole, { head: string; cell: string }> = {
  metric: { head: "bg-indigo-50 text-indigo-900 border-t-2 border-t-indigo-500", cell: "text-slate-800" },
  ratio: { head: "bg-sky-50 text-sky-900 border-t-2 border-t-sky-400", cell: "text-slate-600" },
  label: { head: "bg-slate-50 text-slate-800 border-t-2 border-t-slate-400", cell: "text-slate-800" },
  ignored: { head: "bg-slate-50 text-slate-400 border-t-2 border-t-transparent", cell: "text-slate-400" },
  none: { head: "bg-slate-50 text-slate-700 border-t-2 border-t-transparent", cell: "text-slate-700" },
};
const LEGEND: Array<{ role: ColumnRole; label: string; swatch: string }> = [
  { role: "metric", label: "Counts ScoutAI adds up", swatch: "bg-indigo-500" },
  { role: "ratio", label: "Ratios, recomputed from the counts", swatch: "bg-sky-400" },
  { role: "label", label: "Row names, dates and labels", swatch: "bg-slate-400" },
  { role: "ignored", label: "Not read", swatch: "bg-slate-200" },
];

// Exports write long floats (4947.842738810249); a plain number is shown rounded, and the cell's
// title keeps the exported value. Anything with a currency sign or percent is shown as written.
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
function displayCell(raw: string, numeric: boolean): string {
  const text = raw.trim();
  if (!numeric || !PLAIN_NUMBER.test(text)) return raw;
  const n = Number(text);
  return n.toLocaleString("en-US", { maximumFractionDigits: Math.abs(n) >= 100 ? 2 : 4 });
}

export function DatasetViewer({ entry, loadText, touch }: Props) {
  const [text, setText] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState<DatasetSort | null>(null);
  const [limit, setLimit] = React.useState(ROW_PAGE);

  React.useEffect(() => {
    if (!loadText) return;
    let cancelled = false;
    loadText().then((t) => !cancelled && setText(t)).catch((err) => !cancelled && setError(err?.message || "Could not load the report."));
    return () => {
      cancelled = true;
    };
    // The parent keys this component by file, so the loader is fixed for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const table = React.useMemo(() => (text === null ? null : buildDatasetTable(text, entry.kind, entry.ignoredColumns)), [text, entry]);
  const visible = React.useMemo(() => (table ? sortRows(filterRows(table.rows, query), table.columns, sort) : []), [table, query, sort]);
  React.useEffect(() => setLimit(ROW_PAGE), [query, sort]);

  const download = () => {
    if (text === null) return;
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = /\.(csv|tsv|txt)$/i.test(entry.fileName) ? entry.fileName : `${entry.fileName}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasRoles = Boolean(table?.columns.some((c) => c.role !== "none"));

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="shrink-0 px-5 pt-4 pb-3 border-b border-slate-100 space-y-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-800 truncate">{entry.reportType || entry.fileName}</div>
            <div className="text-[11px] text-slate-500 truncate" title={entry.fileName}>
              {entry.fileName}
              {table ? ` · ${table.rows.length.toLocaleString()} row${table.rows.length === 1 ? "" : "s"} × ${table.columns.length} columns` : ""}
            </div>
          </div>
          {loadText && (
            <button onClick={download} disabled={text === null} className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-[11px] font-bold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
              <Download className="w-3 h-3" /> Download CSV
            </button>
          )}
        </div>
        {table && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100 px-2 py-1 w-64 max-w-full">
              <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter rows…" className="flex-1 min-w-0 text-xs text-slate-800 outline-none bg-transparent" />
            </label>
            {query.trim() && <span className="text-[11px] text-slate-500">{visible.length.toLocaleString()} of {table.rows.length.toLocaleString()} rows match</span>}
            {hasRoles && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 ml-auto">
                {LEGEND.filter((l) => table.columns.some((c) => c.role === l.role)).map((l) => (
                  <span key={l.role} className="flex items-center gap-1 text-[10px] text-slate-500"><span className={`w-2.5 h-2.5 rounded-sm ${l.swatch}`} /> {l.label}</span>
                ))}
              </div>
            )}
          </div>
        )}
        {entry.kind === "unread" && <p className="text-[11px] text-rose-700">This file was not read, so nothing in the analysis comes from it.</p>}
      </div>

      <div className="flex-1 min-h-0 overflow-auto custom-scrollbar">
        {touch ? (
          <TouchSummaryView summary={touch} />
        ) : error ? (
          <div className="p-5"><div className="p-3 bg-rose-50 border border-rose-100 rounded-xl text-xs text-rose-700 flex items-start gap-2"><AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" /> <span>{error}</span></div></div>
        ) : !table ? (
          <div className="p-5 flex items-center gap-2 text-xs text-slate-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading the report…</div>
        ) : table.columns.length === 0 ? (
          <p className="p-5 text-xs text-slate-500">The file has no columns.</p>
        ) : (
          <>
            <table className="min-w-full text-[11px] border-separate border-spacing-0">
              <thead>
                <tr>
                  {table.columns.map((c, i) => {
                    const active = sort?.column === i;
                    const SortIcon = active ? (sort!.direction === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;
                    return (
                      <th key={i} className={`sticky top-0 ${i === 0 ? "left-0 z-30" : "z-20"} border-b border-r border-slate-200 p-0 font-bold whitespace-nowrap ${ROLE_STYLE[c.role].head}`}>
                        <button
                          onClick={() => setSort(nextSort(sort, i))}
                          title={c.readAs ? `Read as: ${c.readAs}` : c.role === "ignored" ? "Not read by ScoutAI" : undefined}
                          className={`w-full flex items-center gap-1 px-2.5 py-1.5 cursor-pointer ${c.numeric ? "justify-end" : "justify-start"}`}
                        >
                          <span>{c.header || `Column ${i + 1}`}</span>
                          <SortIcon className={`w-3 h-3 shrink-0 ${active ? "text-slate-700" : "text-slate-300"}`} />
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {visible.slice(0, limit).map((row, r) => (
                  <tr key={r} className="group">
                    {table.columns.map((c, i) => (
                      <td
                        key={i}
                        title={row[i]}
                        className={`border-b border-r border-slate-100 px-2.5 py-1 whitespace-nowrap max-w-[12rem] sm:max-w-[22rem] truncate group-hover:bg-indigo-50/40 ${c.numeric ? "text-right tabular-nums" : ""} ${ROLE_STYLE[c.role].cell} ${i === 0 ? "sticky left-0 z-10 bg-white font-semibold" : "bg-white"}`}
                      >
                        {displayCell(row[i] ?? "", c.numeric)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {visible.length === 0 && <p className="p-5 text-xs text-slate-500">No rows match “{query.trim()}”.</p>}
            {visible.length > limit && (
              <div className="p-3 flex items-center gap-3 text-[11px] text-slate-500">
                Showing {limit.toLocaleString()} of {visible.length.toLocaleString()} rows.
                <button onClick={() => setLimit((n) => n + ROW_PAGE)} className="font-bold text-indigo-700 hover:text-indigo-900 cursor-pointer">Show {Math.min(ROW_PAGE, visible.length - limit).toLocaleString()} more</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const n = (v: number) => Math.round(v).toLocaleString("en-US");
const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function TouchSummaryView({ summary: s }: { summary: TouchSummary }) {
  const stats: Array<[string, string]> = [
    ["Attribution", s.attribution === "all-touch" ? "All-touch" : "Last-touch"],
    ["Rows read", n(s.rows)],
    ["Conversions", n(s.conversions)],
    ["Households", n(s.households)],
    ["Revenue", s.revenue > 0 ? `$${n(s.revenue)}` : "n/a"],
    ["Conversions from", s.conversionWindow ? `${date(s.conversionWindow.start)} to ${date(s.conversionWindow.end)}` : "n/a"],
    ["Median hours to convert", s.medianHoursToConvert !== null ? String(Math.round(s.medianHoursToConvert)) : "n/a"],
    ["Touches per conversion", s.touchesPerConversion ? `${s.touchesPerConversion.median} median, ${s.touchesPerConversion.max} max` : "n/a"],
  ];
  return (
    <div className="p-5 space-y-4">
      <p className="text-[11px] leading-relaxed text-slate-600 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
        Touch-level exports are household-level and too large to upload, so they were summarised in the browser and only this summary was saved. There are no rows to show or download.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-lg bg-slate-50 border border-slate-100 px-2.5 py-2">
            <div className="text-[10px] text-slate-500 truncate">{label}</div>
            <div className="text-sm font-bold text-slate-800">{value}</div>
          </div>
        ))}
      </div>
      {s.byMediaType.length > 0 && (
        <table className="text-[11px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
              <th className="py-1 pr-4 font-bold">Media type</th><th className="py-1 px-3 font-bold text-right">Any touch</th><th className="py-1 px-3 font-bold text-right">Last touch</th><th className="py-1 px-3 font-bold text-right">First touch</th><th className="py-1 pl-3 font-bold text-right">Only touch</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {s.byMediaType.map((m) => (
              <tr key={m.mediaType}>
                <td className="py-1.5 pr-4 font-semibold text-slate-700">{m.mediaType}</td>
                <td className="py-1.5 px-3 text-right tabular-nums">{n(m.anyTouch)}</td>
                <td className="py-1.5 px-3 text-right tabular-nums">{n(m.lastTouch)}</td>
                <td className="py-1.5 px-3 text-right tabular-nums">{n(m.firstTouch)}</td>
                <td className="py-1.5 pl-3 text-right tabular-nums">{n(m.onlyTouch)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
