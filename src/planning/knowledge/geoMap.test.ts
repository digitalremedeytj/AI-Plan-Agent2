import assert from "node:assert/strict";
import test from "node:test";
import { DMA_MARKETS } from "./dmaMarkets";
import { MAP_MARKETS, MAP_STATES, MAP_VIEWBOX, footprintViewBox } from "./geoMap";
import { US_STATES } from "./usStates";

/** The rings of an SVG path made only of M, L and Z, as the build script writes them. */
function rings(d: string): Array<Array<[number, number]>> {
  return d.split("Z").filter(Boolean).map((ring) => ring.replace(/^M/, "").split("L").map((point) => point.split(",").map(Number) as [number, number]));
}

/** Even-odd rule across every ring, so islands count and lakes do not. */
function contains(d: string, x: number, y: number): boolean {
  let inside = false;
  for (const ring of rings(d)) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

test("the map has an outline for every state and DC, and nothing else", () => {
  const expected = US_STATES.map((state) => state.code).filter((code) => code !== "PR").sort();
  assert.deepEqual(MAP_STATES.map((state) => state.code), expected);
});

test("every market has a point, and it lands inside the state its city is in", () => {
  const outlines = new Map(MAP_STATES.map((state) => [state.code, state.d]));
  const misplaced: string[] = [];
  for (const market of DMA_MARKETS) {
    const point = MAP_MARKETS[market.code];
    assert.ok(point, `${market.code} ${market.name} has no point`);
    // The city's state is one the market delivers into, so the dot sits over the footprint.
    assert.ok(market.states.includes(point.state), `${market.name}: ${point.state} is not one of ${market.states}`);
    if (!contains(outlines.get(point.state)!, point.x, point.y)) misplaced.push(`${market.name} (${point.state})`);
  }
  // A coastal city can sit a hair outside a 10m-simplified coastline; more than a handful means
  // the projection has drifted from the one the outlines were drawn in.
  assert.ok(misplaced.length <= 5, `points outside their state: ${misplaced.join(", ")}`);
});

test("a small footprint is framed close in, at the map's own shape", () => {
  const [, , width, height] = footprintViewBox(["MA", "CT", "RI"]);
  assert.ok(width < MAP_VIEWBOX[2] / 2);
  assert.ok(Math.abs(width / height - MAP_VIEWBOX[2] / MAP_VIEWBOX[3]) < 0.01);
});

test("a coast-to-coast footprint shows the whole map", () => {
  assert.deepEqual(footprintViewBox(["CA", "NY"]), MAP_VIEWBOX);
  assert.deepEqual(footprintViewBox([]), MAP_VIEWBOX);
});
