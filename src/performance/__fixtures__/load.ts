// The fixtures are a real campaign's exports, anonymised: brand, competitor and creative names
// replaced, money scaled by one constant (every ratio is unchanged), and the touch-level samples
// given new conversion ids and household hashes. Publisher, media type and DMA names are real.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export const fixture = (name: string) => ({ name, text: readFileSync(join(here, name), "utf8") });

/** The summarised platform exports for one flight (the "AP ..." files). */
export const platformReports = () => readdirSync(here).filter((f) => f.startsWith("AP ")).sort().map(fixture);

export const platformReport = (reportType: string) => {
  const name = readdirSync(here).find((f) => f.startsWith(`AP ${reportType} `));
  if (!name) throw new Error(`No fixture for ${reportType}`);
  return fixture(name);
};
