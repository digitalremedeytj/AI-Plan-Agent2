import type { ScoutLog } from "../storage/types";

/**
 * What ScoutAI questions are about, so the review page can count them. Typed questions all share
 * one prompt ("Typed question"), so prompt counts cannot say what planners ask; a topic can.
 *
 * Gemini picks the topic, from this fixed list only, once per question: in the background after
 * the answer is saved, or by the review page's backfill for older records. The tag is stored on
 * the record, so counting is done by code and the same question always counts the same way.
 * Renaming a label is safe; changing an id orphans the records tagged with it.
 */

export interface ScoutTopic {
  id: string;
  label: string;
  /** Told to the model, to tell neighbouring topics apart. */
  hint: string;
}

export const SCOUT_TOPICS: ScoutTopic[] = [
  { id: "budget_mix", label: "Budget & channel mix", hint: "shifting budget, channel or media-type shares, allocations, flighting" },
  { id: "audience", label: "Audience & targeting", hint: "personas, segments, targeting, who the plan reaches" },
  { id: "publishers", label: "CTV publishers & inventory", hint: "which publishers or apps, inventory, deals, best or worst publishers" },
  { id: "past_performance", label: "Past performance", hint: "what worked in past campaigns, CPA, ROAS, conversions, learnings" },
  { id: "live_pacing", label: "Live campaign & pacing", hint: "a running campaign's delivery, pacing, optimisation in flight" },
  { id: "measurement", label: "KPIs & measurement", hint: "KPIs, attribution, frequency, reach, what a metric means" },
  { id: "creative", label: "Creative", hint: "ad creative, formats, messaging, creative performance" },
  { id: "exec_summary", label: "Executive summary & write-ups", hint: "writing or rewriting the executive summary, narrative or recap text" },
  { id: "plan_review", label: "Plan review & QA", hint: "checking the plan, health checks, QA findings, what is wrong or missing" },
  { id: "how_to", label: "Using the app", hint: "how to do something in AI Plan Agent, exports, where a feature is" },
  { id: "other", label: "Other", hint: "anything that fits none of the above" },
];

export const TOPIC_IDS = SCOUT_TOPICS.map((t) => t.id);
const LABELS = new Map(SCOUT_TOPICS.map((t) => [t.id, t.label]));

/** The label for a stored topic id; "Not tagged yet" for none, and the id itself for a retired one. */
export function topicLabel(id: string | undefined): string {
  if (!id) return "Not tagged yet";
  return LABELS.get(id) ?? id;
}

/** How many questions one model call tags. Small enough to answer at low thinking in seconds. */
export const TOPIC_BATCH = 40;

export const TOPIC_SYSTEM_INSTRUCTION = [
  "You sort questions that media planners asked ScoutAI, the assistant inside a media-planning app, by topic.",
  "Give every question exactly one topic id from the list, the one that best says what the planner wanted. Use \"other\" only when none fits.",
  "Topics:",
  ...SCOUT_TOPICS.map((t) => `- ${t.id}: ${t.label} (${t.hint})`),
].join("\n");

export const topicResponseSchema = {
  type: "object",
  properties: {
    tags: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, topic: { type: "string", enum: TOPIC_IDS } },
        required: ["id", "topic"],
      },
    },
  },
  required: ["tags"],
};

export function buildTopicInput(logs: Array<Pick<ScoutLog, "id" | "question" | "promptLabel" | "kind">>): string {
  return logs
    .map((l) => `[${l.id}] (${l.promptLabel}; ${l.kind} question) ${l.question.replace(/\s+/g, " ").slice(0, 600)}`)
    .join("\n");
}

/** The model's tags, kept only for the questions that were sent and topics that exist. */
export function normalizeTopicTags(raw: unknown, sentIds: string[]): Map<string, string> {
  const sent = new Set(sentIds);
  const tags = new Map<string, string>();
  const list = (raw as { tags?: unknown } | null)?.tags;
  if (!Array.isArray(list)) return tags;
  for (const tag of list) {
    const id = typeof tag?.id === "string" ? tag.id.trim() : "";
    const topic = typeof tag?.topic === "string" ? tag.topic : "";
    if (!sent.has(id) || tags.has(id)) continue;
    tags.set(id, LABELS.has(topic) ? topic : "other");
  }
  return tags;
}
