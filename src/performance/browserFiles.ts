// Turns the files a planner drops into what the upload sends. Summarised exports go as text;
// touch-level exports are summarised here (in a Web Worker) and only the summary goes, since
// their rows are household-level and far larger than a request can carry. Spreadsheets become
// one CSV per sheet, so a workbook of report tabs reads like the separate exports.

import { CsvReader, detectDelimiter } from "./csv";
import { fileChunks } from "./fileChunks";
import { MAX_REPORT_TEXT_CHARS } from "./constants";
import { readTouchReportStream, type Report } from "./reports";
import { detectTouchColumns, type TouchSummary } from "./touches";

export type PreparedFile =
  | { fileName: string; sizeBytes: number; text: string }
  | { fileName: string; sizeBytes: number; touchSummary: TouchSummary; fingerprint: string };

export interface PrepareResult {
  files: PreparedFile[];
  errors: string[];
}

/** Workbooks are read whole; past this a sheet export is the better route. */
const MAX_WORKBOOK_BYTES = 25_000_000;
const HEADER_PEEK_BYTES = 64 * 1024;

export async function prepareFiles(files: File[], onProgress?: (fileName: string, fraction: number) => void): Promise<PrepareResult> {
  const out: PrepareResult = { files: [], errors: [] };
  for (const file of files) {
    try {
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        out.files.push(...(await workbookSheets(file, out.errors)));
      } else if (await isTouchFile(file)) {
        const report = await summariseTouches(file, (fraction) => onProgress?.(file.name, fraction));
        if (report.kind !== "touches") out.errors.push(`${file.name}: ${report.kind === "unread" ? report.reason : "not a touch-level export"}`);
        else out.files.push({ fileName: file.name, sizeBytes: file.size, touchSummary: report.summary, fingerprint: `${file.name}:${file.size}:${file.lastModified}` });
      } else if (file.size > MAX_REPORT_TEXT_CHARS) {
        out.errors.push(`${file.name} is ${Math.round(file.size / 1_000_000)}MB, too large for a summarised report. Export it split by date or dimension.`);
      } else {
        out.files.push({ fileName: file.name, sizeBytes: file.size, text: await file.text() });
      }
    } catch (err: any) {
      out.errors.push(`${file.name}: ${err?.message || "could not be read"}`);
    }
    onProgress?.(file.name, 1);
  }
  return out;
}

/** The header row decides, read from the start of the file without loading the rest. */
async function isTouchFile(file: File): Promise<boolean> {
  const head = await file.slice(0, HEADER_PEEK_BYTES).text();
  const [headers] = new CsvReader(detectDelimiter(head)).push(head);
  return Boolean(headers && detectTouchColumns(headers.map((h) => h.trim())));
}

function summariseTouches(file: File, onProgress: (fraction: number) => void): Promise<Report> {
  if (typeof Worker === "undefined") return readTouchReportStream(file.name, fileChunks(file, onProgress));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./touchWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ type: string; fraction?: number; report?: Report; error?: string }>) => {
      const message = event.data;
      if (message.type === "progress") onProgress(message.fraction ?? 0);
      if (message.type === "done" || message.type === "error") {
        worker.terminate();
        if (message.type === "done") resolve(message.report!);
        else reject(new Error(message.error));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "The file could not be summarised."));
    };
    worker.postMessage({ file });
  });
}

async function workbookSheets(file: File, errors: string[]): Promise<PreparedFile[]> {
  if (file.size > MAX_WORKBOOK_BYTES) {
    errors.push(`${file.name} is too large to read as a workbook. Export its sheets as CSV.`);
    return [];
  }
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const base = file.name.replace(/\.(xlsx|xls)$/i, "");
  const sheets: PreparedFile[] = [];
  for (const sheetName of workbook.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName], { blankrows: false });
    if (!csv.trim()) continue;
    const fileName = workbook.SheetNames.length > 1 ? `${base} - ${sheetName}.csv` : `${base}.csv`;
    if (csv.length > MAX_REPORT_TEXT_CHARS) {
      errors.push(`${fileName} is too large for a summarised report.`);
      continue;
    }
    sheets.push({ fileName, sizeBytes: csv.length, text: csv });
  }
  return sheets;
}
