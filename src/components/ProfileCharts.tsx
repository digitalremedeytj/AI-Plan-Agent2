import React, { useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
  PieChart,
  Pie
} from "recharts";
import { Table, Eye, EyeOff, Info } from "lucide-react";
import { DomainMetric, DeviceMetric, AgeMetric, GenderMetric, IncomeMetric, TemporalMetric } from "../types";

const CHART_COLORS = ["#5856fd", "#00B3AA", "#b2cb3b", "#006987", "#ec4899", "#f59e0b", "#8b5cf6"];

interface ChartCardProps {
  title: string;
  source: string;
  isModeled?: boolean;
  children: React.ReactNode;
  tableData: Array<Record<string, any>>;
  tableColumns: Array<{ header: string; key: string; format?: (val: any) => string }>;
  footerNote?: React.ReactNode;
  /** Suppresses the amber modeled-data badge on client-facing cards. */
  hideModeledBadge?: boolean;
  /** Suppresses the whole source line under the chart. */
  hideSourceFooter?: boolean;
}

// Reusable card with a toggleable raw data table underneath for transparency
export function ChartCard({ title, source, isModeled, children, tableData, tableColumns, footerNote, hideModeledBadge, hideSourceFooter }: ChartCardProps) {
  const [showTable, setShowTable] = useState(false);

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-xs overflow-hidden transition-all duration-200 hover:shadow-md">
      <div className="p-5 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h4 className="font-display font-semibold text-slate-800 text-base">{title}</h4>
          {isModeled && !hideModeledBadge && (
            <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-medium bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full border border-amber-100">
              <Info className="w-3 h-3" />
              Modeled Planning Proxy
            </span>
          )}
        </div>
        <button
          onClick={() => setShowTable(!showTable)}
          className="inline-flex items-center gap-1.5 text-xs text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
        >
          {showTable ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          {showTable ? "Hide Data" : "View Data Table"}
        </button>
      </div>

      <div className="p-5">
        <div className="h-64 w-full flex items-center justify-center">
          {children}
        </div>

        {/* Source Footer */}
        {!hideSourceFooter && (
          <div className="mt-4 pt-3 border-t border-slate-100 flex justify-between items-center text-[11px] text-slate-400 font-mono">
            <span>Source: {source || "Syndicated media source"}</span>
            {isModeled && <span>*Estimated for planning purposes</span>}
          </div>
        )}

        {/* Optional Explanatory Footer Note */}
        {footerNote && (
          <div className="mt-3">
            {footerNote}
          </div>
        )}

        {/* Expandable Data Table */}
        {showTable && (
          <div className="mt-4 border border-slate-100 rounded-lg overflow-hidden animate-fade-in">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 font-medium">
                    {tableColumns.map((col, idx) => (
                      <th key={idx} className="p-3 font-mono">{col.header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 text-slate-600">
                  {tableData.map((row, rowIdx) => (
                    <tr key={rowIdx} className="hover:bg-slate-50/50">
                      {tableColumns.map((col, colIdx) => (
                        <td key={colIdx} className="p-3 font-mono">
                          {col.format ? col.format(row[col.key]) : row[col.key]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// 1. Top Domains Chart Component
export function DomainsChart({ data, source }: { data: DomainMetric[]; source: string }) {
  if (!data || data.length === 0) {
    return <div className="text-sm text-slate-400 italic">No domain affinity data available</div>;
  }

  const isModeled = data.some(d => d.isModeled);

  const tableColumns = [
    { header: "Domain", key: "domain" },
    { header: "Affinity Index", key: "value", format: (val: number) => `${val}%` }
  ];

  const COLORS = CHART_COLORS;

  const affinityExplanation = (
    <div className="p-3 bg-slate-50/90 border border-slate-200/80 rounded-lg text-xs text-slate-600 leading-relaxed flex items-start gap-2.5">
      <Info className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
      <div>
        <span className="font-semibold text-slate-900">Understanding Affinity Index: </span>
        An Affinity Index measures how much more likely your target audience is to visit a domain compared to the general population baseline (<strong className="text-slate-800">100% = average index</strong>). For example, an index of <strong className="text-indigo-700 font-bold">150%</strong> indicates your target audience is <strong className="text-slate-900 font-semibold">1.5x (50% more likely)</strong> to visit that domain than the average internet user.
      </div>
    </div>
  );

  return (
    <ChartCard
      title="Top Domain Affinity Index"
      source={source}
      isModeled={isModeled}
      tableData={data}
      tableColumns={tableColumns}
      footerNote={affinityExplanation}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 10, right: 30, left: 40, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" horizontal={true} stroke="#f1f5f9" />
          <XAxis type="number" unit="%" stroke="#94a3b8" fontSize={11} />
          <YAxis dataKey="domain" type="category" stroke="#94a3b8" fontSize={10} width={80} />
          <Tooltip
            contentStyle={{ backgroundColor: "#1e293b", borderColor: "#334155", borderRadius: "8px" }}
            labelStyle={{ color: "#f8fafc", fontFamily: "Space Grotesk" }}
            itemStyle={{ color: "#38bdf8", fontSize: "12px" }}
            formatter={(value: any) => [`${value}%`, "Affinity Index"]}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// 2. Device Split Chart Component
export function DeviceChart({ data, source }: { data: DeviceMetric[]; source: string }) {
  if (!data || data.length === 0) {
    return <div className="text-sm text-slate-400 italic">No device distribution data available</div>;
  }

  const isModeled = data.some(d => d.isModeled);
  const tableColumns = [
    { header: "Platform / Device", key: "device" },
    { header: "Reach Share", key: "value", format: (val: number) => `${val}%` },
    { header: "Source", key: "source" }
  ];

  const COLORS = CHART_COLORS;

  return (
    <ChartCard
      title="Device & Platform Share"
      source={source}
      isModeled={isModeled}
      hideModeledBadge
      hideSourceFooter
      tableData={data}
      tableColumns={tableColumns}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={85}
            paddingAngle={3}
            dataKey="value"
            nameKey="device"
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ backgroundColor: "#1e293b", borderColor: "#334155", borderRadius: "8px" }}
            itemStyle={{ color: "#cbd5e1", fontSize: "12px" }}
            formatter={(value: any, name: any) => [`${value}%`, name]}
          />
          <Legend
            verticalAlign="bottom"
            height={36}
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: "11px", color: "#64748b" }}
          />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// 3. Age Demographic Chart Component
export function AgeChart({ data, source }: { data: AgeMetric[]; source: string }) {
  if (!data || data.length === 0) {
    return <div className="text-sm text-slate-400 italic">No age demographics available</div>;
  }

  const isModeled = data.some(d => d.isModeled);
  const tableColumns = [
    { header: "Age Bracket", key: "range" },
    { header: "Composition Share", key: "value", format: (val: number) => `${val}%` }
  ];

  return (
    <ChartCard
      title="Audience Composition by Age"
      source={source}
      isModeled={isModeled}
      hideModeledBadge
      tableData={data}
      tableColumns={tableColumns}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 20, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="range" stroke="#94a3b8" fontSize={11} />
          <YAxis stroke="#94a3b8" fontSize={11} unit="%" />
          <Tooltip
            contentStyle={{ backgroundColor: "#1e293b", borderColor: "#334155", borderRadius: "8px" }}
            itemStyle={{ color: "#5856fd", fontSize: "12px" }}
            formatter={(value: any, name: any, props: any) => [`${value}%`, props.payload?.range || "Age Group Share"]}
          />
          <Bar dataKey="value" fill="#5856fd" radius={[4, 4, 0, 0]} barSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// 4. Gender Demographic Chart Component
export function GenderChart({ data, source }: { data: GenderMetric[]; source: string }) {
  if (!data || data.length === 0) {
    return <div className="text-sm text-slate-400 italic">No gender demographics available</div>;
  }

  const isModeled = data.some(d => d.isModeled);
  const tableColumns = [
    { header: "Gender Identity", key: "gender" },
    { header: "Composition Share", key: "value", format: (val: number) => `${val}%` }
  ];

  const COLORS = CHART_COLORS;

  return (
    <ChartCard
      title="Gender Breakdown"
      source={source}
      isModeled={isModeled}
      hideModeledBadge
      tableData={data}
      tableColumns={tableColumns}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            outerRadius={80}
            dataKey="value"
            nameKey="gender"
            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
            labelLine={false}
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ backgroundColor: "#1e293b", borderColor: "#334155", borderRadius: "8px" }}
            itemStyle={{ color: "#f8fafc", fontSize: "12px" }}
            formatter={(value: any, name: any) => [`${value}%`, name]}
          />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// 5. Income Demographic Chart Component
export function IncomeChart({ data, source }: { data: IncomeMetric[]; source: string }) {
  if (!data || data.length === 0) {
    return <div className="text-sm text-slate-400 italic">No household income data available</div>;
  }

  const isModeled = data.some(d => d.isModeled);
  const tableColumns = [
    { header: "Household Income Bracket", key: "bracket" },
    { header: "Composition Share", key: "value", format: (val: number) => `${val}%` }
  ];

  return (
    <ChartCard
      title="Household Income Distribution"
      source={source}
      isModeled={isModeled}
      hideModeledBadge
      tableData={data}
      tableColumns={tableColumns}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 20, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="bracket" stroke="#94a3b8" fontSize={10} tickLine={false} />
          <YAxis stroke="#94a3b8" fontSize={11} unit="%" />
          <Tooltip
            contentStyle={{ backgroundColor: "#1e293b", borderColor: "#334155", borderRadius: "8px" }}
            itemStyle={{ color: "#00B3AA", fontSize: "12px" }}
            formatter={(value: any, name: any, props: any) => [`${value}%`, props.payload?.bracket || "HHI Bracket"]}
          />
          <Bar dataKey="value" fill="#00B3AA" radius={[4, 4, 0, 0]} barSize={40} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// 6. Day of Week Temporal Activation Chart
export function DayOfWeekChart({ data, source }: { data: TemporalMetric[]; source: string }) {
  if (!data || data.length === 0) {
    return <div className="text-sm text-slate-400 italic">No day-of-week data available</div>;
  }

  const isModeled = data.some(d => d.isModeled);
  const tableColumns = [
    { header: "Day of Week", key: "day" },
    { header: "Activity Index (100 is Avg)", key: "index" }
  ];

  return (
    <ChartCard
      title="Weekly Digital / Media Activity Index"
      source={source}
      isModeled={isModeled}
      tableData={data}
      tableColumns={tableColumns}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 20, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="day" stroke="#94a3b8" fontSize={11} />
          <YAxis stroke="#94a3b8" fontSize={11} domain={[0, 'dataMax + 20']} />
          <Tooltip
            contentStyle={{ backgroundColor: "#1e293b", borderColor: "#334155", borderRadius: "8px" }}
            itemStyle={{ color: "#5856fd", fontSize: "12px" }}
            formatter={(value: any, name: any, props: any) => [value, props.payload?.day || "Activity Index (100 = Baseline)"]}
          />
          <Bar dataKey="index" fill="#00B3AA" radius={[4, 4, 0, 0]} barSize={32}>
            {data.map((entry, index) => {
              // Highlight peak active days (index > 105)
              const isPeak = entry.index > 105;
              return <Cell key={`cell-${index}`} fill={isPeak ? "#5856fd" : "#00B3AA"} />;
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// 7. Hour of Day Temporal Activation Chart
export function HourOfDayChart({ data, source }: { data: TemporalMetric[]; source: string }) {
  if (!data || data.length === 0) {
    return <div className="text-sm text-slate-400 italic">No hourly temporal data available</div>;
  }

  const isModeled = data.some(d => d.isModeled);
  const tableColumns = [
    { header: "Time block", key: "hour" },
    { header: "Activity Index", key: "index" }
  ];

  return (
    <ChartCard
      title="Daily Media Activity Index by Time-Block"
      source={source}
      isModeled={isModeled}
      tableData={data}
      tableColumns={tableColumns}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 20, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="hour" stroke="#94a3b8" fontSize={10} />
          <YAxis stroke="#94a3b8" fontSize={11} domain={[0, 'dataMax + 25']} />
          <Tooltip
            contentStyle={{ backgroundColor: "#1e293b", borderColor: "#334155", borderRadius: "8px" }}
            itemStyle={{ color: "#006987", fontSize: "12px" }}
            formatter={(value: any, name: any, props: any) => [value, props.payload?.hour || "Activity Index"]}
          />
          <Bar dataKey="index" fill="#006987" radius={[4, 4, 0, 0]} barSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
