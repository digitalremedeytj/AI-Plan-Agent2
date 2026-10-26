// An RFP that arrives as several files: the RFP itself plus the attachments it points to
// ("target only the ports in Attachment B"). The server reads the RFP and its attachments in
// one call so those references resolve; media-plan spreadsheets still go through the placement
// extractor one file at a time. This module holds the parts both sides share: what each file is,
// the brief text built from the analysis, and the clean-up of what the model returned.

import type {
  PackageFileRole,
  RfpAnalysis,
  RfpConflictField,
  RfpFieldConflict,
  RfpPackageFile,
  RfpReferencedAttachment,
} from "../types";
import { extractGeoFromSpreadsheetRows } from "../utils/geoReference";

export const MAX_PACKAGE_FILES = 5;
// Each file is sent to OpenAI whole; the whole package has to read inside the parse request.
export const MAX_PACKAGE_FILE_BYTES = 20 * 1024 * 1024;

export const PACKAGE_ROLE_LABELS: Record<PackageFileRole, string> = {
  rfp: "RFP",
  media_plan: "Media plan",
  geo_list: "Location list",
  reference: "Attachment",
};

const DOCUMENT_EXTENSIONS = new Set(["pdf", "doc", "docx", "rtf", "txt"]);
const SPREADSHEET_EXTENSIONS = new Set(["xlsx", "xls", "csv"]);
export const PACKAGE_ACCEPT = ".pdf,.doc,.docx,.rtf,.txt,.csv,.xlsx,.xls";

export function fileExtension(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

export function isPackageFileType(name: string): boolean {
  const ext = fileExtension(name);
  return DOCUMENT_EXTENSIONS.has(ext) || SPREADSHEET_EXTENSIONS.has(ext);
}

/**
 * A first guess at each file's role, which the planner can change. One document is the RFP
 * (the one named like an RFP or brief, else the first); spreadsheets are location lists or
 * media plans by name, and a spreadsheet with no RFP beside it is a media plan, as a single
 * spreadsheet upload always was.
 */
export function guessFileRoles(names: string[]): PackageFileRole[] {
  // Word boundaries, so "Performance Report" is not a port list; _ and - count as spaces.
  const words = (name: string) => name.replace(/[_\-.]+/g, " ");
  const documents = names.map((name, index) => ({ name, index })).filter(({ name }) => DOCUMENT_EXTENSIONS.has(fileExtension(name)));
  const primary = documents.find(({ name }) => /\b(rfps?|rfis?|brief|request for proposal)\b/i.test(words(name))) ?? documents[0];
  return names.map((name, index) => {
    if (primary?.index === index) return "rfp";
    if (DOCUMENT_EXTENSIONS.has(fileExtension(name))) return "reference";
    if (/\b(zips?|zip codes?|postal|geos?|locations?|markets?|dmas?|ports?|stores?|venues?|address(es)?|city|cities|states?)\b/i.test(words(name))) return "geo_list";
    if (/\b(plans?|media|flowchart|schedule|placements?|buy|budget)\b/i.test(words(name)) || !primary) return "media_plan";
    return "reference";
  });
}

/** The package's name for the brief and saved plan, e.g. "Hyster RFP.pdf + 2 attachments". */
export function packageLabel(files: RfpPackageFile[]): string {
  if (files.length === 0) return "";
  const primary = files.find((file) => file.role === "rfp") ?? files[0];
  const others = files.length - 1;
  return others === 0 ? primary.name : `${primary.name} + ${others} attachment${others === 1 ? "" : "s"}`;
}

// The model sees each file under the sandbox's name for it (/mnt/data/file-<id>-My_File.csv),
// so names are compared with the path, the id prefix, case and punctuation taken out.
function nameKey(name: string): string {
  return name
    .replace(/^.*[\\/]/, "")
    .replace(/^file-[A-Za-z0-9]+-/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** The uploaded file a model-reported name refers to, or null when it is none of them. */
export function matchUploadedName(reported: unknown, uploadedNames: string[]): string | null {
  if (typeof reported !== "string" || !reported.trim()) return null;
  const key = nameKey(reported);
  if (!key) return null;
  return uploadedNames.find((name) => nameKey(name) === key) ?? null;
}

const CONFLICT_FIELDS: RfpConflictField[] = ["advertiserName", "websiteUrl", "budget", "flightDates", "submissionDueDate"];
const text = (value: unknown) => (typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "");
const strings = (value: unknown) => (Array.isArray(value) ? value.map(text).filter(Boolean) : []);

/**
 * The model's RFP JSON as the app stores it, or null when it is not an RFP reading. File names
 * the model reports are kept only when they are one of the uploaded files: a source, a found
 * attachment or a conflict naming a file nobody uploaded is the model's guess, not a fact.
 */
export function normalizeRfpAnalysis(parsed: any, packageFiles: RfpPackageFile[], placementCount = 0): RfpAnalysis | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (!parsed.isRfpDocument && !parsed.rfpSummary && !parsed.digitalRemedyCapabilityMatches) return null;
  const names = packageFiles.map((file) => file.name);
  const multiFile = packageFiles.length > 1;

  const analysis: RfpAnalysis = {
    isRfpDocument: parsed.isRfpDocument ?? true,
    hasExplicitPlacements: parsed.hasExplicitPlacements ?? placementCount > 0,
    rfpSummary: text(parsed.rfpSummary),
    rfpAsksAndQuestions: strings(parsed.rfpAsksAndQuestions),
    digitalRemedyCapabilityMatches: (Array.isArray(parsed.digitalRemedyCapabilityMatches) ? parsed.digitalRemedyCapabilityMatches : [])
      .filter((match: any) => match && typeof match === "object")
      .map((match: any) => {
        const sourceFile = multiFile ? matchUploadedName(match.sourceFile, names) : null;
        return {
          rfpAsk: text(match.rfpAsk),
          digitalRemedySolution: text(match.digitalRemedySolution),
          capabilityDetails: text(match.capabilityDetails),
          isSupported: match.isSupported !== false,
          ...(sourceFile ? { sourceFile } : {}),
        };
      }),
    extractedMetadata: parsed.extractedMetadata && typeof parsed.extractedMetadata === "object" ? parsed.extractedMetadata : {},
  };
  if (!multiFile) return analysis;

  analysis.packageFiles = packageFiles;

  const sources: Record<string, string> = {};
  for (const [field, reported] of Object.entries(parsed.metadataSources && typeof parsed.metadataSources === "object" ? parsed.metadataSources : {})) {
    const file = matchUploadedName(reported, names);
    if (file) sources[field] = file;
  }
  if (Object.keys(sources).length > 0) analysis.metadataSources = sources;

  const seen = new Set<string>();
  const attachments: RfpReferencedAttachment[] = [];
  for (const item of Array.isArray(parsed.referencedAttachments) ? parsed.referencedAttachments : []) {
    const name = text(item?.name);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    attachments.push({ name, foundInFile: matchUploadedName(item?.foundInFile, names) });
  }
  analysis.referencedAttachments = attachments;

  const conflicts: RfpFieldConflict[] = [];
  for (const item of Array.isArray(parsed.conflicts) ? parsed.conflicts : []) {
    if (!CONFLICT_FIELDS.includes(item?.field)) continue;
    const values = (Array.isArray(item.values) ? item.values : [])
      .map((entry: any) => ({ value: text(entry?.value), sourceFile: matchUploadedName(entry?.sourceFile, names) }))
      .filter((entry: { value: string; sourceFile: string | null }): entry is { value: string; sourceFile: string } => Boolean(entry.value && entry.sourceFile));
    // A conflict is two different values; the same value stated twice is agreement.
    if (new Set(values.map((entry) => entry.value.toLowerCase())).size < 2) continue;
    conflicts.push({ field: item.field, values });
  }
  analysis.conflicts = conflicts;
  return analysis;
}

export function missingAttachments(analysis: RfpAnalysis | null | undefined): RfpReferencedAttachment[] {
  return (analysis?.referencedAttachments ?? []).filter((attachment) => !attachment.foundInFile);
}

const BRIEF_TEXT_CHARS = 1500;
const BRIEF_LIST_ITEMS = 25;

function listLine(label: string, items: string[]): string {
  if (items.length === 0) return "";
  const shown = items.slice(0, BRIEF_LIST_ITEMS).join("; ");
  const more = items.length > BRIEF_LIST_ITEMS ? `; and ${items.length - BRIEF_LIST_ITEMS} more` : "";
  return `${label}: ${shown}${more}`;
}

/**
 * The audience description an uploaded brief sends to generation (the Brief of Record reads it
 * first). An RFP reading gives its summary, audiences, locations and KPIs; raw file text is only
 * the fallback, since for a document it is mostly formatting and a long attachment would crowd
 * the RFP out of the 1,500 characters the server keeps.
 */
export function uploadBriefText(label: string, analysis: RfpAnalysis | null | undefined, rawText: string): string {
  const name = label || "Uploaded File";
  const meta = analysis?.extractedMetadata ?? {};
  const lines = analysis
    ? [
        analysis.rfpSummary ? `Summary: ${analysis.rfpSummary}` : "",
        listLine("Target audiences", strings(meta.targetAudiences)),
        listLine("Geographies", strings(meta.geographies)),
        listLine("KPIs", strings(meta.kpis)),
        text(meta.flightDates) ? `Flight: ${text(meta.flightDates)}` : "",
      ].filter(Boolean)
    : [];
  if (lines.length === 0) return `[Media Plan / RFP: ${name}]\n\n${rawText.slice(0, BRIEF_TEXT_CHARS)}`;
  return `[RFP: ${name}]\n\n${lines.join("\n")}`.slice(0, BRIEF_TEXT_CHARS);
}

const PLANNER_NOTES_LABEL = "\n\nPlanner notes: ";
// The upload's text keeps at least this much when notes are long, so a note cannot push the RFP
// out of the brief entirely; short upload text leaves its unused room to the notes.
const BRIEF_UPLOAD_MIN_CHARS = 750;

/** How many characters of the planner's own notes fit beside this upload's brief text. */
export function plannerNotesLimit(uploadText: string): number {
  return BRIEF_TEXT_CHARS - PLANNER_NOTES_LABEL.length - Math.min(uploadText.length, BRIEF_UPLOAD_MIN_CHARS);
}

/**
 * The upload's brief text with what the planner typed beside it. Both share the 1,500 characters
 * the server keeps, so the notes are fitted here rather than appended past the cap and cut off.
 */
export function uploadBriefWithNotes(uploadText: string, notes: string): string {
  const trimmed = notes.trim();
  if (!trimmed) return uploadText;
  const kept = trimmed.slice(0, plannerNotesLimit(uploadText));
  const upload = uploadText.slice(0, BRIEF_TEXT_CHARS - PLANNER_NOTES_LABEL.length - kept.length).trimEnd();
  return `${upload}${PLANNER_NOTES_LABEL}${kept}`;
}

/**
 * States or DMAs a location list could be targeted at, whichever matches more of its rows, or
 * null when it matches neither (a port or venue list without a state column, say). The planner
 * applies it; it is never applied on its own, since it replaces the brief's geography.
 */
export function suggestGeoTargets(rows: any[][]): { type: "State" | "DMA"; targets: string[]; detectedColumnName?: string } | null {
  // Without a column headed for it the matcher guesses from any cell ("CA" reads as the Los
  // Angeles DMA), which is fine for a planner's own geo upload but not for a suggestion.
  const headed = (type: "State" | "DMA") => {
    const result = extractGeoFromSpreadsheetRows(rows, type);
    return result.detectedColumnName && !/^Column \d+$/.test(result.detectedColumnName) && result.valid.length > 0 ? result : null;
  };
  const states = headed("State");
  const dmas = headed("DMA");
  const best = dmas && dmas.valid.length > (states?.valid.length ?? 0) ? { type: "DMA" as const, result: dmas } : states ? { type: "State" as const, result: states } : null;
  if (!best) return null;
  return { type: best.type, targets: best.result.valid, detectedColumnName: best.result.detectedColumnName };
}
