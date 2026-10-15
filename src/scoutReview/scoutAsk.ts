import type { ScoutLog } from "../storage/types";
import { PROMPT_MODES, type PromptMode } from "../assistant/promptLibrary";
import { topicLabel } from "../assistant/scoutTopics";
import { figureReference, unverifiedFigures } from "../performance/figureCheck";
import { KIND_LABELS } from "./scoutReviewData";

/**
 * "Ask" on the ScoutAI review page: an admin asks Gemini about the conversation log.
 *
 * Every count, share and rate is computed here, from every question in scope, and handed to the
 * model as named datasets. Tables and charts name a dataset and the server fills in the numbers,
 * so the model chooses what to show but cannot miscount it (an earlier tool's "top 5 by count"
 * table ranked 4 above 6). Free tables are for words; any figure the model writes in prose or a
 * free table that the data does not contain is listed as unverified, as ScoutAI does.
 *
 * Pure: the server makes the model call; this builds its input and checks its output.
 */

// --- datasets ----------------------------------------------------------------------

export type AskColumnKind = "text" | "number" | "percent" | "seconds";

export interface AskColumn {
  key: string;
  label: string;
  kind: AskColumnKind;
}

export type AskCell = string | number;

export interface AskDataset {
  id: string;
  title: string;
  columns: AskColumn[];
  rows: Array<Record<string, AskCell>>;
}

const DAY_MS = 86_400_000;
const round1 = (n: number) => Math.round(n * 10) / 10;
const share = (part: number, whole: number) => (whole > 0 ? round1((part / whole) * 100) : 0);
const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const col = (key: string, label: string, kind: AskColumnKind = "number"): AskColumn => ({ key, label, kind });

/** Questions, thumbs, failures and applied changes per group, largest group first. */
function grouped(logs: ScoutLog[], keyOf: (l: ScoutLog) => string, labelOf: (l: ScoutLog) => string, labelKey: string): AskDataset["rows"] {
  const groups = new Map<string, ScoutLog[]>();
  const labels = new Map<string, string>();
  for (const log of logs) {
    const key = keyOf(log);
    groups.set(key, [...(groups.get(key) ?? []), log]);
    if (!labels.has(key)) labels.set(key, labelOf(log));
  }
  return [...groups.entries()]
    .map(([key, items]) => ({
      [labelKey]: labels.get(key) ?? key,
      questions: items.length,
      share_pct: share(items.length, logs.length),
      thumbs_up: items.filter((l) => l.feedback?.rating === "up").length,
      thumbs_down: items.filter((l) => l.feedback?.rating === "down").length,
      failed: items.filter((l) => !l.ok).length,
      applied: items.filter((l) => l.outcome?.status === "applied").length,
    }))
    .sort((a, b) => b.questions - a.questions || String(a[labelKey]).localeCompare(String(b[labelKey])))
    .map((row) => row as Record<string, AskCell>);
}

const GROUP_COLUMNS = [
  col("questions", "Questions"),
  col("share_pct", "Share", "percent"),
  col("thumbs_up", "Thumbs up"),
  col("thumbs_down", "Thumbs down"),
  col("failed", "Failed"),
  col("applied", "Applied"),
];

const personKey = (name: string) => name.trim().toLowerCase();

/** UTC day, or the Monday that starts its UTC week. */
function period(iso: string, weekly: boolean): string {
  const day = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (weekly) day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

export function buildAskDatasets(logs: ScoutLog[]): AskDataset[] {
  const total = logs.length;
  const times = logs.map((l) => Date.parse(l.at)).filter(Number.isFinite);
  const weekly = times.length > 0 && Math.max(...times) - Math.min(...times) > 45 * DAY_MS;

  const overTime = new Map<string, { questions: number; failed: number; thumbs_down: number }>();
  for (const log of logs) {
    const p = period(log.at, weekly);
    const row = overTime.get(p) ?? { questions: 0, failed: 0, thumbs_down: 0 };
    row.questions += 1;
    if (!log.ok) row.failed += 1;
    if (log.feedback?.rating === "down") row.thumbs_down += 1;
    overTime.set(p, row);
  }

  const people = grouped(logs, (l) => personKey(l.actor), (l) => l.actor, "person");
  const lastAsked = new Map<string, string>();
  for (const log of logs) {
    const key = personKey(log.actor);
    if ((lastAsked.get(key) ?? "") < log.at) lastAsked.set(key, log.at);
  }

  const failures = new Map<string, number>();
  for (const log of logs) if (!log.ok) failures.set(log.error?.code || "UNKNOWN", (failures.get(log.error?.code || "UNKNOWN") ?? 0) + 1);
  const failedTotal = [...failures.values()].reduce((a, b) => a + b, 0);

  const advertisers = new Map<string, { advertiser: string; questions: number; people: Set<string> }>();
  for (const log of logs) {
    const name = log.advertiserName?.trim() || "(no advertiser)";
    const entry = advertisers.get(name.toLowerCase()) ?? { advertiser: name, questions: 0, people: new Set<string>() };
    entry.questions += 1;
    entry.people.add(personKey(log.actor));
    advertisers.set(name.toLowerCase(), entry);
  }

  const kinds = (Object.keys(KIND_LABELS) as ScoutLog["kind"][]).map((kind) => {
    const items = logs.filter((l) => l.kind === kind);
    return { type: KIND_LABELS[kind], questions: items.length, share_pct: share(items.length, total), median_seconds: round1(median(items.map((l) => l.durationMs)) / 1000) };
  }).filter((r) => r.questions > 0).sort((a, b) => b.questions - a.questions);

  const proposed = logs.filter((l) => l.ok && l.proposal);
  const outcomes = [
    { outcome: "Answer only", answers: logs.filter((l) => l.ok && !l.proposal).length },
    { outcome: "Proposed, not applied", answers: proposed.filter((l) => !l.outcome).length },
    { outcome: "Applied", answers: logs.filter((l) => l.outcome?.status === "applied").length },
    { outcome: "Undone", answers: logs.filter((l) => l.outcome?.status === "reverted").length },
    { outcome: "Failed", answers: logs.filter((l) => !l.ok).length },
  ].map((r) => ({ ...r, share_pct: share(r.answers, total) }));

  const rated = (pick: (l: ScoutLog) => "up" | "down" | undefined, labels: [string, string, string]) => {
    const up = logs.filter((l) => pick(l) === "up").length;
    const down = logs.filter((l) => pick(l) === "down").length;
    return [
      { rating: labels[0], answers: up, share_pct: share(up, total), share_of_rated_pct: share(up, up + down) },
      { rating: labels[1], answers: down, share_pct: share(down, total), share_of_rated_pct: share(down, up + down) },
      { rating: labels[2], answers: total - up - down, share_pct: share(total - up - down, total), share_of_rated_pct: 0 },
    ];
  };

  const ratingColumns = [col("rating", "Rating", "text"), col("answers", "Answers"), col("share_pct", "Share of all", "percent"), col("share_of_rated_pct", "Share of rated", "percent")];

  return [
    { id: "topics", title: "Questions by topic", columns: [col("topic", "Topic", "text"), ...GROUP_COLUMNS], rows: grouped(logs, (l) => l.topic?.id ?? "", (l) => topicLabel(l.topic?.id), "topic") },
    { id: "prompts", title: "Questions by prompt", columns: [col("prompt", "Prompt", "text"), ...GROUP_COLUMNS], rows: grouped(logs, (l) => l.promptId, (l) => l.promptLabel || l.promptId, "prompt") },
    {
      id: "people",
      title: "Questions by person",
      columns: [col("person", "Person", "text"), ...GROUP_COLUMNS, col("last_asked", "Last asked", "text")],
      rows: people.map((row) => ({ ...row, last_asked: (lastAsked.get(personKey(String(row.person))) ?? "").slice(0, 10) })),
    },
    { id: "types", title: "Questions by type", columns: [col("type", "Type", "text"), col("questions", "Questions"), col("share_pct", "Share", "percent"), col("median_seconds", "Median answer time", "seconds")], rows: kinds },
    {
      id: "over_time",
      title: weekly ? "Questions per week (week starting)" : "Questions per day",
      columns: [col("period", weekly ? "Week of" : "Day", "text"), col("questions", "Questions"), col("failed", "Failed"), col("thumbs_down", "Thumbs down")],
      rows: [...overTime.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([p, r]) => ({ period: p, ...r })),
    },
    { id: "ratings", title: "Planner thumbs", columns: ratingColumns, rows: rated((l) => l.feedback?.rating, ["Thumbs up", "Thumbs down", "Not rated"]) },
    { id: "reviews", title: "Admin reviews", columns: ratingColumns, rows: rated((l) => l.review?.rating, ["Good answer", "Poor answer", "Not reviewed"]) },
    { id: "outcomes", title: "What happened to each answer", columns: [col("outcome", "Outcome", "text"), col("answers", "Answers"), col("share_pct", "Share", "percent")], rows: outcomes },
    {
      id: "failures",
      title: "Failures by error",
      columns: [col("error", "Error", "text"), col("failures", "Failures"), col("share_pct", "Share of failures", "percent")],
      rows: [...failures.entries()].sort((a, b) => b[1] - a[1]).map(([error, n]) => ({ error, failures: n, share_pct: share(n, failedTotal) })),
    },
    {
      id: "advertisers",
      title: "Questions by advertiser (top 25)",
      columns: [col("advertiser", "Advertiser", "text"), col("questions", "Questions"), col("people", "People")],
      rows: [...advertisers.values()].sort((a, b) => b.questions - a.questions).slice(0, 25).map((a) => ({ advertiser: a.advertiser, questions: a.questions, people: a.people.size })),
    },
  ];
}

export function formatCell(value: AskCell | undefined, kind: AskColumnKind): string {
  if (value === undefined || value === "") return "";
  if (typeof value === "string") return value;
  if (kind === "percent") return `${value}%`;
  if (kind === "seconds") return `${value}s`;
  return value.toLocaleString("en-US");
}

function renderDataset(d: AskDataset): string {
  const header = d.columns.map((c) => c.key).join(" | ");
  const rows = d.rows.map((r) => d.columns.map((c) => formatCell(r[c.key], c.kind)).join(" | "));
  return [`[${d.id}] ${d.title}`, header, ...(rows.length ? rows : ["(none)"])].join("\n");
}

// --- the model's input -------------------------------------------------------------

/** Questions listed word for word for the model; the datasets always cover every question. */
export const ASK_MAX_QUESTIONS = 300;

export interface AskTurn {
  role: "admin" | "assistant";
  text: string;
}

export function sanitizeAskTurns(raw: unknown): AskTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t) => t && (t.role === "admin" || t.role === "assistant") && typeof t.text === "string" && t.text.trim())
    .slice(-12)
    .map((t) => ({ role: t.role, text: String(t.text).slice(0, 6_000) }));
}

const oneLine = (s: string, max: number) => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

function renderQuestion(l: ScoutLog): string {
  const meta = [
    l.at.slice(0, 10),
    l.actor,
    l.advertiserName || "(no advertiser)",
    l.promptLabel,
    KIND_LABELS[l.kind],
    `topic: ${topicLabel(l.topic?.id)}`,
    l.ok ? `answered in ${round1(l.durationMs / 1000)}s` : `FAILED (${l.error?.code ?? "unknown"})`,
    l.feedback ? `planner: thumbs ${l.feedback.rating}${l.feedback.comment ? ` "${oneLine(l.feedback.comment, 300)}"` : ""}` : "planner: not rated",
    l.review ? `admin review: ${l.review.rating === "up" ? "good" : "poor"}${l.review.notes ? ` "${oneLine(l.review.notes, 300)}"` : ""}` : "",
    l.proposal ? `proposed ${l.proposal.items.length} change(s)${l.outcome ? `, ${l.outcome.status}` : ", not applied"}` : "",
  ].filter(Boolean).join(" | ");
  // A badly rated answer is what a quality question needs to read; the rest get a glimpse.
  const replyChars = l.feedback?.rating === "down" || l.review?.rating === "down" ? 1_500 : 300;
  return [
    `[${l.id}] ${meta}`,
    `Q: ${oneLine(l.question, 800)}`,
    l.ok ? `A: ${oneLine(l.reply ?? "", replyChars)}` : `Error: ${oneLine(l.error?.message ?? "", 200)}`,
  ].join("\n");
}

export const ASK_SYSTEM_INSTRUCTION = `You help the admins of AI Plan Agent, a media-planning app, understand how planners use ScoutAI (the app's AI assistant) and how good its answers are, so they can improve it.

You get DATASETS, counted by the app from every question in scope, and QUESTIONS: the questions themselves, newest first, with who asked, the prompt, the topic, ratings, outcome and an excerpt of ScoutAI's answer.

Answer as a list of blocks:
- markdown: your prose. Short paragraphs and bullet lists; no markdown tables (use a table block).
- table with "dataset": shows that dataset's rows. Pick the columns to show (dataset column keys, label column first), optionally sortBy (a number column, largest first) and limit.
- chart with "dataset": chart "bar" to compare categories, "line" for over_time, "pie" only for parts of a whole with 6 or fewer slices. x is the dataset's label column, y one or more of its number columns (one for pie).
- table with "columns" and "rows" and no dataset: for words only (themes, example wording, suggestions). Never put counts or rates in it.
- examples: "ids" of questions from QUESTIONS that show what you describe, with a short "text" caption. Use this whenever you characterise a group of questions or answers.
- prompt_draft: a library prompt planners could pick in ScoutAI, when the admin asks for one or you find a question planners keep typing that a ready-made prompt would serve better. "text" is what the planner would send; it may use {advertiser}, {kpis}, {largestMediaType}, {largestMediaTypeShare}, {openQaFindings}. mode: "plan" for plan questions, "analysis" for past-performance questions.

Rules:
- Every count, share, rate or time you state must come from DATASETS, written exactly as there. Do not count questions yourself. If what the admin asks is not in DATASETS, say so and show examples instead of estimating.
- Show numbers with a table or chart block naming a dataset, not by retyping them.
- When the admin asks for a table or a chart, always include one, from the dataset closest to the request: "thumbs down by topic" is the topics dataset with the thumbs_down column, sorted by it. If no dataset fits, say which breakdown is missing.
- Include at least one table or chart whenever the answer rests on counts.
- When QUESTIONS lists fewer than all questions in scope, judgements about wording or answer quality rest on the listed ones; say so once.
- Be direct and specific about what ScoutAI does badly and what would fix it (a prompt, a library prompt, an instruction, a data gap). No preamble.`;

export function buildAskInput(options: { scope: string; logs: ScoutLog[]; datasets: AskDataset[]; turns: AskTurn[] }): { input: string; listed: number } {
  const listed = options.logs.slice(0, ASK_MAX_QUESTIONS);
  const history = options.turns.slice(0, -1).map((t) => `${t.role === "admin" ? "ADMIN" : "YOU"}: ${t.text}`);
  const latest = options.turns[options.turns.length - 1];
  const input = [
    `SCOPE: ${options.scope}. ${options.logs.length} question(s) in scope; ${listed.length} listed in QUESTIONS.`,
    `DATASETS (counted from all ${options.logs.length} questions):\n\n${options.datasets.map(renderDataset).join("\n\n")}`,
    `QUESTIONS:\n\n${listed.map(renderQuestion).join("\n\n")}`,
    history.length ? `CONVERSATION SO FAR:\n${history.join("\n\n")}` : "",
    `ADMIN'S QUESTION:\n${latest?.text ?? ""}`,
  ].filter(Boolean).join("\n\n");
  return { input, listed: listed.length };
}

// --- the model's output ------------------------------------------------------------

export const ASK_BLOCK_TYPES = ["markdown", "table", "chart", "examples", "prompt_draft"] as const;

export function askResponseSchema(datasetIds: string[]) {
  const S = { type: "string" };
  return {
    type: "object",
    properties: {
      blocks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: [...ASK_BLOCK_TYPES] },
            text: S,
            title: S,
            dataset: { type: "string", enum: datasetIds },
            columns: { type: "array", items: S },
            rows: { type: "array", items: { type: "array", items: S } },
            sortBy: S,
            limit: { type: "integer" },
            chart: { type: "string", enum: ["bar", "line", "pie"] },
            x: S,
            y: { type: "array", items: S },
            ids: { type: "array", items: S },
            prompt: {
              type: "object",
              properties: { title: S, category: S, text: S, mode: { type: "string", enum: ["plan", "analysis"] } },
              required: ["title", "text", "mode"],
            },
          },
          required: ["type"],
        },
      },
    },
    required: ["blocks"],
  };
}

export interface PromptDraft {
  title: string;
  category: string;
  text: string;
  mode: PromptMode;
}

export type AskBlock =
  | { type: "markdown"; text: string }
  | { type: "table"; title: string; columns: AskColumn[]; rows: AskCell[][]; source?: string }
  | { type: "chart"; title: string; chart: "bar" | "line" | "pie"; x: AskColumn; y: AskColumn[]; data: Array<Record<string, AskCell>>; source: string }
  | { type: "examples"; text: string; ids: string[] }
  | { type: "prompt_draft"; text: string; prompt: PromptDraft }
  /** The server's own remarks: unverified figures, blocks it could not show. */
  | { type: "note"; text: string };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function datasetRows(dataset: AskDataset, sortBy: unknown, limit: unknown, fallbackLimit: number): Array<Record<string, AskCell>> {
  let rows = [...dataset.rows];
  const sortCol = dataset.columns.find((c) => c.key === sortBy && c.kind !== "text");
  if (sortCol) rows.sort((a, b) => Number(b[sortCol.key] ?? 0) - Number(a[sortCol.key] ?? 0));
  const n = Number.isInteger(limit) && (limit as number) > 0 ? Math.min(limit as number, 100) : fallbackLimit;
  return rows.slice(0, n);
}

/**
 * The model's blocks, checked and filled in: dataset tables and charts get their rows from the
 * datasets, unknown columns and question ids are dropped, and figures in prose or free tables
 * that the data does not contain are listed in a note.
 */
export function resolveAskBlocks(raw: unknown, datasets: AskDataset[], logs: ScoutLog[], knownText: string): AskBlock[] {
  const list = (raw as { blocks?: unknown } | null)?.blocks;
  const blocks: AskBlock[] = [];
  const skipped: string[] = [];
  const byId = new Map(datasets.map((d) => [d.id, d]));
  const logIds = new Set(logs.map((l) => l.id));
  const checkedText: string[] = [];

  for (const b of Array.isArray(list) ? list : []) {
    const type = b?.type;
    if (type === "markdown") {
      const text = str(b.text, 12_000);
      if (text) { blocks.push({ type, text }); checkedText.push(text); }
    } else if (type === "table" && typeof b.dataset === "string" && b.dataset) {
      const dataset = byId.get(b.dataset);
      if (!dataset) { skipped.push(`a table from an unknown dataset (${b.dataset})`); continue; }
      const wanted = Array.isArray(b.columns) ? b.columns.filter((k: unknown) => dataset.columns.some((c) => c.key === k)) : [];
      const columns = wanted.length ? wanted.map((k: string) => dataset.columns.find((c) => c.key === k)!) : dataset.columns;
      if (columns[0]?.kind !== "text") columns.unshift(dataset.columns[0]);
      const rows = datasetRows(dataset, b.sortBy, b.limit, 25).map((r) => columns.map((c: AskColumn) => r[c.key] ?? ""));
      blocks.push({ type: "table", title: str(b.title, 200) || dataset.title, columns, rows, source: dataset.title });
    } else if (type === "table") {
      const headers: string[] = Array.isArray(b.columns) ? b.columns.slice(0, 8).map((h: unknown) => str(h, 80)) : [];
      const rows: string[][] = Array.isArray(b.rows) ? b.rows.slice(0, 30).filter(Array.isArray).map((r: unknown[]) => headers.map((_, i) => str(r[i], 600))) : [];
      if (!headers.length || !rows.length) continue;
      blocks.push({ type: "table", title: str(b.title, 200), columns: headers.map((h, i) => ({ key: `c${i}`, label: h, kind: "text" as const })), rows });
      checkedText.push(rows.map((r) => r.join(" \n ")).join(" \n "));
    } else if (type === "chart") {
      const dataset = byId.get(b.dataset);
      const chart = b.chart === "line" || b.chart === "pie" ? b.chart : "bar";
      if (!dataset) { skipped.push(`a chart from an unknown dataset (${b.dataset ?? "none"})`); continue; }
      const x = dataset.columns.find((c) => c.key === b.x && c.kind === "text") ?? dataset.columns.find((c) => c.kind === "text")!;
      let y = (Array.isArray(b.y) ? b.y : []).map((k: unknown) => dataset.columns.find((c) => c.key === k && c.kind !== "text")).filter(Boolean) as AskColumn[];
      if (!y.length) y = dataset.columns.filter((c) => c.kind !== "text").slice(0, 1);
      if (chart === "pie") y = y.slice(0, 1);
      const data = datasetRows(dataset, b.sortBy, b.limit, chart === "line" ? 100 : 12);
      if (!data.length) { skipped.push(`a chart of "${dataset.title}", which has no rows`); continue; }
      blocks.push({ type: "chart", title: str(b.title, 200) || dataset.title, chart, x, y, data, source: dataset.title });
    } else if (type === "examples") {
      const ids: string[] = (Array.isArray(b.ids) ? (b.ids as unknown[]) : []).filter((id): id is string => typeof id === "string" && logIds.has(id));
      const unique = [...new Set(ids)].slice(0, 20);
      if (unique.length) blocks.push({ type, text: str(b.text, 600), ids: unique });
    } else if (type === "prompt_draft") {
      const p = b.prompt ?? {};
      const text = str(p.text, 1_500);
      if (!text) continue;
      const mode = (PROMPT_MODES as readonly string[]).includes(p.mode) ? (p.mode as PromptMode) : "plan";
      blocks.push({ type, text: str(b.text, 1_000), prompt: { title: str(p.title, 80) || "New prompt", category: str(p.category, 40) || "From ScoutAI review", text, mode } });
    }
  }

  const unverified = unverifiedFigures(checkedText.join(" \n "), figureReference(knownText));
  if (unverified.length) blocks.push({ type: "note", text: `Not found in the counted data, so check before using: ${unverified.join(", ")}.` });
  if (skipped.length) blocks.push({ type: "note", text: `Left out ${skipped.join("; ")}.` });
  if (!blocks.some((b) => b.type !== "note")) blocks.unshift({ type: "markdown", text: "I couldn't put an answer together for that. Try asking it another way." });
  return blocks;
}

/** Everything the model was given, for the figure check: the datasets as rendered, and the questions. */
export function askKnownText(datasets: AskDataset[], logs: ScoutLog[]): string {
  return [...datasets.map(renderDataset), ...logs.slice(0, ASK_MAX_QUESTIONS).map(renderQuestion), String(logs.length)].join("\n");
}

/** The answer as plain text, for the conversation history sent with the next question. */
export function askBlocksAsText(blocks: AskBlock[]): string {
  return blocks.map((b) => {
    if (b.type === "markdown" || b.type === "note") return b.text;
    if (b.type === "table" || b.type === "chart") return `[${b.type}: ${b.title}]`;
    if (b.type === "examples") return `[examples: ${b.text}]`;
    return `[library prompt draft: ${b.prompt.title}]`;
  }).join("\n");
}
