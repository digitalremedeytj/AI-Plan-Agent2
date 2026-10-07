// The ScoutAI prompt library: ready-made questions a planner picks from the chat panel, edited by
// an admin in Settings. Built-in prompts ship here with fixed ids; the stored library holds the
// admin's version, and a built-in added in a later release still appears for everyone.
//
// Each prompt says what kind of turn it is rather than leaving that to its wording: free-typed
// messages are routed by a keyword match (PERFORMANCE_QUESTION in server.ts), which sends
// anything mentioning "campaign" down the slow past-performance path. A prompt also says what
// it needs (a past campaign, a recap...), so one that cannot be answered is shown greyed out
// with the reason instead of producing a useless answer.

export const PROMPT_NEEDS = ["pastCampaign", "liveCampaign", "recap", "qaFindings"] as const;
export type PromptNeed = (typeof PROMPT_NEEDS)[number];

/** plan: an ordinary plan question. analysis: past-performance analysis (summary first). analysisFull: analysis from every report row. */
export const PROMPT_MODES = ["plan", "analysis", "analysisFull"] as const;
export type PromptMode = (typeof PROMPT_MODES)[number];

export const PROMPT_VARIABLES = ["advertiser", "kpis", "largestMediaType", "largestMediaTypeShare", "openQaFindings"] as const;
export type PromptVariable = (typeof PROMPT_VARIABLES)[number];

export interface ScoutPrompt {
  id: string;
  title: string;
  category: string;
  /** Sent as the planner's message, after variables are filled; the planner can edit it first. */
  text: string;
  needs: PromptNeed[];
  mode: PromptMode;
  /** Shown as a quick suggestion above the input when its needs are met. */
  featured: boolean;
  enabled: boolean;
  builtIn: boolean;
}

export const NEED_LABELS: Record<PromptNeed, string> = {
  pastCampaign: "a past campaign linked to this plan",
  liveCampaign: "a live campaign linked to this plan",
  recap: "a Campaign Recap in this plan",
  qaFindings: "open QA findings",
};

export const MODE_LABELS: Record<PromptMode, string> = {
  plan: "Plan question",
  analysis: "Past-performance analysis",
  analysisFull: "Past-performance analysis (full data)",
};

export const VARIABLE_LABELS: Record<PromptVariable, string> = {
  advertiser: "The plan's advertiser",
  kpis: "The plan's KPIs",
  largestMediaType: "The media type with the largest share",
  largestMediaTypeShare: "That media type's share, e.g. 18%",
  openQaFindings: "How many QA findings are open",
};

const builtIn = (p: Omit<ScoutPrompt, "builtIn" | "enabled">): ScoutPrompt => ({ ...p, enabled: true, builtIn: true });

/** The order here is the library's order; the first featured prompts whose needs are met are the quick suggestions. */
export const DEFAULT_SCOUT_PROMPTS: ScoutPrompt[] = [
  builtIn({ id: "live-tracking", title: "Live campaign check", category: "Past campaigns", mode: "analysis", needs: ["liveCampaign"], featured: true,
    text: "How is the live campaign tracking against the plan, and what should we change?" }),
  builtIn({ id: "past-analysis", title: "Past campaign analysis", category: "Past campaigns", mode: "analysis", needs: ["pastCampaign"], featured: true,
    text: "Analyse our past campaign: what worked, what didn't, and what should this plan change?" }),
  builtIn({ id: "improve-kpis", title: "Improve toward the KPIs", category: "Plan review", mode: "plan", needs: [], featured: true,
    text: "What would you change to improve performance toward our KPIs?" }),
  builtIn({ id: "brief-delivery", title: "Does it deliver the brief?", category: "Plan review", mode: "plan", needs: [], featured: true,
    text: "Does this plan deliver what the brief asked for?" }),
  builtIn({ id: "largest-media-type", title: "Why the largest share?", category: "Plan review", mode: "plan", needs: [], featured: true,
    text: "Why does {largestMediaType} get {largestMediaTypeShare} of the budget?" }),
  builtIn({ id: "qa-findings", title: "Handle open QA findings", category: "Plan review", mode: "plan", needs: ["qaFindings"], featured: true,
    text: "How should we handle the {openQaFindings} open QA findings?" }),
  builtIn({ id: "plan-health-check", title: "Plan health check", category: "Plan review", mode: "plan", needs: [], featured: false,
    text: "Review this plan against the brief and KPIs. List the three biggest gaps or risks, most important first, each with its evidence and a proposed fix. Leave anything that already serves the KPIs alone." }),
  builtIn({ id: "personas-fit", title: "Personas vs brand and KPIs", category: "Plan review", mode: "plan", needs: [], featured: true,
    text: "Do the personas fit the brand, what it sells and the campaign KPIs? Rate each persona strong, partial or weak, say why, and propose edits or a replacement for any weak fit." }),
  builtIn({ id: "budget-mix", title: "Budget mix vs KPIs", category: "Plan review", mode: "plan", needs: [], featured: false,
    text: "Is the budget split across media types right for our KPIs? Name any media type that looks over- or under-weighted and why, and propose allocation changes within the catalog limits." }),
  builtIn({ id: "ctv-publisher-fit", title: "CTV publisher fit", category: "Plan review", mode: "plan", needs: [], featured: false,
    text: "Do the CTV publishers fit this audience and KPIs? Flag weak fits and suggest replacements from the catalog." }),
  builtIn({ id: "client-readiness", title: "Client readiness check", category: "Plan review", mode: "plan", needs: [], featured: false,
    text: "Read this plan as the client will. Flag anything unclear, unsupported, or inconsistent between sections, and propose text fixes." }),
  builtIn({ id: "keep-cut-test", title: "Keep, cut, test", category: "Past campaigns", mode: "analysis", needs: ["pastCampaign"], featured: false,
    text: "Using our past campaign, sort what it showed into keep, cut and test, and propose the plan changes for each. Treat small-sample results as tests." }),
  builtIn({ id: "past-vs-kpis", title: "Past results vs this plan's KPIs", category: "Past campaigns", mode: "analysis", needs: ["pastCampaign"], featured: false,
    text: "How did the last campaign do against this plan's KPIs? Say where this plan already addresses the gaps and what it still ignores, then propose the changes you would make to improve performance toward the KPIs, as items I can review and apply." }),
  builtIn({ id: "apply-recap", title: "Apply the recap", category: "Past campaigns", mode: "analysis", needs: ["recap"], featured: false,
    text: "Which campaign recap recommendations aren't in this plan yet? Propose changes for the ones with the strongest evidence." }),
];

export const MAX_PROMPTS = 40;
const MAX_TITLE = 80;
const MAX_CATEGORY = 40;
const MAX_TEXT = 1500;
const VARIABLE = /\{([A-Za-z]+)\}/g;

export function promptVariables(text: string): string[] {
  return [...text.matchAll(VARIABLE)].map((m) => m[1]);
}

const clean = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * The library as stored: the admin's prompts, in their order, with any built-in prompt the
 * stored copy has not seen yet (one added in a later release) appended where it is missing.
 */
export function mergeWithDefaults(stored: ScoutPrompt[] | null | undefined): ScoutPrompt[] {
  if (!stored?.length) return DEFAULT_SCOUT_PROMPTS.map((p) => ({ ...p }));
  const ids = new Set(stored.map((p) => p.id));
  return [...stored, ...DEFAULT_SCOUT_PROMPTS.filter((p) => !ids.has(p.id)).map((p) => ({ ...p }))];
}

export interface PromptLibraryValidation {
  valid: boolean;
  errors: string[];
  prompts: ScoutPrompt[];
}

/** Checks an edited library from the browser. Built-in prompts can be edited or turned off, not deleted. */
export function validatePromptLibrary(raw: unknown): PromptLibraryValidation {
  const errors: string[] = [];
  const list = Array.isArray(raw) ? raw : [];
  if (list.length > MAX_PROMPTS) errors.push(`The library holds at most ${MAX_PROMPTS} prompts.`);
  const seen = new Set<string>();
  const prompts: ScoutPrompt[] = [];
  for (const [index, item] of list.slice(0, MAX_PROMPTS).entries()) {
    const p = (item ?? {}) as Record<string, unknown>;
    const id = clean(p.id, 60).replace(/[^a-z0-9-]/gi, "").toLowerCase();
    const title = clean(p.title, MAX_TITLE);
    const text = typeof p.text === "string" ? p.text.trim().slice(0, MAX_TEXT) : "";
    const where = title ? `"${title}"` : `Prompt ${index + 1}`;
    if (!id) { errors.push(`${where} has no id.`); continue; }
    if (seen.has(id)) { errors.push(`${where} repeats the id "${id}".`); continue; }
    seen.add(id);
    if (!title) errors.push(`${where} needs a title.`);
    if (!text) errors.push(`${where} needs prompt text.`);
    const unknown = promptVariables(text).filter((v) => !PROMPT_VARIABLES.includes(v as PromptVariable));
    if (unknown.length) errors.push(`${where} uses ${unknown.map((v) => `{${v}}`).join(", ")}, which ${unknown.length === 1 ? "is not a variable" : "are not variables"}. Available: ${PROMPT_VARIABLES.map((v) => `{${v}}`).join(", ")}.`);
    prompts.push({
      id,
      title,
      category: clean(p.category, MAX_CATEGORY) || "Other",
      text,
      needs: (Array.isArray(p.needs) ? p.needs : []).filter((n): n is PromptNeed => PROMPT_NEEDS.includes(n as PromptNeed)),
      mode: PROMPT_MODES.includes(p.mode as PromptMode) ? (p.mode as PromptMode) : "plan",
      featured: p.featured === true,
      enabled: p.enabled !== false,
      builtIn: DEFAULT_SCOUT_PROMPTS.some((d) => d.id === id),
    });
  }
  const missing = DEFAULT_SCOUT_PROMPTS.filter((d) => !seen.has(d.id));
  if (missing.length) errors.push(`Built-in prompts can be turned off but not removed: ${missing.map((d) => `"${d.title}"`).join(", ")}.`);
  return { valid: errors.length === 0, errors, prompts };
}

/** What a prompt can be filled from and checked against. Built in the browser from the open plan. */
export interface PromptContext {
  advertiser: string;
  kpis: string[];
  largestMediaType: { name: string; share: number } | null;
  openQaFindings: number;
  hasPastCampaign: boolean;
  hasLiveCampaign: boolean;
  hasRecap: boolean;
}

function variableValue(variable: string, ctx: PromptContext): string | null {
  switch (variable as PromptVariable) {
    case "advertiser": return ctx.advertiser.trim() || null;
    case "kpis": return ctx.kpis.length ? ctx.kpis.join(", ") : null;
    case "largestMediaType": return ctx.largestMediaType?.name ?? null;
    case "largestMediaTypeShare": return ctx.largestMediaType ? `${Math.round(ctx.largestMediaType.share)}%` : null;
    case "openQaFindings": return ctx.openQaFindings > 0 ? String(ctx.openQaFindings) : null;
    default: return null;
  }
}

const VARIABLE_GAPS: Record<PromptVariable, string> = {
  advertiser: "an advertiser name",
  kpis: "KPIs in the brief",
  largestMediaType: "a channel plan",
  largestMediaTypeShare: "a channel plan",
  openQaFindings: "open QA findings",
};

export interface PromptAvailability {
  available: boolean;
  /** Why not, in the planner's words: "Needs a past campaign linked to this plan". */
  reason: string | null;
  /** The prompt with its variables filled, when available. */
  text: string;
}

export function promptAvailability(prompt: ScoutPrompt, ctx: PromptContext): PromptAvailability {
  const met: Record<PromptNeed, boolean> = {
    pastCampaign: ctx.hasPastCampaign,
    liveCampaign: ctx.hasLiveCampaign,
    recap: ctx.hasRecap,
    qaFindings: ctx.openQaFindings > 0,
  };
  const unmet = prompt.needs.filter((n) => !met[n]);
  if (unmet.length) return { available: false, reason: `Needs ${unmet.map((n) => NEED_LABELS[n]).join(" and ")}`, text: prompt.text };
  const gaps: string[] = [];
  const text = prompt.text.replace(VARIABLE, (whole, name: string) => {
    const value = variableValue(name, ctx);
    if (value === null) {
      gaps.push(VARIABLE_GAPS[name as PromptVariable] ?? `{${name}}`);
      return whole;
    }
    return value;
  });
  if (gaps.length) return { available: false, reason: `Needs ${[...new Set(gaps)].join(" and ")}`, text: prompt.text };
  return { available: true, reason: null, text };
}

/** The quick suggestions above the input: the first featured, enabled prompts the plan can answer. */
export function featuredPrompts(prompts: ScoutPrompt[], ctx: PromptContext, limit = 4): Array<{ prompt: ScoutPrompt; text: string }> {
  return prompts
    .filter((p) => p.enabled && p.featured)
    .map((prompt) => ({ prompt, availability: promptAvailability(prompt, ctx) }))
    .filter((p) => p.availability.available)
    .slice(0, limit)
    .map(({ prompt, availability }) => ({ prompt, text: availability.text }));
}
