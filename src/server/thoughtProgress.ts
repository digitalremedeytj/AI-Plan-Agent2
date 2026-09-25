/**
 * Turns a reasoning model's streamed thought summaries into short progress lines for the live
 * console, so a long model call shows what it is weighing instead of "Still working...".
 *
 * Both OpenAI and Gemini write summaries as markdown sections that open with a bold headline
 * ("**Checking budget alignment**\n\nI'm comparing..."). The headline is the progress line; a
 * section without one falls back to its first sentence.
 */

export type ThoughtListener = (text: string) => void;

const MAX_LINE_CHARS = 140;
const HEADLINE = /\*\*([^*\n]{3,200})\*\*/g;
/**
 * Headlines about the task rather than the plan ("Defining the Output", "Validating Schema
 * Accuracy"). Gemini writes these often; they tell the planner nothing, so they are dropped.
 */
const ABOUT_THE_TASK = /\b(json|schema|output|format|formatting|structure|structuring|fields?|prompt|instructions?|task|request|focus)\b/i;

function tidy(text: string): string {
  const line = text.replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim().replace(/[.:;,\s]+$/, "");
  return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS - 1).trimEnd()}…` : line;
}

function firstSentence(text: string): string {
  const body = text.replace(HEADLINE, " ").trim();
  return body.match(/^[\s\S]*?[.!?](\s|$)/)?.[0] ?? body;
}

/**
 * Accumulates one stream of summary text and reports each headline once, as soon as it has been
 * fully streamed. `end()` closes a section that never produced a headline.
 */
export class ThoughtHeadlines {
  private buffer = "";
  private scanned = 0;
  private sawHeadline = false;

  constructor(private readonly onLine: (line: string) => void) {}

  push(delta: string): void {
    if (!delta) return;
    this.buffer += delta;
    HEADLINE.lastIndex = this.scanned;
    let match: RegExpExecArray | null;
    while ((match = HEADLINE.exec(this.buffer))) {
      this.scanned = HEADLINE.lastIndex;
      this.sawHeadline = true;
      this.report(tidy(match[1]));
    }
  }

  end(): void {
    if (!this.sawHeadline) this.report(tidy(firstSentence(this.buffer)));
    this.buffer = "";
    this.scanned = 0;
    this.sawHeadline = false;
  }

  private report(line: string): void {
    if (line && !ABOUT_THE_TASK.test(line)) this.onLine(line);
  }
}

/**
 * Rate-limits progress lines for the console: at most one per `minIntervalMs`, skipping repeats.
 * A line that arrives inside the window is held and sent when the window ends, replaced by any
 * newer line meanwhile, so the console shows the model's latest focus, not a backlog. Call
 * `stop()` when the stage finishes: it drops any held line and ignores the rest, so nothing lands
 * after the stage's own status, even from a call a timeout abandoned that is still streaming.
 */
export function throttledProgress(
  send: (line: string) => void,
  minIntervalMs = 12000,
): { report: (line: string) => void; stop: () => void } {
  let lastSentAt = 0;
  let lastLine = "";
  let pending: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const flush = () => {
    timer = null;
    if (pending === null) return;
    const line = pending;
    pending = null;
    if (line === lastLine) return;
    lastLine = line;
    lastSentAt = Date.now();
    send(line);
  };

  return {
    report(line: string) {
      if (stopped || !line || line === lastLine) return;
      pending = line;
      const wait = minIntervalMs - (Date.now() - lastSentAt);
      if (wait <= 0) flush();
      else if (!timer) timer = setTimeout(flush, wait);
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}

/** An abort signal that fires with a timeout error once `timeoutMs` passes. SDK timeouts stop at the response headers, not the end of a stream. */
export function streamDeadline(timeoutMs: number, label: string): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s.`)),
    timeoutMs,
  );
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}
