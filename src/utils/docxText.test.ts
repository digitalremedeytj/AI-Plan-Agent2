import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { docxLines } from "./docxText";

const CFB: typeof XLSX.CFB = (XLSX as any).CFB ?? (XLSX as any).default?.CFB;

// A minimal .docx: a zip holding word/document.xml, built the way Word lays out its body.
function docx(body: string): Uint8Array {
  const container = CFB.utils.cfb_new();
  const xml = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`;
  CFB.utils.cfb_add(container, "/word/document.xml", new TextEncoder().encode(xml));
  return new Uint8Array(CFB.write(container, { fileType: "zip", type: "array" }) as any);
}
const p = (...runs: string[]) => `<w:p><w:pPr><w:spacing w:after="240"/></w:pPr>${runs.map((r) => `<w:r><w:t xml:space="preserve">${r}</w:t></w:r>`).join("")}</w:p>`;

test("a Word brief reads as its text, not the zip's raw bytes", () => {
  const lines = docxLines(docx(p("Advertiser: ", "Acme &amp; Sons — Café Line") + "<w:p/>" + p("Budget: $250,000")));

  assert.deepEqual(lines, ["Advertiser: Acme & Sons — Café Line", "Budget: $250,000"]);
});

test("a table in a Word brief keeps each row together, cells separated", () => {
  const row = (...cells: string[]) => `<w:tr>${cells.map((c) => `<w:tc><w:tcPr/>${p(c)}</w:tc>`).join("")}</w:tr>`;
  const lines = docxLines(docx(p("Audiences") + `<w:tbl><w:tblPr/>${row("Audience", "Age")}${row("Outdoor Moms", "25 - 44")}</w:tbl>` + p("Flight: Q1")));

  assert.deepEqual(lines, ["Audiences", "Audience | Age", "Outdoor Moms | 25 - 44", "Flight: Q1"]);
});

test("Word line breaks and tabs inside a paragraph are kept", () => {
  const lines = docxLines(docx(`<w:p><w:r><w:t>Goal:</w:t><w:tab/><w:t>Store visits</w:t><w:br/><w:t>KPI: CPV</w:t></w:r></w:p>`));

  assert.deepEqual(lines, ["Goal:\tStore visits", "KPI: CPV"]);
});

test("a file that is not a Word document is refused by name", () => {
  assert.throws(() => docxLines(new TextEncoder().encode("plain text, not a zip")), /not a readable Word document|no readable body/);
});
