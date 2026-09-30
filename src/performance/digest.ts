// The campaign analysis as ScoutAI reads it: reconciled numbers, stated once, with the data notes
// first so they frame everything after. It is bounded: a report set can hold thousands of rows,
// and the chat call has to stay quick, so rows are cut from the bottom of each breakdown (the
// smallest spend) until the text fits, and what was cut is summarised rather than dropped silently.

import { count, money, pct, MIN_CONVERSIONS, type BreakdownDigest, type CampaignAnalysis, type DigestRow, type Severity } from "./campaign";
import { formatDay, formatWindow, windowDays } from "./values";

export const DEFAULT_DIGEST_CHARS = 12000;

// The order a planner reasons in: where the money went, then on what, to whom, and in what form.
const DIMENSION_ORDER = [/media\s*type|mediatype/i, /publisher/i, /audience/i, /ad\s*group|adgroup/i, /creative/i];
const SEVERITY_ORDER: Record<Severity, number> = { problem: 0, caution: 1, info: 2 };

const FLAG_TEXT: Record<string, string> = {
  "low-sample": `under ${MIN_CONVERSIONS} conversions`,
  retargeting: "retargeting",
  "fed-by-ctv": "fed by CTV exposure",
  event: "event or one-off buy",
  "conversions-without-spend": "conversions with no spend",
  "no-conversions": "no conversions",
  "media-type-row": "a media type, not a publisher",
};

const dollars = (value: number | null) => (value === null ? null : money(value, value < 100 ? 2 : 0));
// Linear credit splits conversions, so small counts need their fraction.
const fractional = (value: number) => (value < 100 ? value.toFixed(1) : count(value));
const times = (value: number | null) => (value === null ? null : `${value.toFixed(2)}x`);
const rate = (value: number | null) => (value === null ? null : `${(value * 100).toFixed(value < 0.001 ? 3 : 2)}%`);

function rowLine(row: DigestRow, conversionLabel: string): string {
  const m = row.metrics;
  const group = Object.values(row.attributes)[0];
  const parts = [
    m.spend !== undefined ? `${money(m.spend)} (${pct(row.spendShare, 1)} of spend)` : null,
    m.conversions !== undefined ? `${count(m.conversions)} ${conversionLabel} (${pct(row.conversionShare, 1)})` : null,
    row.cpa !== null ? `CPA ${dollars(row.cpa)}` : null,
    row.roas !== null && (m.revenue ?? 0) > 0 ? `ROAS ${times(row.roas)}` : null,
    row.cpm !== null ? `CPM ${dollars(row.cpm)}` : null,
    row.ctr !== null && (m.clicks ?? 0) > 0 ? `CTR ${rate(row.ctr)}` : null,
    row.vcr !== null && (m.videoCompletions ?? 0) > 0 ? `VCR ${rate(row.vcr)}` : null,
    row.pm !== null ? `PM ${row.pm.toFixed(2)}` : null,
  ].filter(Boolean);
  const flags = row.flags.map((f) => FLAG_TEXT[f]).filter(Boolean);
  return `- ${row.name}${group ? ` (${group})` : ""}: ${parts.join(" | ")}${flags.length ? ` [${flags.join("; ")}]` : ""}`;
}

/** The biggest rows by spend, plus the best and worst PM among rows with enough conversions. */
function pickRows(b: BreakdownDigest, limit: number): { shown: DigestRow[]; rest: DigestRow[] } {
  if (b.rows.length <= limit) return { shown: b.rows, rest: [] };
  const bySpend = b.rows.slice(0, Math.max(1, limit - 4));
  const reliable = b.rows.filter((r) => r.pm !== null && !r.flags.includes("low-sample") && !bySpend.includes(r)).sort((a, z) => (z.pm ?? 0) - (a.pm ?? 0));
  const extremes = [...reliable.slice(0, 2), ...reliable.slice(-2)].filter((r, i, all) => all.indexOf(r) === i);
  const shown = [...bySpend, ...extremes].slice(0, limit);
  return { shown, rest: b.rows.filter((r) => !shown.includes(r)) };
}

// "Best" and "worst" are the easiest claims to get wrong from a list sorted by spend, so the
// digest states them. PM orders a report exactly as CPA does, since both are its conversions per dollar.
const RANKED = 3;

function rankingLine(b: BreakdownDigest): string {
  const publisherReport = /publisher/i.test(b.dimension);
  const rows = b.rows.filter((r) => r.pm !== null && !r.flags.includes("low-sample") && !r.flags.includes("media-type-row"));
  if (rows.length < 4) return "";
  const byPm = [...rows].sort((a, z) => (z.pm ?? 0) - (a.pm ?? 0));
  const show = (list: DigestRow[]) => list.map((r) => `${r.name} PM ${r.pm!.toFixed(2)} (CPA ${dollars(r.cpa)})`).join(", ");
  // A short report is split in half, so no row is both one of the best and one of the weakest.
  const n = Math.min(RANKED, Math.floor(rows.length / 2));
  return `- Ranked by PM among ${publisherReport ? "CTV publishers" : "rows"} with ${MIN_CONVERSIONS}+ conversions (${rows.length} of ${b.rows.length}): best ${show(byPm.slice(0, n))}; weakest ${show(byPm.slice(-n).reverse())}.`;
}

function breakdownSection(b: BreakdownDigest, limit: number, conversionLabel: string): string {
  const { shown, rest } = pickRows(b, limit);
  const lines = [`BY ${b.dimension.toUpperCase()} (${b.rows.length} rows; shares are of this report's own totals${b.sharedTotals ? ", which match the other breakdowns" : ""}):`, ...shown.map((r) => rowLine(r, conversionLabel))];
  const ranking = rankingLine(b);
  if (rest.length) {
    const spend = rest.reduce((s, r) => s + (r.metrics.spend ?? 0), 0);
    const conversions = rest.reduce((s, r) => s + (r.metrics.conversions ?? 0), 0);
    lines.push(`- ${rest.length} more rows: ${money(spend)} (${pct(b.totals.spend ? spend / b.totals.spend : null, 1)} of spend), ${count(conversions)} ${conversionLabel}.`);
  }
  if (ranking) lines.push(ranking);
  return lines.join("\n");
}

function touchSection(analysis: CampaignAnalysis, compact: boolean): string[] {
  const label = analysis.conversionLabel.label;
  return analysis.touches.filter((t) => t.role !== "reference").map(({ fileName, summary: s }) => {
    const lines = [
      `${s.attribution === "all-touch" ? "ALL-TOUCH" : "LAST-TOUCH"} CONVERSIONS (${fileName}): ${count(s.conversions)} ${label} from ${count(s.households)} households${s.repeatHouseholds ? ` (${count(s.repeatHouseholds)} converted more than once)` : ""}, ${money(s.revenue)} revenue${s.conversionWindow ? `, ${formatDay(s.conversionWindow.start)} to ${formatDay(s.conversionWindow.end)}` : ""}.`,
      s.touchesPerConversion ? `- Impressions per converting path: median ${s.touchesPerConversion.median}, 90th percentile ${Math.round(s.touchesPerConversion.p90)}, max ${s.touchesPerConversion.max}.` : "",
      s.medianHoursToConvert !== null ? `- Credited impression to conversion: median ${Math.round(s.medianHoursToConvert)} hours; longest ${s.maxLookbackHours} hours from ${s.attribution === "all-touch" ? "first exposure" : "the credited impression"} (the lookback window is at least that).` : "",
      s.attribution === "all-touch" ? "- Credit by media type (conversions: last touch / first touch / on the path at all / linear):" : "- Credit by media type (last touch):",
      ...s.byMediaType.map((m) => s.attribution === "all-touch"
        ? `  ${m.mediaType}${m.isCtv ? " (CTV)" : ""}: ${count(m.lastTouch)} / ${count(m.firstTouch)} / ${count(m.anyTouch)} / ${fractional(m.linear)}; only touch on ${count(m.onlyTouch)}`
        : `  ${m.mediaType}${m.isCtv ? " (CTV)" : ""}: ${count(m.lastTouch)} (${pct(m.lastTouch / Math.max(1, s.conversions))})${m.medianHoursToConvert !== null ? `, median ${Math.round(m.medianHoursToConvert)}h to convert` : ""}`),
      s.ctv && s.ctv.anyTouch === 0 ? "- CTV: no converting path had a CTV exposure." : "",
      s.ctv && s.ctv.anyTouch > 0 ? `- CTV: on ${pct(s.ctv.anyTouch / Math.max(1, s.conversions))} of converting paths, credited with ${count(s.ctv.lastTouch)} under last touch; ${count(s.ctv.creditedElsewhere)} CTV-exposed conversions were credited to another media type.` : "",
      ...(s.paths.length ? [`- Most common paths (media type order, repeats collapsed):`, ...s.paths.slice(0, compact ? 3 : 6).map((p) => `  ${p.path.join(" > ")}: ${count(p.conversions)}`)] : []),
      s.publishers.length ? `- CTV publishers (on path / last touch): ${s.publishers.slice(0, compact ? 5 : 10).map((p) => `${p.name} ${count(p.anyTouch)}/${count(p.lastTouch)}`).join("; ")}` : "",
      s.dma.length ? `- Top DMAs (credited touch): ${s.dma.slice(0, compact ? 3 : 6).map((d) => `${d.name} ${count(d.conversions)}`).join("; ")}` : "",
      s.device.length ? `- Devices (credited touch): ${s.device.map((d) => `${d.name} ${count(d.conversions)}`).join("; ")}` : "",
    ];
    return lines.filter(Boolean).join("\n");
  });
}

function attributionSection(analysis: CampaignAnalysis): string {
  const a = analysis.attribution;
  if (!a) return "";
  return [
    `SAME SPEND, DIFFERENT CREDIT (spend from ${a.spendFile}; conversions from ${a.fileName}${a.coverage !== null ? `, which holds ${pct(a.coverage)} of reported conversions` : ""}):`,
    ...a.rows.map((r) => `- ${r.mediaType}${r.isCtv ? " (CTV)" : ""}: ${money(r.spend)} (${pct(r.spendShare)}) | last-touch CPA ${dollars(r.cpaLastTouch) ?? "n/a"}, PM ${r.pmLastTouch?.toFixed(2) ?? "n/a"} | linear CPA ${dollars(r.cpaLinear) ?? "n/a"}, PM ${r.pmLinear?.toFixed(2) ?? "n/a"}`),
  ].join("\n");
}

export function renderDigest(analysis: CampaignAnalysis, { maxChars = DEFAULT_DIGEST_CHARS } = {}): string {
  for (const [limit, compact] of [[12, false], [8, false], [6, true], [4, true], [2, true]] as Array<[number, boolean]>) {
    const text = compose(analysis, limit, compact);
    if (text.length <= maxChars) return text;
  }
  const text = compose(analysis, 2, true);
  return `${text.slice(0, maxChars - 40)}\n[digest cut to fit]`;
}

function compose(analysis: CampaignAnalysis, limit: number, compact: boolean): string {
  const label = analysis.conversionLabel.label;
  const t = analysis.totals;
  const out: string[] = [];
  out.push([
    `PAST CAMPAIGN PERFORMANCE${analysis.advertiser ? `: ${analysis.advertiser}` : ""}${analysis.flight ? `, ${formatWindow(analysis.flight)} (${windowDays(analysis.flight)} days)` : ""}.`,
    `Conversion event: ${label} (${{ planner: "set by the planner", summary: "named in the conversions summary", column: "the export's column name", default: "the export does not say what it is" }[analysis.conversionLabel.source]}). Attribution is the platform's IP-matched pixel, click or view-through.`,
  ].join("\n"));
  if (t) {
    out.push(`TOTALS: ${[
      t.spend !== undefined ? `spend ${money(t.spend)}` : "",
      t.impressions !== undefined ? `${count(t.impressions)} impressions` : "",
      t.conversions !== undefined ? `${count(t.conversions)} ${label}` : "",
      (t.revenue ?? 0) > 0 ? `revenue ${money(t.revenue)}` : "",
      t.cpa !== null ? `CPA ${dollars(t.cpa)}` : "",
      t.roas !== null && (t.revenue ?? 0) > 0 ? `ROAS ${times(t.roas)}` : "",
      t.cpm !== null ? `CPM ${dollars(t.cpm)}` : "",
      t.ctr !== null && (t.clicks ?? 0) > 0 ? `CTR ${rate(t.ctr)}` : "",
      t.vcr !== null && (t.videoCompletions ?? 0) > 0 ? `VCR ${rate(t.vcr)} on video` : "",
      analysis.reach ? `reach ${count(analysis.reach.reach)}${analysis.reach.frequency ? ` at ${analysis.reach.frequency.toFixed(1)} frequency` : ""}` : "",
    ].filter(Boolean).join("; ")}.`);
  }
  const notes = [...analysis.warnings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  if (notes.length) out.push(["DATA NOTES (read before drawing conclusions):", ...notes.map((w) => `- ${w.severity === "info" ? "" : `${w.severity.toUpperCase()}: `}${w.message}`)].join("\n"));

  const ranked = analysis.breakdowns
    .filter((b) => b.role !== "reference")
    .sort((a, b) => rank(a.dimension) - rank(b.dimension));
  for (const b of ranked) out.push(breakdownSection(b, rank(b.dimension) === 0 ? Math.max(limit, 12) : limit, label));

  for (const s of analysis.series.filter((s) => s.role !== "reference" && s.weeks.length > 1)) {
    out.push(`BY WEEK (${s.days} days${s.cumulative ? ", from a running-total export" : ""}): ${s.weeks.map((w) => `${formatDay(w.start)}${w.days < 7 ? ` (${w.days}d)` : ""} ${money(w.spend)}, ${count(w.conversions)} ${label}, CPA ${dollars(w.cpa) ?? "n/a"}`).join("; ")}`);
  }
  for (const p of analysis.pacing) {
    out.push(`INSERTION ORDER PACING${p.window ? ` (${formatWindow(p.window)})` : ""}: budget ${money(p.budget)}, spent ${money(p.spent)}${p.pacing !== null ? `, ${p.pacing.toFixed(1)}% delivered` : ""}${p.expected !== null ? ` against ${p.expected.toFixed(1)}% expected` : ""}.`);
  }
  out.push(...touchSection(analysis, compact));
  const attribution = attributionSection(analysis);
  if (attribution) out.push(attribution);

  const pacing = new Set(analysis.pacing.map((p) => p.fileName));
  const reference = analysis.files.filter((f) => f.role === "reference" && !pacing.has(f.fileName));
  if (reference.length) out.push(`REFERENCE FILES (outside the flight; not combined with it): ${reference.map((f) => `${f.reportType ?? f.fileName}${f.window ? ` ${formatWindow(f.window)}` : ""}`).join("; ")}`);
  return out.join("\n\n");
}

const rank = (dimension: string) => {
  const i = DIMENSION_ORDER.findIndex((re) => re.test(dimension));
  return i < 0 ? DIMENSION_ORDER.length : i;
};
