import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GenerationLog } from "./GenerationLog";
import type { GenerationLogEntry } from "../types";

const entries: GenerationLogEntry[] = [
  { at: "2026-09-24T13:16:12.000Z", type: "status", message: "Crawling advertiser website..." },
  { at: "2026-09-24T13:17:05.000Z", type: "research_result", label: "Demographics", sources: [{ title: "census.gov", uri: "https://www.census.gov/data" }], blurb: "Median age 34." },
  { at: "2026-09-24T13:21:10.000Z", type: "status", message: "QA auditor: Checking persona stats against the dossiers..." },
];

test("a plan generated before the log was saved shows no log section", () => {
  assert.equal(renderToStaticMarkup(<GenerationLog entries={undefined} />), "");
  assert.equal(renderToStaticMarkup(<GenerationLog entries={[]} />), "");
});

test("the log starts collapsed, showing only its header and step count", () => {
  const html = renderToStaticMarkup(<GenerationLog entries={entries} />);
  assert.match(html, /Generation Process Log/);
  assert.match(html, /3 steps/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /Crawling advertiser website/);
});
