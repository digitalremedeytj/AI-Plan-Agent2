// Slide exports for the executive brief: an AI-rendered image (like the persona, channel and
// segment slides) and a prompt for the Gemini chat in Google Slides. Both are built from the
// same slide text, and that text is built here, in code, from the brief as the planner sees it
// (hand edits applied, sections hidden from the share link left out). Nothing is summarised by
// a model on the way, so a slide cannot say what the brief does not.
//
// Image models garble dense text, so each slide has a word budget and the builder trims to it
// (fewer bullets, then fewer rows and details) rather than hoping the renderer copes. After rendering,
// the server reads the image back and compares it with this text (the proofread).

import { currentCatalogLabel } from "../planning/knowledge/normalizeWorkbook";
import { BRIEF_SECTION_LABELS, parseEditText, type BriefBullet, type BriefSection, type BriefSectionKey, type ExecutiveBrief } from "./executiveBrief";

export type BriefSlideVariant = "highlights" | "full";

export const BRIEF_SLIDE_VARIANTS: Record<BriefSlideVariant, { label: string; description: string }> = {
  highlights: { label: "Highlights", description: "1 concise slide: every section's headline, every channel and the measurement. Plus a campaign history slide when the plan shows one." },
  full: { label: "Full summary", description: "3 slides: strategy (understanding, POV), audience (every persona), then media and measurement. Plus a campaign history slide when the plan shows one." },
};

/** Past these the renderer starts dropping and misspelling words. */
export const SLIDE_WORD_BUDGET: Record<BriefSlideVariant, number> = { highlights: 150, full: 240 };

export type BriefSlideLayout = "highlights" | "strategy" | "audience" | "execution" | "history";

export interface BriefSlideSpec {
  id: string;
  label: string;
  layout: BriefSlideLayout;
  /** The exact text the slide carries, rendered verbatim. Editable before generating. */
  text: string;
}

export interface BriefSlideContext {
  advertiserName?: string;
  geography?: string;
  livePercents?: Record<string, number>;
  glance?: Array<{ label: string; value: string }>;
  /**
   * The plan's "Built on your campaign history" learnings, passed only while that section is shown
   * to the client: a slide goes to a client, so a section still hidden from them stays off it.
   */
  learnings?: Array<{ learning: string; action: string }>;
  /** The past campaigns they come from, for the slide's source line. */
  learningsFrom?: string[];
}

export const countWords = (text: string) => text.split(/\s+/).filter((w) => /[A-Za-z0-9$%]/.test(w)).length;

const trimWords = (text: string, max: number) => {
  const parts = text.split(/\s+/).filter(Boolean);
  return parts.length > max ? `${parts.slice(0, max).join(" ").replace(/[,;:.]$/, "")}…` : parts.join(" ");
};

const percent = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(1)}%`;

/** A section as the planner sees it: a hand edit replaces the generated text and its rows. */
interface EffectiveSection {
  key: BriefSectionKey;
  title: string;
  subtitle: string;
  headline: string;
  bullets: BriefBullet[];
  structured: BriefSection | null;
}

export function effectiveBriefSections(brief: ExecutiveBrief): EffectiveSection[] {
  const hidden = new Set(brief.hiddenPanels || []);
  return brief.sections
    .filter((section) => !hidden.has(section.key))
    .map((section) => {
      const edit = brief.edits?.[section.key];
      const labels = BRIEF_SECTION_LABELS[section.key];
      const edited = edit?.content !== undefined ? parseEditText(edit.content) : null;
      return {
        key: section.key,
        title: edit?.title || labels.title,
        subtitle: labels.subtitle,
        headline: edited ? edited.headline : section.headline,
        bullets: edited ? edited.bullets : section.bullets,
        structured: edited ? null : section,
      };
    })
    .filter((section) => section.headline || section.bullets.length > 0 || section.structured);
}

// Lines are dropped whole to fit a budget, never cut mid-sentence: a truncated line on a client
// slide reads as a mistake. The generous word caps only guard against a runaway hand edit.
const bulletLine = (b: BriefBullet) => `• ${b.lead ? `${b.lead}: ` : ""}${trimWords(b.text, 30)}`;

// The at-a-glance strip goes on the first slide only: repeating it costs every slide room.
function header(title: string, context: BriefSlideContext, withGlance = true): string[] {
  const subtitle = [context.advertiserName, context.geography].filter(Boolean).join(" · ");
  const lines = [`SLIDE TITLE: ${title}`];
  if (subtitle) lines.push(`SUBTITLE: ${subtitle}`);
  const glance = withGlance ? (context.glance || []).map((f) => `${f.label}: ${f.value}`) : [];
  if (glance.length) lines.push(`AT A GLANCE: ${glance.join(" | ")}`);
  return lines;
}

// Rows cut to fit end in a "+N more" line, so a shortened list never reads as the whole plan.
function channelRows(section: EffectiveSection, context: BriefSlideContext, opts: { limit?: number; percent?: boolean; role?: boolean }) {
  const all = [...(section.structured?.channels || [])]
    .map((c) => ({ ...c, live: context.livePercents?.[c.channelId] ?? c.allocationPercent }))
    .sort((a, b) => b.live - a.live);
  const withPercent = opts.percent ?? true;
  const shown = all.slice(0, opts.limit ?? all.length);
  const rows = shown.map((c) => `  - ${c.channelName}${withPercent ? ` | ${percent(c.live)}` : ""} | ${c.funnelRole}${opts.role && c.role ? ` | ${trimWords(c.role, 30)}` : ""}`);
  const rest = all.slice(shown.length);
  if (rest.length) {
    const share = rest.reduce((sum, c) => sum + c.live, 0);
    rows.push(`  - + ${rest.length} more channel${rest.length === 1 ? "" : "s"}${withPercent ? ` | ${percent(share)}` : ""}`);
  }
  return rows;
}

function measurementRows(section: EffectiveSection, opts: { limit?: number; proves?: boolean }) {
  const all = [...(section.structured?.measurement || [])].sort((a, b) => Number(b.advanced) - Number(a.advanced));
  const shown = all.slice(0, opts.limit ?? all.length);
  const rows = shown.map((m) => `  - ${currentCatalogLabel(m.capability)}${m.advanced ? ` ${IMPACT_TAG}` : ""}${opts.proves && m.proves ? ` | ${trimWords(m.proves, 30)}` : ""}${opts.proves && m.kpi ? ` | KPI: ${m.kpi}` : ""}`);
  if (all.length > shown.length) rows.push(`  - + ${all.length - shown.length} more`);
  return rows;
}

/**
 * Printed as a tag on measurement that proves business impact. It is real slide text, not a
 * layout marker: a marker the proofread is told to ignore is one the renderer can misplace
 * unnoticed (a live render put one on a capability that has no such claim).
 */
export const IMPACT_TAG = "(Business impact)";

// Each list is one fitting level, most detailed first. Highlights keeps every channel as long as it
// can: the % goes before the funnel role, and only then are channels rolled into "+N more".
const HIGHLIGHT_LEVELS: Array<{ channels?: number; percent: boolean; measurement?: number }> = [
  { percent: true }, { percent: false }, { percent: false, measurement: 4 },
  { channels: 7, percent: false, measurement: 3 }, { channels: 5, percent: false, measurement: 3 },
];
const STRATEGY_LEVELS = [{ bullets: 3 }, { bullets: 2 }, { bullets: 1 }, { bullets: 0 }];
// Every persona stays; their detail and the section's bullets give way instead.
const AUDIENCE_LEVELS = [
  { bullets: 3, why: true }, { bullets: 2, why: true }, { bullets: 1, why: true }, { bullets: 0, why: true }, { bullets: 0, why: false },
];
const EXECUTION_LEVELS = [
  { bullets: 2, roles: true, proves: true }, { bullets: 1, roles: true, proves: true }, { bullets: 0, roles: true, proves: true },
  { bullets: 0, roles: true, proves: false }, { bullets: 0, roles: false, proves: false },
];

function highlightsSlide(sections: EffectiveSection[], context: BriefSlideContext, level: number): string {
  const lv = HIGHLIGHT_LEVELS[level];
  const lines = header("Executive Summary", context);
  for (const section of sections) {
    const headline = section.headline || section.bullets[0]?.text || "";
    lines.push("", `${section.title.toUpperCase()}: ${trimWords(headline, 30)}`);
    if (section.key === "media") lines.push(...channelRows(section, context, { limit: lv.channels, percent: lv.percent }));
    if (section.key === "measurement") lines.push(...measurementRows(section, { limit: lv.measurement }));
  }
  return lines.join("\n");
}

function strategySlide(sections: EffectiveSection[], context: BriefSlideContext, withGlance: boolean, level: number): string {
  const lv = STRATEGY_LEVELS[level];
  const lines = header("Executive Summary: Strategy", context, withGlance);
  for (const section of sections) {
    lines.push("", `SECTION: ${section.title} (${section.subtitle})`);
    if (section.headline) lines.push(`HEADLINE: ${trimWords(section.headline, 30)}`);
    for (const b of section.bullets.slice(0, section.structured ? lv.bullets : 6)) lines.push(bulletLine(b));
  }
  return lines.join("\n");
}

function audienceSlide(section: EffectiveSection, context: BriefSlideContext, withGlance: boolean, level: number): string {
  const lv = AUDIENCE_LEVELS[level];
  const lines = header("Executive Summary: Audience", context, withGlance);
  lines.push("", `SECTION: ${section.title} (${section.subtitle})`);
  if (section.headline) lines.push(`HEADLINE: ${trimWords(section.headline, 30)}`);
  for (const b of section.bullets.slice(0, section.structured ? lv.bullets : 6)) lines.push(bulletLine(b));
  const matches = section.structured?.audienceMatches || [];
  if (matches.length) {
    lines.push("WHO → HOW WE REACH THEM:");
    for (const m of matches) {
      lines.push(`  - ${m.audience} → ${m.reachedWith.join(", ")}`);
      if (lv.why && m.why) lines.push(`    ${trimWords(m.why, 30)}`);
    }
  }
  return lines.join("\n");
}

function executionSlide(sections: EffectiveSection[], context: BriefSlideContext, withGlance: boolean, level: number): string {
  const lv = EXECUTION_LEVELS[level];
  const hasMeasurement = sections.some((s) => s.key === "measurement");
  const lines = header(hasMeasurement ? "Executive Summary: Media & Measurement" : "Executive Summary: Media Strategy", context, withGlance);
  for (const section of sections) {
    lines.push("", `SECTION: ${section.title} (${section.subtitle})`);
    if (section.headline) lines.push(`HEADLINE: ${trimWords(section.headline, 30)}`);
    // A hand-edited section has no rows; its bullets are the content, so they all stay.
    for (const b of section.bullets.slice(0, section.structured ? lv.bullets : 6)) lines.push(bulletLine(b));
    if (section.key === "media") {
      const rows = channelRows(section, context, { role: lv.roles });
      if (rows.length) lines.push(`CHANNEL | ALLOCATION | FUNNEL ROLE${lv.roles ? " | ROLE" : ""}`, ...rows);
    }
    if (section.key === "measurement") {
      const rows = measurementRows(section, { proves: lv.proves });
      if (rows.length) lines.push(`MEASUREMENT${lv.proves ? " | WHAT IT PROVES | KPI" : ""}`, ...rows);
    }
  }
  return lines.join("\n");
}

// Learnings are dropped whole from the end, never shortened: each was checked against the data as written.
const HISTORY_LEVELS = [6, 4, 3, 2];

function historySlide(context: BriefSlideContext, level: number): string {
  const all = context.learnings || [];
  const shown = all.slice(0, HISTORY_LEVELS[level]);
  const lines = header("Built on Your Campaign History", context, false);
  const from = (context.learningsFrom || []).filter(Boolean);
  lines.push("", `SECTION: What your last campaign taught us${from.length ? ` (From ${from.join(" and ")})` : ""}`);
  for (const l of shown) lines.push("", `LEARNING: ${l.learning}`, `→ ${l.action}`);
  if (all.length > shown.length) lines.push("", `+ ${all.length - shown.length} more in the plan`);
  return lines.join("\n");
}

/** Builds each slide at the most detailed level that fits the word budget. */
function fit(build: (level: number) => string, budget: number, levels: number): string {
  // The least detailed level is used even if it is still over budget; the editor shows the count.
  let text = build(0);
  for (let level = 1; level < levels && countWords(text) > budget; level++) text = build(level);
  return text;
}

export function buildBriefSlides(brief: ExecutiveBrief, variant: BriefSlideVariant, context: BriefSlideContext = {}): BriefSlideSpec[] {
  const sections = effectiveBriefSections(brief);
  const budget = SLIDE_WORD_BUDGET[variant];
  const history = (): BriefSlideSpec[] => (context.learnings?.length
    ? [{ id: "history", label: "Campaign history", layout: "history", text: fit((l) => historySlide(context, l), budget, HISTORY_LEVELS.length) }]
    : []);
  if (variant === "highlights") {
    return [{ id: "highlights", label: "Highlights", layout: "highlights", text: fit((l) => highlightsSlide(sections, context, l), budget, HIGHLIGHT_LEVELS.length) }, ...history()];
  }
  const strategy = sections.filter((s) => s.key === "understanding" || s.key === "strategicPov");
  const audience = sections.find((s) => s.key === "audience");
  const execution = sections.filter((s) => s.key === "media" || s.key === "measurement");
  const slides: BriefSlideSpec[] = [];
  const first = () => slides.length === 0;
  if (strategy.length) {
    const glance = first();
    slides.push({ id: "strategy", label: "1. Strategy", layout: "strategy", text: fit((l) => strategySlide(strategy, context, glance, l), budget, STRATEGY_LEVELS.length) });
  }
  if (audience) {
    const glance = first();
    slides.push({ id: "audience", label: `${slides.length + 1}. Audience`, layout: "audience", text: fit((l) => audienceSlide(audience, context, glance, l), budget, AUDIENCE_LEVELS.length) });
  }
  if (execution.length) {
    const glance = first();
    slides.push({
      id: "execution",
      label: `${slides.length + 1}. ${execution.some((s) => s.key === "measurement") ? "Media & Measurement" : "Media"}`,
      layout: "execution",
      text: fit((l) => executionSlide(execution, context, glance, l), budget, EXECUTION_LEVELS.length),
    });
  }
  for (const slide of history()) slides.push({ ...slide, label: `${slides.length + 1}. Campaign history` });
  return slides;
}

// --- shared design language ------------------------------------------------------------------

export type BriefSlideStyle = "corporate_light" | "modern_dark" | "minimal_slate";

const PALETTES: Record<BriefSlideStyle, string> = {
  corporate_light: "Pure white canvas (#FFFFFF); cool slate card containers (#F8FAFC) with 1px #E2E8F0 borders; body text #0c1e24; teal #0e8f86 titles, eyebrow labels and key accents; deep teal #0e3b42 for one or two dark emphasis cards; indigo #6b63e6 secondary tags; lime #a6cf56 only on items tagged (Business impact), and no lime at all when nothing carries that tag.",
  modern_dark: "Deep teal (#0e3b42) canvas and cards; white text; teal #0e8f86 and indigo #6b63e6 accents; lime #a6cf56 only on items tagged (Business impact), and no lime at all when nothing carries that tag; subtle low-contrast borders.",
  minimal_slate: "Pure white canvas (#FFFFFF); high-contrast #0c1e24 typography; thin #E2E8F0 dividers instead of filled cards; teal #0e8f86 eyebrow labels; indigo #6b63e6 accents used sparingly.",
};

export const BRAND_TYPE = "Lexend throughout. Slide title Lexend Bold with tight leading; section eyebrow labels Lexend SemiBold UPPERCASE with 0.08em tracking in teal #0e8f86; headlines Lexend SemiBold; body Lexend Regular at 1.4 leading.";

const LAYOUTS: Record<BriefSlideLayout, string> = {
  highlights: "Title and subtitle top-left. Beneath them, a slim row of 'AT A GLANCE' metric tiles. Then one card per section in a balanced grid (for five sections: three cards on the first row, two wider cards on the second). Each card: the section name as an eyebrow label, then its headline. The Media Strategy card lists every channel line given as compact rows, each with a funnel-role pill, plus the allocation % and a thin proportional bar when a % is given; a '+ N more' line is a quieter final row. The Measurement Strategy card shows its capabilities as chips, with a capability ending in (Business impact) shown as a lime-highlighted chip that carries that tag.",
  strategy: "Title and subtitle top-left, then (when the content has an AT A GLANCE line) a slim row of metric tiles. Below, two equal columns, one per section: eyebrow label, headline, then the bullets.",
  audience: "Title and subtitle top-left, then (when the content has an AT A GLANCE line) a slim row of metric tiles. Below, the section eyebrow label, headline and bullets across the full width. Then one card per 'who → how we reach them' line in an even grid (for four: a 2×2 grid, or four across on a wide canvas): the audience name as the card title, the data it is reached with as small chips, and the indented line beneath it (if any) as the card's body text.",
  history: "Title and subtitle top-left. The section name as a teal eyebrow label, with its bracketed source as quieter text beside it. Then one card per LEARNING in an even grid (two columns; three across for three): the learning as the card's body text, and the line beneath it starting with → as the card's emphasized final line in teal, arrow included. A '+ N more' line is a quieter final row.",
  execution: "Title and subtitle top-left, then (when the content has an AT A GLANCE line) a slim row of metric tiles. Below, the media section on the left (about 60% width): its headline and bullets, then the channel rows as a clean table with a proportional allocation bar and a funnel-role pill per channel. On the right (about 40%): the measurement section as stacked cards, a capability ending in (Business impact) highlighted in lime with that tag. With no measurement section, the channel table spans the full width.",
};

function ratioAdaptation(aspectRatio: string): string {
  if (["3:4", "2:3", "9:16"].includes(aspectRatio)) return `The canvas is vertical (${aspectRatio}): stack the columns and cards top to bottom instead of side by side.`;
  if (aspectRatio === "1:1") return "The canvas is square: arrange the cards in a 2-column grid.";
  return "";
}

// --- image prompt ----------------------------------------------------------------------------

export function buildSlideImagePrompt(options: {
  text: string;
  layout: BriefSlideLayout;
  style: BriefSlideStyle;
  aspectRatio: string;
  size: string;
  customNotes?: string;
}): string {
  const { text, layout, style, aspectRatio, size, customNotes } = options;
  return `A complete, presentation-ready executive summary slide in ${aspectRatio} format (${size}) for a media plan, designed to drop straight into a client deck.

PRESENTATION DIRECTIVES:
- Include the slide title and subtitle exactly as given in the content below.
- ABSOLUTELY NO LOGO: no company logo, brand mark, insignia or watermark anywhere.
- ABSOLUTELY NO FOOTER: no footer bar, page number, slide counter, disclaimer or confidentiality notice.
- No stock photos, people, illustrations or clip art. Simple line icons beside section labels are fine.

TEXT FIDELITY (MOST IMPORTANT):
- Render every piece of text in the SLIDE CONTENT exactly as written, character for character. Do not paraphrase, abbreviate, reorder within a line, add or omit any words.
- Every number, percentage and dollar amount must match exactly.
- The labels "SLIDE TITLE:", "SUBTITLE:", "SECTION:", "HEADLINE:" and "LEARNING:" are structure markers: use them to lay out the slide, do not print them. "AT A GLANCE" may be printed as the label of the metric strip. Render table rows ("A | B | C") as table cells without the "|" characters.
- "${IMPACT_TAG}" is printed as a tag ONLY on the items whose line contains it. No other item gets that tag, a lime highlight, or any other badge that the content does not state.
- Add no other text of any kind.

BRAND DESIGN:
- Typography: ${BRAND_TYPE}
- Palette: ${PALETTES[style] || PALETTES.corporate_light}
- Generous whitespace, 12px rounded cards, soft cool-tinted low-contrast shadows, crisp alignment on a clear grid. Text must be large enough to read when projected.

LAYOUT: ${LAYOUTS[layout]} ${ratioAdaptation(aspectRatio)}

SLIDE CONTENT (verbatim):
${text}
${customNotes ? `\nADDITIONAL DIRECTIVE (style and emphasis only; never change or add text): ${customNotes}` : ""}`;
}

// --- Google Slides prompt ---------------------------------------------------------------------

// Gemini in Google Slides builds one slide per request, so each slide gets a prompt of its own.
// A slide from a multi-slide set says where it sits, so the planner can keep the set consistent.
export function buildGoogleSlidesPrompt(
  slide: BriefSlideSpec,
  options: { advertiserName?: string; style?: BriefSlideStyle; position?: { index: number; count: number } } = {},
): string {
  const { position } = options;
  const part = position && position.count > 1 ? `slide ${position.index + 1} of ${position.count} of ` : "";
  const lines = [
    `Create one slide for a client presentation: ${part}the executive summary of a media plan${options.advertiserName ? ` for ${options.advertiserName}` : ""}.`,
    "",
    "CONTENT RULES",
    "- Use the text below exactly as written. Do not rewrite, shorten, summarize, reorder or add content, and keep every number and percentage exactly as given.",
    "- Put everything on this single slide.",
    "- The labels SLIDE TITLE, SUBTITLE, SECTION, HEADLINE and LEARNING describe the structure; don't print the labels themselves. Show rows written as \"A | B | C\" as a table.",
    `- Show \"${IMPACT_TAG}\" as a highlighted tag only on the items that carry it; don't add badges or tags the content doesn't state.`,
    "- Do not add a logo, footer, page number, confidentiality notice or images of people.",
    "",
    "DESIGN (Digital Remedy brand)",
    `- Font: ${BRAND_TYPE}`,
    `- Colors: ${PALETTES[options.style || "corporate_light"]}`,
    "- Generous whitespace, rounded cards with light borders, a clear grid, and text large enough to read when projected. Simple line icons beside section labels are fine.",
    "",
    `LAYOUT: ${LAYOUTS[slide.layout]}`,
    "",
    "CONTENT",
    slide.text,
  ];
  return lines.join("\n");
}

// --- proofread ---------------------------------------------------------------------------------

export const PROOFREAD_ISSUE_TYPES = ["misspelling", "wrong_number", "missing_text", "extra_text", "logo_or_footer"] as const;
export type ProofreadIssueType = (typeof PROOFREAD_ISSUE_TYPES)[number];

export interface ProofreadIssue {
  type: ProofreadIssueType;
  found: string;
  expected: string;
}

export interface ProofreadResult {
  status: "clean" | "issues" | "unavailable";
  issues: ProofreadIssue[];
  error?: string;
}

export const PROOFREAD_SYSTEM_INSTRUCTION = `You proofread a generated presentation slide against the source text it was meant to render. Read every piece of text in the image carefully, then compare it with the source.

Report only differences a client would notice:
- misspelling: a garbled, misspelled or invented word (found: what the image says; expected: the source word).
- wrong_number: a number, percentage or dollar amount that differs from the source.
- missing_text: a source line, bullet, row or section that does not appear on the slide.
- extra_text: text on the slide that is not in the source (beyond the structure markers).
- logo_or_footer: any logo, brand mark, watermark, footer, page number or confidentiality notice.

Tags and badges count as text: a tag such as "(Business impact)" on an item whose source line does not carry it is extra_text, and one missing from an item that carries it is missing_text.

Ignore: the structure markers (SLIDE TITLE, SUBTITLE, SECTION, HEADLINE, LEARNING, the "AT A GLANCE" label, "|"), capitalization, punctuation (including brackets and colons around a label), bullet symbols, line breaks, and layout choices. If the slide matches, return no issues.`;

export const proofreadSchema = {
  type: "object",
  properties: {
    issues: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: [...PROOFREAD_ISSUE_TYPES] },
          found: { type: "string", description: "What the image shows, or empty when missing." },
          expected: { type: "string", description: "What the source says, or empty for extra text." },
        },
        required: ["type", "found", "expected"],
      },
    },
  },
  required: ["issues"],
};

export function normalizeProofread(raw: unknown): ProofreadResult {
  const list = Array.isArray((raw as any)?.issues) ? (raw as any).issues : null;
  if (!list) return { status: "unavailable", issues: [], error: "The proofread returned no result." };
  const clean = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 200) : "");
  const issues: ProofreadIssue[] = list
    .filter((issue: any) => (PROOFREAD_ISSUE_TYPES as readonly string[]).includes(issue?.type))
    .map((issue: any) => ({ type: issue.type, found: clean(issue.found), expected: clean(issue.expected) }))
    // A "difference" that is identical once case and spacing are ignored is not one.
    .filter((issue: ProofreadIssue) => issue.type === "logo_or_footer" || issue.found.toLowerCase() !== issue.expected.toLowerCase())
    .slice(0, 12);
  return { status: issues.length ? "issues" : "clean", issues };
}
