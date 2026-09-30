// Past campaign performance: read a report set, reconcile it, and describe it for ScoutAI.
// Everything here is plain TypeScript with no I/O, so it runs on the server and, for touch-level
// files too large to upload, in the browser.

export { readReport, readTouchReportStream, type Report } from "./reports";
export { analyzeCampaign, type AnalyzeOptions, type CampaignAnalysis, type Warning } from "./campaign";
export { renderDigest, DEFAULT_DIGEST_CHARS } from "./digest";

import { analyzeCampaign, type AnalyzeOptions } from "./campaign";
import { readReport } from "./reports";

/** A report set already in memory (the summarised exports are a few KB each). */
export function analyzeReportFiles(files: Array<{ name: string; text: string }>, options?: AnalyzeOptions) {
  return analyzeCampaign(files.map((f) => readReport(f.name, f.text)), options);
}
