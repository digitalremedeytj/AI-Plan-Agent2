// Slide exports for the executive brief: an AI-rendered image (like the persona, channel and
// segment slides) and a prompt for the Gemini chat in Google Slides. Both are built from the
// same slide text, and that text is built here, in code, from the brief as the planner sees it
// (hand edits applied, sections hidden from the share link left out). Nothing is summarised by
// a model on the way, so a slide cannot say what the brief does not.
//
// Image models garble dense text, so each slide has a word budget and the builder trims to it
// (fewer bullets, then fewer rows and details) rather than hoping the renderer copes. After rendering,
// the server reads the image back and compares it with this text (the proofread).

import { BRIEF_SECTION_LABELS, parseEditText, type BriefBullet, type BriefSection, type BriefSectionKey, type ExecutiveBrief } from "./executiveBrief";

export type BriefSlideVariant = "highlights" | "full";

export const BRIEF_SLIDE_VARIANTS: Record<BriefSlideVariant, { label: string; description: string }> = {
  highlights: { label: "Highlights", description: "1 concise slide: every section's headline, the top channels and the measurement." },
  full: { label: "Full summary", description: "2 slides: strategy (understanding, POV, audience), then media and measurement." },
};

/** Past these the renderer starts dropping and misspelling words. */
export const SLIDE_WORD_BUDGET: Record<BriefSlideVariant, number> = { highlights: 150, full: 240 };

export type BriefSlideLayout = "highlights" | "strategy" | "execution";

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

function header(title: string, context: BriefSlideContext): string[] {
  const subtitle = [context.advertiserName, context.geography].filter(Boolean).join(" · ");
  const lines = [`SLIDE TITLE: ${title}`];
  if (subtitle) lines.push(`SUBTITLE: ${subtitle}`);
  const glance = (context.glance || []).map((f) => `${f.label}: ${f.value}`);
  if (glance.length) lines.push(`AT A GLANCE: ${glance.join(" | ")}`);
  return lines;
}

function channelRows(section: EffectiveSection, context: BriefSlideContext, limit: number, withRole: boolean) {
  return [...(section.structured?.channels || [])]
    .map((c) => ({ ...c, live: context.livePercents?.[c.channelId] ?? c.allocationPercent }))
    .sort((a, b) => b.live - a.live)
    .slice(0, limit)
    .map((c) => `  - ${c.channelName} | ${percent(c.live)} | ${c.funnelRole}${withRole && c.role ? ` | ${trimWords(c.role, 30)}` : ""}`);
}

function measurementRows(section: EffectiveSection, limit: number, withProves: boolean) {
  return [...(section.structured?.measurement || [])]
    .sort((a, b) => Number(b.advanced) - Number(a.advanced))
    .slice(0, limit)
    .map((m) => `  - ${m.capability}${m.advanced ? ` ${IMPACT_TAG}` : ""}${withProves && m.proves ? ` | ${trimWords(m.proves, 30)}` : ""}${withProves && m.kpi ? ` | KPI: ${m.kpi}` : ""}`);
}

/**
 * Printed as a tag on measurement that proves business impact. It is real slide text, not a
 * layout marker: a marker the proofread is told to ignore is one the renderer can misplace
 * unnoticed (a live render put one on a capability that has no such claim).
 */
export const IMPACT_TAG = "(Business impact)";

// Each list is one fitting level, most detailed first.
const HIGHLIGHT_LEVELS = [{ channels: 4, measurement: 4 }, { channels: 3, measurement: 3 }, { channels: 3, measurement: 0 }];
const STRATEGY_LEVELS = [
  { bullets: 3, matches: 3 }, { bullets: 2, matches: 3 }, { bullets: 2, matches: 2 }, { bullets: 1, matches: 2 }, { bullets: 1, matches: 0 },
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
    if (section.key === "media") lines.push(...channelRows(section, context, lv.channels, false));
    if (section.key === "measurement") lines.push(...measurementRows(section, lv.measurement, false));
  }
  return lines.join("\n");
}

function strategySlide(sections: EffectiveSection[], context: BriefSlideContext, level: number): string {
  const lv = STRATEGY_LEVELS[level];
  const lines = header("Executive Summary: Strategy", context);
  for (const section of sections) {
    lines.push("", `SECTION: ${section.title} (${section.subtitle})`);
    if (section.headline) lines.push(`HEADLINE: ${trimWords(section.headline, 30)}`);
    for (const b of section.bullets.slice(0, lv.bullets)) lines.push(bulletLine(b));
    const matches = (section.structured?.audienceMatches || []).slice(0, lv.matches);
    if (matches.length) {
      lines.push("WHO → HOW WE REACH THEM:");
      for (const m of matches) lines.push(`  - ${m.audience} → ${m.reachedWith.slice(0, 3).join(", ")}`);
    }
  }
  return lines.join("\n");
}

function executionSlide(sections: EffectiveSection[], context: BriefSlideContext, level: number): string {
  const lv = EXECUTION_LEVELS[level];
  const hasMeasurement = sections.some((s) => s.key === "measurement");
  const lines = header(hasMeasurement ? "Executive Summary: Media & Measurement" : "Executive Summary: Media Strategy", context);
  for (const section of sections) {
    lines.push("", `SECTION: ${section.title} (${section.subtitle})`);
    if (section.headline) lines.push(`HEADLINE: ${trimWords(section.headline, 30)}`);
    // A hand-edited section has no rows; its bullets are the content, so they all stay.
    for (const b of section.bullets.slice(0, section.structured ? lv.bullets : 6)) lines.push(bulletLine(b));
    if (section.key === "media") {
      const rows = channelRows(section, context, 10, lv.roles);
      if (rows.length) lines.push(`CHANNEL | ALLOCATION | FUNNEL ROLE${lv.roles ? " | ROLE" : ""}`, ...rows);
    }
    if (section.key === "measurement") {
      const rows = measurementRows(section, 6, lv.proves);
      if (rows.length) lines.push(`MEASUREMENT${lv.proves ? " | WHAT IT PROVES | KPI" : ""}`, ...rows);
    }
  }
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
  if (variant === "highlights") {
    return [{ id: "highlights", label: "Highlights", layout: "highlights", text: fit((l) => highlightsSlide(sections, context, l), budget, HIGHLIGHT_LEVELS.length) }];
  }
  const strategy = sections.filter((s) => s.key === "understanding" || s.key === "strategicPov" || s.key === "audience");
  const execution = sections.filter((s) => s.key === "media" || s.key === "measurement");
  const slides: BriefSlideSpec[] = [];
  if (strategy.length) slides.push({ id: "strategy", label: "1. Strategy", layout: "strategy", text: fit((l) => strategySlide(strategy, context, l), budget, STRATEGY_LEVELS.length) });
  if (execution.length) {
    slides.push({
      id: "execution",
      label: `${slides.length + 1}. ${execution.some((s) => s.key === "measurement") ? "Media & Measurement" : "Media"}`,
      layout: "execution",
      text: fit((l) => executionSlide(execution, context, l), budget, EXECUTION_LEVELS.length),
    });
  }
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
  highlights: "Title and subtitle top-left. Beneath them, a slim row of 'AT A GLANCE' metric tiles. Then one card per section in a balanced grid (for five sections: three cards on the first row, two wider cards on the second). Each card: the section name as an eyebrow label, then its headline. The Media Strategy card lists its channels as compact rows with the allocation % and a thin proportional bar. The Measurement Strategy card shows its capabilities as chips, with a capability ending in (Business impact) shown as a lime-highlighted chip that carries that tag.",
  strategy: "Title and subtitle top-left, then a slim row of 'AT A GLANCE' metric tiles. Below, three equal columns, one per section: eyebrow label, headline, then the bullets. The Audience Strategy column ends with the 'who → how we reach them' lines as small audience-to-data pairings.",
  execution: "Title and subtitle top-left, then a slim row of 'AT A GLANCE' metric tiles. Below, the media section on the left (about 60% width): its headline and bullets, then the channel rows as a clean table with a proportional allocation bar and a funnel-role pill per channel. On the right (about 40%): the measurement section as stacked cards, a capability ending in (Business impact) highlighted in lime with that tag. With no measurement section, the channel table spans the full width.",
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
- The labels "SLIDE TITLE:", "SUBTITLE:", "SECTION:" and "HEADLINE:" are structure markers: use them to lay out the slide, do not print them. "AT A GLANCE" may be printed as the label of the metric strip. Render table rows ("A | B | C") as table cells without the "|" characters.
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

export function buildGoogleSlidesPrompt(slides: BriefSlideSpec[], options: { advertiserName?: string; style?: BriefSlideStyle } = {}): string {
  const count = slides.length;
  const lines = [
    `Create ${count === 1 ? "one slide" : `${count} slides`} for a client presentation: the executive summary of a media plan${options.advertiserName ? ` for ${options.advertiserName}` : ""}.`,
    "",
    "CONTENT RULES",
    "- Use the text below exactly as written. Do not rewrite, shorten, summarize, reorder or add content, and keep every number and percentage exactly as given.",
    `- ${count === 1 ? "Put everything on a single slide." : "Make one slide per SLIDE block below, in order."}`,
    "- The labels SLIDE TITLE, SUBTITLE, SECTION and HEADLINE describe the structure; don't print the labels themselves. Show rows written as \"A | B | C\" as a table.",
    `- Show \"${IMPACT_TAG}\" as a highlighted tag only on the items that carry it; don't add badges or tags the content doesn't state.`,
    "- Do not add a logo, footer, page number, confidentiality notice or images of people.",
    "",
    "DESIGN (Digital Remedy brand)",
    `- Font: ${BRAND_TYPE}`,
    `- Colors: ${PALETTES[options.style || "corporate_light"]}`,
    "- Generous whitespace, rounded cards with light borders, a clear grid, and text large enough to read when projected. Simple line icons beside section labels are fine.",
  ];
  slides.forEach((slide, i) => {
    lines.push("", `SLIDE ${i + 1} (${slide.label.replace(/^\d+\.\s*/, "")})`, `Layout: ${LAYOUTS[slide.layout]}`, "Content:", slide.text);
  });
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

Ignore: the structure markers (SLIDE TITLE, SUBTITLE, SECTION, HEADLINE, the "AT A GLANCE" label, "|"), capitalization, punctuation (including brackets and colons around a label), bullet symbols, line breaks, and layout choices. If the slide matches, return no issues.`;

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
