// Plan text fields (intro, publisher insights, channel rationale...) are plain text that every
// export reads as-is, so they carry no markdown. The one structure they support is a bullet
// list: one bullet per line, starting "- ", optionally led by a short "Label: ".

export type PlanTextBullet = { label?: string; text: string };
export type PlanTextBlock = { type: "paragraph"; text: string } | { type: "list"; items: PlanTextBullet[] };

const BULLET_LINE = /^\s*(?:[-*•+]|\d+[.)])\s+/;

/**
 * Coerces model-written text into the plan's format: splits bullets the model ran together on
 * one line (" * **Label**: ..."), writes every bullet as "- ", and strips markdown emphasis.
 * A hyphen mid-line is left alone; it is far more often a dash than a bullet.
 */
export function normalizePlanText(value: string): string {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+[*•][ \t]+(?=[^\s\d])/g, "\n- ")
    .split("\n")
    .map((line) => line.replace(BULLET_LINE, "- "))
    .join("\n")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?![\w*])/g, "$1$2")
    .replace(/\*\*/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// A bullet's lead-in label: short, and a name rather than a sentence.
const LABEL = /^([^:.!?]{2,90}):\s+(\S[\s\S]*)$/;

function bullet(line: string): PlanTextBullet {
  const text = line.replace(BULLET_LINE, "").trim();
  const match = text.match(LABEL);
  return match && match[1].trim().split(/\s+/).length <= 12 ? { label: match[1].trim(), text: match[2].trim() } : { text };
}

/** Splits plan text into paragraphs and bullet lists. Saved text written before normalization is normalized first. */
export function parsePlanText(value: string): PlanTextBlock[] {
  const blocks: PlanTextBlock[] = [];
  for (const line of normalizePlanText(value).split("\n")) {
    if (!line.trim()) continue;
    const last = blocks[blocks.length - 1];
    if (BULLET_LINE.test(line)) {
      if (last?.type === "list") last.items.push(bullet(line));
      else blocks.push({ type: "list", items: [bullet(line)] });
    } else {
      blocks.push({ type: "paragraph", text: line.trim() });
    }
  }
  return blocks;
}

export const hasPlanTextList = (value: string) => parsePlanText(value).some((block) => block.type === "list");
