/**
 * The one-line "key finding" the live console (and the saved generation log) shows when a research
 * dossier completes. Dossiers are free-form markdown that usually open with a restatement of the
 * brief (Advertiser, Target Audience, Business Model...) and carry ASCII diagrams and tables, so
 * taking the first bullet showed the brief back to the planner, with stray markdown. This skips
 * that preamble and picks the first real sentence that carries a figure.
 */

const MAX_BLURB_CHARS = 300;
const MIN_FINDING_CHARS = 60;

/** Bold labels that restate the brief rather than report research. */
export const CONTEXT_LABEL = /^(advertiser|brand|client|target audience|primary target audience|audience( definition| profile)?|product( portfolio)?|products|business model|(core )?campaign( objective| scope| focus)?|scope|objective|kpis?|geography|website|url|date|prepared for)\b/i;

function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Prose lines only: no headings, fenced blocks, tables, diagrams or rules. */
function proseLines(text: string): string[] {
  const lines: string[] = [];
  let inFence = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !line || line.startsWith("#") || line.startsWith("|") || line.startsWith(">")) continue;
    if (/^[-=_*]{3,}$/.test(line) || /[─│┌┐└┘├┤┬┴┼═║▼▲►◄]|^[+|]/.test(line)) continue;
    lines.push(line);
  }
  return lines;
}

/** A line without its bullet and bold label, or null when the label says it restates the brief. */
function findingText(line: string): string | null {
  const body = line.replace(/^([-*•]|\d+[.)])\s+/, "");
  const labelled = body.match(/^\*\*([^*]{1,80}?):?\*\*:?\s*(.*)$/);
  if (!labelled) return stripMarkdown(body);
  const [, label, rest] = labelled;
  if (CONTEXT_LABEL.test(label.trim())) return null;
  const remainder = stripMarkdown(rest);
  // A remainder that reads as a sentence is the finding itself. One that opens with a figure
  // ("30%–33% (largest share...)") or is short only makes sense with its label ("Millennials").
  const standsAlone = remainder.length >= MIN_FINDING_CHARS && !/^[\d~$<>≈]/.test(remainder);
  return standsAlone ? remainder : stripMarkdown(`${label.replace(/:$/, "")}: ${rest}`);
}

/** Splits on sentence ends, but not after an abbreviation such as "U.S." or "e.g.". */
function sentences(text: string): string[] {
  return text.split(/(?<!\b(?:[A-Za-z]\.){2,})(?<!\b(?:vs|etc|Inc|Corp|Co|Dr|Mr|Ms|No|approx)\.)(?<=[.!?])\s+(?=[A-Z"“(])/);
}

function clip(text: string): string {
  return text.length > MAX_BLURB_CHARS ? `${text.slice(0, MAX_BLURB_CHARS - 1).trimEnd()}…` : text;
}

export function extractFindingBlurb(text: string, label: string): string {
  const fallback = `Completed deep-dive search for ${label}`;
  if (!text) return fallback;
  const findings = proseLines(text).map(findingText).filter((f): f is string => Boolean(f));
  const hasFigure = (s: string) => /\d/.test(s);

  // Prefer a full sentence with a figure in it; a bare "label: 9.5%" line is a last resort.
  for (const finding of findings) {
    const sentence = sentences(finding).find((s) => hasFigure(s) && s.length >= MIN_FINDING_CHARS);
    if (sentence) return clip(sentence);
  }
  const anyFigure = findings.find(hasFigure);
  if (anyFigure) return clip(anyFigure);
  const prose = findings.find((f) => f.length >= MIN_FINDING_CHARS);
  return prose ? clip(sentences(prose)[0]) : fallback;
}
