import assert from "node:assert/strict";
import test from "node:test";
import { platformReport } from "./__fixtures__/load";
import { buildDatasetTable, filterRows, nextSort, sortRows } from "./datasetTable";
import { readReport, type BreakdownReport } from "./reports";

const tableFor = (reportType: string) => {
  const f = platformReport(reportType);
  const report = readReport(f.name, f.text);
  return buildDatasetTable(f.text, report.kind, report.kind === "breakdown" ? (report as BreakdownReport).ignoredColumns : []);
};
const roleOf = (table: ReturnType<typeof buildDatasetTable>, header: string) => table.columns.find((c) => c.header === header)?.role;

test("a breakdown's columns are marked by what the analysis read them as", () => {
  const table = tableFor("Publisher");
  assert.equal(roleOf(table, "Spend"), "metric");
  assert.equal(roleOf(table, "Visits"), "metric");
  assert.equal(table.columns.find((c) => c.header === "Visits")?.readAs, "Conversions (Visits)");
  assert.equal(roleOf(table, "Roas"), "ratio");
  assert.equal(roleOf(table, "displayName"), "label");
  assert.equal(roleOf(table, "streamingCategory"), "label");
  assert.equal(roleOf(table, "Ireach"), "ignored");
});

test("a daily report reads only its date and counts, so a split column is shown as ignored", () => {
  const table = buildDatasetTable("Date,Publisher,Spend,Visits\n2026-02-09,Hulu,100,4\n2026-02-10,Roku,80,3\n", "series");
  assert.deepEqual(table.columns.map((c) => c.role), ["label", "ignored", "metric", "metric"]);
  assert.equal(table.columns[0].readAs, "Date");
});

test("a file that was not read has every column marked ignored, and a summary has no roles", () => {
  assert.deepEqual(buildDatasetTable("a,b\n1,2\n", "unread").columns.map((c) => c.role), ["ignored", "ignored"]);
  assert.deepEqual(buildDatasetTable("Metric,Value\nImpressions,100\n", "summary").columns.map((c) => c.role), ["none", "none"]);
});

test("blank lines in an export are not shown as empty rows", () => {
  assert.equal(buildDatasetTable("Name,Spend\nA,1\n\nB,2\n\n", "breakdown").rows.length, 2);
});

test("a money column sorts by value, not as text, and blanks stay last both ways", () => {
  const table = buildDatasetTable('Name,Spend\nA,"$1,200"\nB,\nC,$95\nD,$300\n', "breakdown");
  const names = (direction: "asc" | "desc") => sortRows(table.rows, table.columns, { column: 1, direction }).map((r) => r[0]);
  assert.equal(table.columns[1].numeric, true);
  assert.deepEqual(names("asc"), ["C", "D", "A", "B"]);
  assert.deepEqual(names("desc"), ["A", "D", "C", "B"]);
});

test("a header click cycles ascending, descending, then back to the export's order", () => {
  let sort = nextSort(null, 2);
  assert.deepEqual(sort, { column: 2, direction: "asc" });
  sort = nextSort(sort, 2);
  assert.deepEqual(sort, { column: 2, direction: "desc" });
  assert.equal(nextSort(sort, 2), null);
  assert.deepEqual(nextSort(sort, 0), { column: 0, direction: "asc" });
});

test("the filter matches any cell, ignoring case", () => {
  const rows = [["Hulu", "CTV"], ["Roku", "CTV"], ["Yahoo", "Display"]];
  assert.deepEqual(filterRows(rows, "ctv").map((r) => r[0]), ["Hulu", "Roku"]);
  assert.deepEqual(filterRows(rows, "  "), rows);
});
