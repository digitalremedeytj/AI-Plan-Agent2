/**
 * Regenerates dmaMarkets.json from assets/dma-to-state.csv.
 *
 *   npx tsx src/planning/knowledge/buildDmaMarkets.ts
 *
 * The CSV is the source of record for the market list. The JSON it produces is committed
 * and imported directly - the same arrangement workbook-83126.json has - so that neither
 * the browser nor the server parses CSV at runtime, and so a refreshed export is adopted
 * with one command instead of by hand-editing 210 records.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Vintage credit printed wherever the household figures are shown. Supplied by the
 * planning team with the CSV; it is not derivable from the file, which carries no year.
 */
const SOURCE_LABEL = "U.S. Census Bureau, 2025";
const SOURCE_FILE = "assets/dma-to-state.csv";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

/** Minimal RFC-4180 reader: market names are quoted when they contain a comma. */
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

  const expected = ["rank", "market_name", "tv_hhs", "%us", "dma_code", "state"];
  const actual = header.map((cell) => cell.trim().toLowerCase());
  if (expected.some((column, index) => actual[index] !== column)) {
    throw new Error(`Unexpected columns in ${SOURCE_FILE}: ${actual.join(", ")}`);
  }

  const markets = body.map((row) => {
    const [rank, name, households, share, code, states] = row.map((cell) => cell.trim());
    return {
      code,
      name,
      rank: Number(rank),
      tvHouseholds: Number(households.replace(/,/g, "")),
      usSharePct: Number(share),
      states: states.split("-").map((state) => state.trim()).filter(Boolean).sort(),
    };
  });

  // A malformed row would otherwise surface much later as a market that silently never
  // matches, so fail the regeneration instead.
  for (const market of markets) {
    if (!market.code || !market.name || !Number.isFinite(market.rank)
      || !Number.isFinite(market.tvHouseholds) || !Number.isFinite(market.usSharePct)
      || market.states.length === 0) {
      throw new Error(`Incomplete market record: ${JSON.stringify(market)}`);
    }
  }

  const codes = new Set(markets.map((market) => market.code));
  if (codes.size !== markets.length) throw new Error("Duplicate DMA codes in source CSV.");

  const output = {
    sourceLabel: SOURCE_LABEL,
    sourceFile: SOURCE_FILE,
    marketCount: markets.length,
    totalTvHouseholds: markets.reduce((total, market) => total + market.tvHouseholds, 0),
    markets: markets.sort((a, b) => a.rank - b.rank),
  };

  fs.writeFileSync(path.join(here, "dmaMarkets.json"), `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote dmaMarkets.json: ${output.marketCount} markets, ${output.totalTvHouseholds.toLocaleString()} TV households.`);
}

main();
