/**
 * Regenerates stateHouseholds.json from assets/state-tv-hh.csv.
 *
 *   npx tsx src/planning/knowledge/buildStateHouseholds.ts
 *
 * Same arrangement as buildDmaMarkets.ts: the CSV is the source of record and the committed
 * JSON is what the app imports. State households exist separately from the DMA file because
 * 102 of the 210 markets straddle state lines, so they cannot be rolled up to states.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { US_STATES } from "./usStates";

/**
 * Vintage credit printed wherever the household figures are shown. Supplied by the
 * planning team with the CSV; the file itself carries no year.
 */
const SOURCE_LABEL = "State TV household estimates, supplied by Media Planning";
const SOURCE_FILE = "assets/state-tv-hh.csv";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

/** Minimal RFC-4180 reader: household counts are quoted because they contain commas. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ",") { row.push(field); field = ""; continue; }
    if (char === "\r") continue;
    if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += char;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((entry) => entry.some((cell) => cell.trim().length > 0));
}

function main() {
  const csvPath = path.join(repoRoot, SOURCE_FILE);
  const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
  const [header, ...body] = rows;

  const expected = ["rank", "state", "tv households", "% of us"];
  const actual = header.map((cell) => cell.trim().toLowerCase());
  if (expected.some((column, index) => actual[index] !== column)) {
    throw new Error(`Unexpected columns in ${SOURCE_FILE}: ${actual.join(", ")}`);
  }

  const byName = new Map(US_STATES.map((state) => [state.name.toLowerCase(), state]));

  const states = body.map((row) => {
    const [rank, name, households, share] = row.map((cell) => cell.trim());
    const state = byName.get(name.toLowerCase());
    if (!state) throw new Error(`State "${name}" in ${SOURCE_FILE} does not match a name in usStates.ts.`);
    return {
      code: state.code,
      name: state.name,
      rank: Number(rank),
      tvHouseholds: Number(households.replace(/,/g, "")),
      usSharePct: Number(share.replace(/%/g, "")),
    };
  });

  for (const state of states) {
    if (!Number.isFinite(state.rank) || !Number.isFinite(state.tvHouseholds) || state.tvHouseholds <= 0
      || !Number.isFinite(state.usSharePct)) {
      throw new Error(`Incomplete state record: ${JSON.stringify(state)}`);
    }
  }

  // A missing state would size a State-targeted plan at zero households, so refuse to build.
  const codes = new Set(states.map((state) => state.code));
  if (codes.size !== states.length) throw new Error(`Duplicate states in ${SOURCE_FILE}.`);
  const missing = US_STATES.filter((state) => !codes.has(state.code)).map((state) => state.name);
  if (missing.length > 0) throw new Error(`${SOURCE_FILE} is missing: ${missing.join(", ")}.`);

  const output = {
    sourceLabel: SOURCE_LABEL,
    sourceFile: SOURCE_FILE,
    stateCount: states.length,
    totalTvHouseholds: states.reduce((total, state) => total + state.tvHouseholds, 0),
    states: states.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name)),
  };

  fs.writeFileSync(path.join(here, "stateHouseholds.json"), `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote stateHouseholds.json: ${output.stateCount} states, ${output.totalTvHouseholds.toLocaleString()} TV households.`);
}

main();
