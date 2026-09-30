import assert from "node:assert/strict";
import test from "node:test";
import { CsvReader, parseCsv } from "./csv";
import { parseReportFileName } from "./columns";
import { parseDate, parseNumber } from "./values";

test("quoted fields keep their commas, escaped quotes and line breaks", () => {
  const { headers, rows } = parseCsv('name,Spend\n"OTT - Car Drivers (Exclude SUVs, Trucks)","10"\n"Say ""hi""\nthere",5\n');
  assert.deepEqual(headers, ["name", "Spend"]);
  assert.deepEqual(rows, [["OTT - Car Drivers (Exclude SUVs, Trucks)", "10"], ['Say "hi"\nthere', "5"]]);
});

test("a file read in tiny chunks gives the same rows as reading it whole", () => {
  const text = '﻿a,b\r\n"x, ""y""",1\r\n"multi\r\nline",2\r\n\r\n';
  const whole = parseCsv(text);
  const reader = new CsvReader();
  const rows: string[][] = [];
  // One character at a time splits every quote pair and every CRLF across chunks.
  for (const ch of text) rows.push(...reader.push(ch));
  rows.push(...reader.end());
  assert.deepEqual(rows, [whole.headers, ...whole.rows]);
  assert.deepEqual(whole.headers, ["a", "b"], "the byte-order mark is not part of the first header");
});

test("tab-separated text pasted from a spreadsheet is read as columns", () => {
  assert.deepEqual(parseCsv("name\tSpend\nHulu\t12.5\n").rows, [["Hulu", "12.5"]]);
});

test("money, percentages and accounting negatives are read as numbers", () => {
  assert.equal(parseNumber("$950,000.01"), 950000.01);
  assert.equal(parseNumber("66.74%"), 66.74);
  assert.equal(parseNumber("-12.95%"), -12.95);
  assert.equal(parseNumber("(1,200)"), -1200);
  assert.equal(parseNumber("1.5e3"), 1500);
  assert.equal(parseNumber("n/a"), null);
  assert.equal(parseNumber("Hulu"), null);
});

test("US and ISO dates are read, and impossible dates are refused", () => {
  assert.equal(parseDate("2/09/2026"), Date.UTC(2026, 1, 9));
  assert.equal(parseDate("2024-05-25 15:51:30"), Date.UTC(2024, 4, 25, 15, 51, 30));
  assert.equal(parseDate("3/1/26 1:05 pm"), Date.UTC(2026, 2, 1, 13, 5));
  assert.equal(parseDate("2/30/2026"), null);
  assert.equal(parseDate("Display - 300x250"), null);
});

test("a platform file name gives the report type, window and advertiser", () => {
  const name = parseReportFileName("AP Reach & Frequency Summary (2026-02-09 - 2026-03-10) - Acme Auto Accessories_20260312_120222.csv");
  assert.equal(name.fromPlatform, true);
  assert.equal(name.reportType, "Reach & Frequency Summary");
  assert.equal(name.advertiser, "Acme Auto Accessories");
  assert.deepEqual(name.window, { start: Date.UTC(2026, 1, 9), end: Date.UTC(2026, 2, 10) });
  assert.equal(name.exportedAt, Date.UTC(2026, 2, 12, 12, 2, 22));
});

test("the pacing export's name has no window or advertiser, and says so", () => {
  const name = parseReportFileName("AP IO Pacing - _20260312_120250.csv");
  assert.equal(name.reportType, "IO Pacing");
  assert.equal(name.window, undefined);
  assert.equal(name.advertiser, undefined);
});

test("a non-platform file name still yields a date range when it has one", () => {
  const name = parseReportFileName("publisher_report_2026-02-09_to_2026-03-10.csv");
  assert.equal(name.fromPlatform, false);
  assert.deepEqual(name.window, { start: Date.UTC(2026, 1, 9), end: Date.UTC(2026, 2, 10) });
});
