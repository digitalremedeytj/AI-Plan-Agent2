/**
 * Regenerates geoMap.json - the US state outlines and one point per DMA that the plan's
 * Geo Footprint map draws - from two committed sources:
 *
 *   assets/us-states-albers-10m.json   us-atlas@3.0.1 (Census cartographic boundaries, ISC),
 *                                      already projected to Albers USA in a 975x610 frame
 *   assets/dma-principal-cities.csv    each market's main city and its coordinates
 *
 *   npx tsx src/planning/knowledge/buildGeoMap.ts
 *
 * The city list is itself built from the Census Gazetteer places file, which is too large to
 * commit (6.5MB). To refresh it, download 2024_Gaz_place_national.zip from census.gov, unzip it
 * and pass the .txt:
 *
 *   npx tsx src/planning/knowledge/buildGeoMap.ts --gazetteer path/to/2024_Gaz_place_national.txt
 *
 * Shapes ship as SVG path strings so the browser draws them with no geo library: the app avoids
 * npm dependencies (see CLAUDE.md), and a topojson decoder plus projection would be one.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import marketData from "./dmaMarkets.json";
import { US_STATES } from "./usStates";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const TOPOLOGY_FILE = "assets/us-states-albers-10m.json";
const CITIES_FILE = "assets/dma-principal-cities.csv";
const OUTPUT_FILE = "src/planning/knowledge/geoMap.json";

/**
 * Markets whose principal city the name cannot yield: abbreviated past recognition, a region
 * rather than a city, or a Gazetteer place named differently ("Urban Honolulu CDP").
 */
const CITY_OVERRIDES: Record<string, { city: string; state: string }> = {
  "744": { city: "Urban Honolulu", state: "HI" },
  "531": { city: "Johnson City", state: "TN" },
  "567": { city: "Greenville", state: "SC" },
  "862": { city: "Sacramento", state: "CA" },
  "855": { city: "Santa Barbara", state: "CA" },
  "611": { city: "Rochester", state: "MN" },
  "577": { city: "Wilkes-Barre", state: "PA" },
  "648": { city: "Champaign", state: "IL" },
  "682": { city: "Davenport", state: "IA" },
  "725": { city: "Sioux Falls", state: "SD" },
  "709": { city: "Tyler", state: "TX" },
  "627": { city: "Wichita Falls", state: "TX" },
  "722": { city: "Lincoln", state: "NE" },
  "511": { city: "Washington", state: "DC" },
  // Bluefield is a town in VA and the larger city in WV; the market is named for the WV one.
  "559": { city: "Bluefield", state: "WV" },
};

// ---------------------------------------------------------------------------------------------
// Albers USA, as d3.geoAlbersUsa().scale(1300).translate([487.5, 305]) - the frame us-atlas
// projected the outlines into, so city points line up with them.

type Conic = (lon: number, lat: number) => [number, number];

function conicEqualArea(opts: { parallels: [number, number]; rotate: number; center: [number, number]; scale: number; translate: [number, number] }): Conic {
  const rad = Math.PI / 180;
  const sy0 = Math.sin(opts.parallels[0] * rad);
  const n = (sy0 + Math.sin(opts.parallels[1] * rad)) / 2;
  const c = 1 + sy0 * (2 * n - sy0);
  const r0 = Math.sqrt(c) / n;
  const raw = (lambda: number, phi: number): [number, number] => {
    const r = Math.sqrt(c - 2 * n * Math.sin(phi)) / n;
    return [r * Math.sin(lambda * n), r0 - r * Math.cos(lambda * n)];
  };
  const wrap = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180;
  const [cx, cy] = raw(opts.center[0] * rad, opts.center[1] * rad);
  const k = opts.scale;
  const [tx, ty] = opts.translate;
  return (lon, lat) => {
    const [x, y] = raw(wrap(lon + opts.rotate) * rad, lat * rad);
    return [tx + k * (x - cx), ty - k * (y - cy)];
  };
}

const K = 1300;
const [TX, TY] = [487.5, 305];
const lower48 = conicEqualArea({ parallels: [29.5, 45.5], rotate: 96, center: [-0.6, 38.7], scale: K, translate: [TX, TY] });
const alaska = conicEqualArea({ parallels: [55, 65], rotate: 154, center: [-2, 58.5], scale: K * 0.35, translate: [TX - 0.307 * K, TY + 0.201 * K] });
const hawaii = conicEqualArea({ parallels: [8, 18], rotate: 157, center: [-3, 19.9], scale: K, translate: [TX - 0.205 * K, TY + 0.212 * K] });

export function projectAlbersUsa(lon: number, lat: number, state: string): [number, number] {
  const project = state === "AK" ? alaska : state === "HI" ? hawaii : lower48;
  return project(lon, lat);
}

// ---------------------------------------------------------------------------------------------
// TopoJSON, decoded only as far as this one file needs: quantized arcs into rings, rings into
// SVG paths.

interface Topology {
  transform: { scale: [number, number]; translate: [number, number] };
  arcs: Array<Array<[number, number]>>;
  objects: { states: { geometries: Array<{ type: string; arcs: number[][] | number[][][]; id: string; properties: { name: string } }> } };
}

function decodeArcs(topology: Topology): Array<Array<[number, number]>> {
  const [sx, sy] = topology.transform.scale;
  const [tx, ty] = topology.transform.translate;
  return topology.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * sx + tx, y * sy + ty] as [number, number];
    });
  });
}

function ringFrom(arcIndexes: number[], arcs: Array<Array<[number, number]>>): Array<[number, number]> {
  const ring: Array<[number, number]> = [];
  for (const index of arcIndexes) {
    const arc = index >= 0 ? arcs[index] : [...arcs[~index]].reverse();
    // Consecutive arcs share an endpoint; keep it once.
    arc.forEach((point, i) => { if (i > 0 || ring.length === 0) ring.push(point); });
  }
  return ring;
}

const fmt = (value: number) => Number(value.toFixed(1));

function pathFrom(polygons: Array<Array<Array<[number, number]>>>): string {
  return polygons
    .flatMap((rings) => rings.map((ring) => {
      // Drop points that round onto the one before, which is most of them at this precision.
      const points: string[] = [];
      for (const [x, y] of ring) {
        const point = `${fmt(x)},${fmt(y)}`;
        if (points[points.length - 1] !== point) points.push(point);
      }
      return `M${points.join("L")}Z`;
    }))
    .join("");
}

// ---------------------------------------------------------------------------------------------
// Principal cities.

function parseCsv(text: string): string[][] {
  return text.trim().split(/\r?\n/).map((line) => line.split(","));
}

function normalizePlace(value: string): string {
  return value
    .toLowerCase()
    .replace(/\(balance\)/g, "")
    .replace(/\b(city and borough|consolidated government|metropolitan government|metro government|urban county|unified government|municipality|city|town|village|cdp|borough)\b/g, "")
    .replace(/\bft\.?\s/g, "fort ")
    .replace(/\bst\.?\s/g, "st ")
    .replace(/[.']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface Place { state: string; name: string; land: number; lat: number; lon: number }

function citiesFromGazetteer(file: string): string[][] {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).slice(1).filter(Boolean);
  const places: Place[] = lines.map((line) => {
    const cols = line.split("\t").map((col) => col.trim());
    return { state: cols[0], name: cols[3], land: Number(cols[6]), lat: Number(cols[10]), lon: Number(cols[11]) };
  });

  const rows: string[][] = [["code", "market", "city", "state", "lat", "lon"]];
  const missing: string[] = [];
  for (const market of marketData.markets) {
    const override = CITY_OVERRIDES[market.code];
    const commaState = market.name.match(/,\s*([A-Za-z]{2})\b/)?.[1]?.toUpperCase();
    const city = override?.city || market.name.split(/[-(,&]/)[0].trim();
    const states = override ? [override.state] : commaState ? [commaState] : market.states;
    const key = normalizePlace(city);
    const inStates = places.filter((place) => states.includes(place.state));
    const exact = inStates.filter((place) => normalizePlace(place.name) === key);
    // Consolidated governments carry the county in the name: "Macon-Bibb County".
    const prefixed = exact.length > 0 ? exact : inStates.filter((place) => {
      const name = normalizePlace(place.name);
      return name.startsWith(`${key}-`) || name.startsWith(`${key}/`);
    });
    const best = prefixed.sort((a, b) => b.land - a.land)[0];
    if (!best) { missing.push(`${market.code} ${market.name} (${city}; ${states.join("/")})`); continue; }
    rows.push([market.code, market.name.replace(/,/g, ""), best.name.replace(/,/g, ""), best.state, best.lat.toFixed(4), best.lon.toFixed(4)]);
  }
  if (missing.length > 0) {
    throw new Error(`No Gazetteer place for ${missing.length} markets; add them to CITY_OVERRIDES:\n${missing.join("\n")}`);
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------

function main() {
  const gazetteerFlag = process.argv.indexOf("--gazetteer");
  if (gazetteerFlag >= 0) {
    const rows = citiesFromGazetteer(path.resolve(process.argv[gazetteerFlag + 1]));
    fs.writeFileSync(path.join(repoRoot, CITIES_FILE), `${rows.map((row) => row.join(",")).join("\n")}\n`);
    console.log(`Wrote ${rows.length - 1} markets to ${CITIES_FILE}`);
  }

  const topology = JSON.parse(fs.readFileSync(path.join(repoRoot, TOPOLOGY_FILE), "utf8")) as Topology;
  const arcs = decodeArcs(topology);
  const codeByName = new Map(US_STATES.map((state) => [state.name, state.code]));
  const states = topology.objects.states.geometries
    .map((geometry) => {
      const code = codeByName.get(geometry.properties.name);
      if (!code) return null;
      const polygons = (geometry.type === "Polygon" ? [geometry.arcs as number[][]] : (geometry.arcs as number[][][]))
        .map((polygon) => polygon.map((ring) => ringFrom(ring, arcs)));
      const points = polygons.flat(2);
      const xs = points.map((point) => point[0]);
      const ys = points.map((point) => point[1]);
      return {
        code,
        d: pathFrom(polygons),
        bbox: [fmt(Math.min(...xs)), fmt(Math.min(...ys)), fmt(Math.max(...xs)), fmt(Math.max(...ys))],
      };
    })
    .filter((state): state is NonNullable<typeof state> => Boolean(state))
    .sort((a, b) => a.code.localeCompare(b.code));

  const cityRows = parseCsv(fs.readFileSync(path.join(repoRoot, CITIES_FILE), "utf8")).slice(1);
  const markets: Record<string, { state: string; x: number; y: number }> = {};
  for (const [code, , , state, lat, lon] of cityRows) {
    const [x, y] = projectAlbersUsa(Number(lon), Number(lat), state);
    markets[code] = { state, x: fmt(x), y: fmt(y) };
  }

  const output = {
    source: "U.S. Census Bureau cartographic boundaries via us-atlas@3.0.1; Census Gazetteer 2024 places",
    viewBox: [0, 0, 975, 610],
    states,
    markets,
  };
  fs.writeFileSync(path.join(repoRoot, OUTPUT_FILE), `${JSON.stringify(output)}\n`);
  console.log(`Wrote ${states.length} states and ${Object.keys(markets).length} markets to ${OUTPUT_FILE}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
