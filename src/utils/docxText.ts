// Text from an uploaded Word (.docx) file, for the upload preview and the brief text.
// A .docx is a zip of XML parts, so reading it as text shows the zip's raw bytes. SheetJS
// already ships a zip reader (CFB), which avoids adding a dependency for this.

import * as XLSX from "xlsx";

// The browser (ESM) build exports CFB by name; under Node's CommonJS interop (tests) it is only
// on the default export.
const CFB: typeof XLSX.CFB = (XLSX as any).CFB ?? (XLSX as any).default?.CFB;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, code: string) => {
    if (code[0] !== "#") return ENTITIES[code.toLowerCase()] ?? whole;
    const point = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(point) ? String.fromCodePoint(point) : whole;
  });
}

/** One paragraph's text: its runs, with Word's tabs and line breaks kept. */
function paragraphText(xml: string): string {
  let text = "";
  for (const match of xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br|cr)\b[^>]*\/>/g)) {
    if (match[1] !== undefined) text += decodeXml(match[1]);
    else text += match[2] === "tab" ? "\t" : "\n";
  }
  return text.trim();
}

/**
 * The document body as lines: one per paragraph, and one per table row with its cells joined
 * by " | ", the way spreadsheet rows are flattened for the brief. Empty paragraphs are dropped.
 */
export function docxLines(data: Uint8Array): string[] {
  let container: any;
  try {
    container = CFB.read(data, { type: "array" });
  } catch {
    throw new Error("This file is not a readable Word document.");
  }
  // SheetJS roots zip entries at "Root Entry/", so the path is found from the root.
  const entry: any = CFB.find(container, "/word/document.xml");
  if (!entry?.content) throw new Error("This Word document has no readable body.");
  const xml = new TextDecoder("utf-8").decode(entry.content as Uint8Array);
  const body = xml.match(/<w:body\b[^>]*>([\s\S]*)<\/w:body>/)?.[1] ?? xml;

  const lines: string[] = [];
  // Tables are taken whole so their paragraphs become cells, not lines of their own.
  for (const block of body.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[^>]*\/>|<w:p\b[\s\S]*?<\/w:p>/g)) {
    const xmlBlock = block[0];
    if (xmlBlock.startsWith("<w:tbl")) {
      for (const row of xmlBlock.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)) {
        const cells = Array.from(row[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g), (cell) =>
          Array.from(cell[0].matchAll(/<w:p\b[\s\S]*?<\/w:p>/g), (p) => paragraphText(p[0])).filter(Boolean).join(" "),
        );
        if (cells.some(Boolean)) lines.push(cells.join(" | "));
      }
    } else {
      const text = paragraphText(xmlBlock);
      if (text) lines.push(...text.split("\n").map((line) => line.trim()).filter(Boolean));
    }
  }
  return lines;
}
